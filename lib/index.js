/**
 * dsh-relay-toolkit —— 宿主半侧（Node）。
 *
 * 只做两件事，并且只写 settings 的用户层、只填空缺：
 *   1. 把中转站 `/models` 列表里缺失的模型合并进对应的 llm-pi-ai 路由；
 *   2. 给缺少 `reasoningEfforts` 声明的模型补上思考等级声明。
 *
 * 三条硬约束来自对本机 DSH 0.1.5-rc.1 实现的实际核对：
 *
 *   - Cordis 的 `inject` 没有可选形式，把它写进模块级 inject 会让没有 web 服务的
 *     组合直接拒绝加载本插件。所以模块级 inject 留空，web 服务（webServer /
 *     httpServer 两个真实存在过的名字）改用嵌套 `ctx.inject` 逐个等待，
 *     与 dsh-tokenledger 的处理方式一致。
 *   - 服务一律经 `ctx.get(name)` 取用，不做未声明属性的直接访问。
 *   - `settings.update` 一律带上读取时的 revision，避免覆盖并发修改。
 *
 * 不写 `service_tier` / Fast 相关逻辑：中转站普遍接受并忽略该字段，
 * 声称“加速”是不诚实的。
 */

/** settings 命名空间：llm-pi-ai 的路由与模型声明。 */
const NS = 'llm-pi-ai'

/** 默认模型选择的命名空间：多模态诊断要顺着它找到真正在用的那条路由。 */
const DEFAULT_MODEL_NS = 'agent-default-model'

/** 宿主路由前缀。webServer 按最长前缀匹配，优先于 `/api` 共享通道。 */
const BASE_PATH = '/api/relay-toolkit'

/** 宿主 HTTP 路由注册表的服务名，新名在前；两个都真实存在过，先到者生效。 */
const WEB_SERVER_NAMES = ['webServer', 'httpServer']

/** 中转站 `/models` 请求超时。 */
const REQUEST_TIMEOUT_MS = 15_000

/** 请求体上限，防止意外的大 body。 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * 连通性探测的用语 —— 一个最普通的问候。
 *
 * 刻意用最短的输入：探测要回答的只是「API 通不通、密钥对不对、这个模型在不在」，
 * 任何更复杂的提示都只会增加成本与触发工具调用/长思考的机会。
 */
const PROBE_PROMPT = 'hi'

/**
 * 探测请求的最大输出 token。
 *
 * 为什么不是 1：GLM-5.3 与 Kimi K3 这类**强制思考**的模型会把预算先花在思考上，
 * 预算过小时可能直接被上游拒绝（而不是回一个短答案）。32 足够验证连通性，
 * 又小到成本可以忽略 —— 探测要的是「通不通」，不是「答得好不好」。
 */
const PROBE_MAX_TOKENS = 32

/**
 * 探测超时。比 `/models` 的 15 秒宽松得多：强制思考的模型首个 token 可能要等十几秒，
 * 上游排队时更久。探测本来就该等得起，误判成「不可用」的代价更大。
 */
const PROBE_TIMEOUT_MS = 30_000

/** 单次批量探测的模型数上限：防止一次点击打出几百个计费请求。 */
const PROBE_MAX_MODELS = 50

/** 批量探测的并发上限。对中转站友好，也不至于串行等到天荒地老。 */
const PROBE_CONCURRENCY = 3

/**
 * pi-ai 允许声明的思考等级，按升级顺序。
 *
 * 取自 `@deepseek-ai/dsh-llm-pi-ai` 的 `THINKING_LEVELS`：`reasoningEfforts` 的
 * **键**必须落在这个集合内，**值**是该等级在线上报文的拼写（字符串），
 * 只有 `off` 允许为 null。写出集合外的键会被 schema 直接拒绝。
 */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * 思考等级规则表 —— 一张表同时表达**给哪些档位**与**为什么一个档位都不给**。
 *
 * 为什么合并成一张：`match` 是**子串**且**最长命中优先**，两张表分开时无法互相压制。
 * 典型例子是 `kimi-for-coding`（K2.8 Preview，有 low/high/max）与
 * `kimi-for-coding-highspeed`（K2.7 Code 高速版，只有 Thinking 开关）—— 分开查的话
 * 前者会盖住后者，给高速版错误地补上档位。
 *
 * `match` 是小写子串；`efforts` 是官方档位集合，`noEffort` 是官方确认不该写档位时
 * 给人看的一句理由。一条规则只会是其中一种，两者天然互斥。
 *
 * wire 值刻意与键同名（`low: 'low'`），因为这是 OpenAI 兼容端点的通用拼写；
 * `off` 用 null 表示“该档不发字段”。
 *
 * 给档位的规则**只收官方确认支持 `reasoning_effort` 参数的模型**，档位集合逐条来自
 * 官方文档（核对日期 2026-09-16，来源见 docs/MODEL_SPECS.md）。认不出来的模型一律
 * 不补 —— 宁可让界面显示“未识别”，也不把猜测写进配置。
 */
const EFFORT_RULES = [
  // ── 官方确认支持 reasoning_effort，给档位 ──
  // 官方只接受 low/high/max（minimal→low、medium→high、xhigh→high、ultra→max）
  { match: ['deepseek-v4.1', 'deepseek-v4', 'deepseek-flash'], efforts: { off: null, low: 'low', high: 'high', max: 'max' } },
  // 官方档位最全，且可按轮关闭思考
  { match: ['glm-5.2'], efforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  // 官方：强制思考、不可关闭，只有 low/high/max —— 因此没有 off 档
  { match: ['glm-5.3'], efforts: { low: 'low', high: 'high', max: 'max' } },
  // 官方：3.8 两档都是 low/medium/xhigh（默认 xhigh）
  { match: ['qwen3.8-max', 'qwen3.8-flash'], efforts: { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' } },
  // 官方（腾讯云 TokenHub）：no_think / low / high
  { match: ['hy3'], efforts: { off: 'no_think', low: 'low', high: 'high' } },
  // Kimi：K3、K3-256k、K2.8 Preview（官方 Model ID 为 `kimi-for-coding`）都是强制思考、
  // 不可关闭，只有 low/high/max。`kimi-for-coding` 会子串命中 `kimi-for-coding-highspeed`，
  // 靠下面那条更长的规则压住 —— 这正是本表必须合并成一张的原因。
  { match: ['kimi-k3', 'k3-256k', 'kimi-for-coding'], efforts: { low: 'low', high: 'high', max: 'max' } },

  // ── 官方认得出、但确认不该写档位 ──
  // 这些模型要么只有独立的 thinking 开关（开/关）而没有可选档位，要么官方压根没公布
  // 档位枚举。给它们写 reasoningEfforts 是有害的：DSH 会把档位显示给用户选，一选就
  // 真发 reasoning_effort，而不支持该参数的上游会报错或静默忽略。
  { match: ['kimi-for-coding-highspeed'], noEffort: '只有 Thinking 开关，无思考档位' },
  { match: ['glm-5.1', 'glm-5'], noEffort: '只有 thinking 开关，官方明确不支持 reasoning_effort' },
  // 官方原文：`kimi-k2.7-code-highspeed` 与 `kimi-k2.7-code` 是同一个模型、思考行为
  // 完全一致（高速版只改输出速度），所以两者一起列在这里 —— 高速版更长，最长命中优先
  // 会先选中它，结果与普通版一致。
  { match: ['kimi-k2.7-code-highspeed', 'kimi-k2.7-code', 'kimi-k2.6'], noEffort: '只有 thinking 开关，官方不支持 reasoning_effort' },
  { match: ['mimo-v2.5'], noEffort: '只有 thinking 开关，无多档' },
  { match: ['minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'minimax-m2.1'], noEffort: '只有 thinking 开关，无档位' },
  { match: ['qwen3.7'], noEffort: '官方未公布档位枚举' },
  { match: ['hy4'], noEffort: '官方未公布档位枚举' },
  // 专用模型（翻译 / 角色扮演 / OCR）：官方没有公布 `reasoning_effort` 档位枚举。
  // 它们本就不该被塞进对话路由，但中转站常把它们一并列出，所以给一句可读的原因，
  // 免得界面把它们归进「家族认不出来」再被人用通用模板补上无效档位。
  { match: ['hy-mt2'], noEffort: '翻译专用模型，官方未公布档位枚举' },
  { match: ['hy-role', 'hunyuan-role'], noEffort: '角色扮演专用模型，官方未公布档位枚举' },
  { match: ['glm-ocr'], noEffort: 'OCR 专用模型，无对话思考档位' }
]

/**
 * 别名 → 官方 id。**精确匹配**（不做子串），这是刻意的：
 * 像 `k3` 这种短别名一旦当子串用，会误伤任何含 `k3` 的模型 id。
 *
 * `k3` 与 `kimi-k3` 是同一个模型在两处官方入口下的名字：Kimi Code 用 `k3`，
 * API 开放平台用 `kimi-k3`。归一化后规格与档位都按后者查表，不另列一份。
 * （`k3-256k` 是独立 id、256K 上下文，规格不同，不走别名。）
 */
const ALIASES = {
  k3: 'kimi-k3'
}

/** 把已知别名归一化成官方 id；不认识的 id 原样返回。 */
function normalizeId (id) {
  return ALIASES[id.toLowerCase()] ?? id
}

/** 普通对象判定（排除数组与 null）。 */
function isRecord (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 非空字符串判定。 */
function nonEmptyString (value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * 把一份建议裁剪成 schema 一定接受的形式。
 *
 * 规则来自 `resolveModelReasoning()`：键必须落在 {@link LEVELS} 内，值是该等级的
 * 线上报文拼写，只有 `off` 允许 null，且至少要有一个非 `off` 等级。
 * 不满足就整份丢弃 —— 宁可少补一个模型，也不能让一次写入被 schema 拒绝。
 *
 * @param {Record<string, string | null>} efforts - 候选映射。
 * @returns {Record<string, string | null> | undefined} 合法映射，或 undefined。
 */
function sanitizeEfforts (efforts) {
  const clean = {}
  for (const level of LEVELS) {
    if (!Object.prototype.hasOwnProperty.call(efforts, level)) continue
    const wire = efforts[level]
    if (wire === null) {
      if (level === 'off') clean.off = null
      continue
    }
    if (nonEmptyString(wire)) clean[level] = wire
  }
  if (!Object.keys(clean).some(level => level !== 'off')) return undefined
  // 刻意**不**自动补 `off`：强制思考的模型（GLM-5.3、Kimi K3）根本没有关闭档位，
  // 补一个 off 会让界面多出一个实际无效的“关闭思考”选项。表里写了才有。
  return clean
}

/**
 * 在 {@link EFFORT_RULES} 里找**最长命中**的那条规则。
 *
 * 最长命中优先是这张表的核心机制：`glm-5.2` 必须盖住 `glm-5`，
 * `kimi-for-coding-highspeed` 必须盖住 `kimi-for-coding`。
 *
 * @param {string} id - 已归一化的模型 id。
 * @returns {object | undefined} 命中的规则；认不出时 undefined。
 */
function effortRuleFor (id) {
  const lower = id.toLowerCase()
  let best
  let bestLength = 0
  for (const rule of EFFORT_RULES) {
    for (const pattern of rule.match) {
      if (lower.includes(pattern) && pattern.length > bestLength) {
        best = rule
        bestLength = pattern.length
      }
    }
  }
  return best
}

/**
 * 一个模型 id 的思考等级建议。
 *
 * @param {unknown} id - 模型 id。
 * @returns {Record<string, string | null> | undefined} 建议映射；家族未知、或官方明确
 *   不给档位时为 undefined。
 */
export function suggestEfforts (id) {
  if (!nonEmptyString(id)) return undefined
  const rule = effortRuleFor(normalizeId(id))
  return rule?.efforts === undefined ? undefined : sanitizeEfforts(rule.efforts)
}

/**
 * 一个模型 id 为什么不该写档位 —— 官方认得出，但它明确没有可选档位。
 *
 * 与 {@link suggestEfforts} **严格互斥**，而且由同一个机制保证：两者取的都是
 * {@link effortRuleFor} 命中的**同一条**规则，而一条规则只会带 `efforts` 或 `noEffort`
 * 之一。界面靠这个互斥关系分类，`scripts/fix-efforts.mjs` 也靠它决定「删」还是「不动」。
 *
 * @param {unknown} id - 模型 id。
 * @returns {string | undefined} 不写档位的原因；认不出、或官方有档位时为 undefined。
 */
export function noEffortReason (id) {
  if (!nonEmptyString(id)) return undefined
  return effortRuleFor(normalizeId(id))?.noEffort
}

/**
 * 官方规格兜底表 —— **只在 `discoverModels` 没给出数值时才使用**。
 *
 * 数值来自 2026-09-11 的人工核对，逐条附官方来源；`match` 是小写子串，最长命中优先。
 * 它**不是**权威数据源：厂商改规格、模型退役都不会自动更新，所以每条都带核对日期，
 * 复查请以官方文档为准（完整核对过程见 docs/MODEL_SPECS.md）。
 *
 * 刻意缺 `maxTokens` 的条目表示**官方未公布上限** —— 宁可不写，也不拿同家族其它型号凑。
 * 同样要注意：原厂规格不等于中转站上限（`MiniMax-M3` 原厂 1M，阿里云转售只给 192k）。
 */
const SPECS = [
  { match: ['deepseek-v4.1', 'deepseek-flash'], contextWindow: 1000000, maxTokens: 384000, source: 'DeepSeek 官方 API 文档' },
  { match: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4'], contextWindow: 1000000, maxTokens: 384000, source: 'DeepSeek 官方 API 文档' },
  { match: ['glm-5.3', 'glm-5.2'], contextWindow: 1000000, maxTokens: 128000, source: '智谱官方文档' },
  { match: ['glm-5.1'], contextWindow: 200000, maxTokens: 128000, source: '智谱官方文档' },
  { match: ['kimi-k3'], contextWindow: 1000000, maxTokens: 1048576, source: 'Kimi 官方文档' },
  { match: ['k3-256k'], contextWindow: 262144, source: 'Kimi Code 官方模型文档（未公布输出上限）' },
  { match: ['kimi-for-coding-highspeed'], contextWindow: 262144, source: 'Kimi Code 官方模型文档（未公布输出上限）' },
  { match: ['kimi-for-coding'], contextWindow: 1048576, source: 'Kimi Code 官方模型文档（未公布输出上限）' },
  { match: ['kimi-k2.7', 'kimi-k2.6'], contextWindow: 256000, source: 'Kimi 官方文档（未公布输出上限）' },
  { match: ['hy4'], contextWindow: 1000000, maxTokens: 64000, source: '腾讯云 TokenHub 官方模型表' },
  { match: ['hy3'], contextWindow: 256000, maxTokens: 128000, source: '腾讯云 TokenHub 官方模型表' },
  // 腾讯云 TokenHub 模型表新列的专用模型（Hy-MT2 翻译三档、Hy-Role 角色扮演两档）。
  // `hunyuan-role-latest` 是 `hy-role` 的官方调用名，两者规格相同，一起列。
  { match: ['hy-mt2'], contextWindow: 8000, maxTokens: 4000, source: '腾讯云 TokenHub 官方模型表' },
  { match: ['hunyuan-role-latest', 'hy-role'], contextWindow: 32000, maxTokens: 4000, source: '腾讯云 TokenHub 官方模型表' },
  { match: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.7-max', 'qwen3.7-flash'], contextWindow: 1000000, maxTokens: 131072, source: '阿里云百炼官方文档' },
  { match: ['minimax-m3'], contextWindow: 1000000, source: 'MiniMax 官方文档（输出上限未逐型号公布）' },
  { match: ['minimax-m2.7', 'minimax-m2.5', 'minimax-m2.1', 'minimax-m2'], contextWindow: 204800, source: 'MiniMax 官方文档（输出上限未逐型号公布）' },
  { match: ['mimo-v2.5'], contextWindow: 1000000, maxTokens: 131072, source: '小米 MiMo 官方文档' }
]

/** 上面那张表的核对日期，随数值一起交给界面，便于判断新鲜度。 */
const SPEC_CHECKED = '2026-09-16'

/**
 * 一个模型 id 的官方规格，最长命中优先。
 *
 * @param {unknown} id - 模型 id。
 * @returns {{ contextWindow?: number, maxTokens?: number, source: string, checked: string } | undefined}
 */
function specFor (id) {
  if (!nonEmptyString(id)) return undefined
  const lower = normalizeId(id).toLowerCase()
  let best
  let bestLength = 0
  for (const spec of SPECS) {
    for (const pattern of spec.match) {
      if (lower.includes(pattern) && pattern.length > bestLength) {
        best = spec
        bestLength = pattern.length
      }
    }
  }
  if (best === undefined) return undefined
  return {
    ...(positiveInteger(best.contextWindow) ? { contextWindow: best.contextWindow } : {}),
    ...(positiveInteger(best.maxTokens) ? { maxTokens: best.maxTokens } : {}),
    source: best.source,
    checked: SPEC_CHECKED
  }
}

/**
 * 未识别家族的兜底模板 —— **只在你显式要求时使用**。
 *
 * 这是 OpenAI 兼容端点最常见的拼写组合，但上游是否真的支持无法预先确认，
 * 因此它**绝不参与自动补全**：只有你点了「用通用模板补全」才会写入，
 * 界面上也会写清楚这一点。写进去以后若选中某个等级被上游拒绝，删掉即可。
 */
const GENERIC_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high' }

/**
 * 官方确认**原生接受图像输入**的家族 —— 只收有官方来源的。
 *
 * 为什么需要它：pi-ai 的模型条目没声明 `input` 时，`dsh-llm-pi-ai` 会退回路由级
 * `defaultInput`（本机实测默认值是 `["text"]`），该模型于是被当纯文本路由，
 * `read_image` 之类的工具在**发请求之前**就拒了 —— 报错原文是
 * `does not declare image input`，是「未声明」，不是「不支持」。
 *
 * 反证（实测）：同一个模型 id、同一份 DSH，在声明了 `input: [text, image]` 的
 * provider 下能读图，在没声明的 provider 下读不了。**决定权在条目声明，不在模型名。**
 *
 * 三条硬约束：
 *   - 只收官方文档明确写了的模型。国外厂商（gpt / claude / gemini / grok）本轮
 *     没有可核对的官方来源，一个都不收 —— 认不出就不写；
 *   - 只写 `input`，**不写** `inputModalities`。后者是 DSH 内置适配器
 *     （`llm-deepseek`）的字段，pi-ai 风格的路由用的是 `input`，写错等于没写；
 *   - **官方能力 ≠ 中转站能力**。写进去只代表「这个模型本身能收图」，
 *     你的中转站是否真的向上游透传图像必须自己实测。
 */
const VISION_FAMILIES = [
  { match: ['deepseek-flash', 'deepseek-v4.1', 'deepseek-v4-flash-vision-exp'], source: 'DeepSeek 官方 Vision 文档' },
  { match: ['glm-5.3-flash'], source: '智谱官方 VLM 文档' },
  // Kimi 官方「配置 Kimi 视觉模型」页把这几个 id 一起点名：`kimi-k3` / `kimi-k2.6` /
  // `kimi-k2.7-code` / `kimi-k2.7-code-highspeed` 都能理解图片，且除 k2.6 外还支持视频。
  // Kimi Code 侧的四个 Model ID 同样支持图片输入（其中 k3-256k 仅图片）。
  { match: ['kimi-k3', 'k3-256k', 'kimi-for-coding', 'kimi-for-coding-highspeed'], source: 'Kimi 官方模型文档' },
  { match: ['kimi-k2.6', 'kimi-k2.7-code'], source: 'Kimi 官方视觉模型文档' },
  // 阿里云百炼模型页逐个列出「输入模态：Image / Text / Video」。
  { match: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.7-flash'], source: '阿里云百炼官方模型页' },
  // MiniMax 官方博客：M3 是原生多模态模型，支持图片和视频输入。
  { match: ['minimax-m3'], source: 'MiniMax 官方发布公告' },
  // 小米 MiMo 官方模型表：`mimo-v2.5` 的能力里写着「全模态理解」，官方图片理解示例用的
  // 就是它。而同前缀的其它型号**都没有**多模态理解能力：`mimo-v2.5-pro` 只列了文本生成 /
  // 深度思考，`mimo-v2.5-asr` 是语音识别，`mimo-v2.5-tts*` 是语音合成。它们的最长命中
  // 全都是 `mimo-v2.5`，单靠最长命中分不开 —— 必须靠 except 逐个排除，
  // 否则会给这些专用模型错误地补上 `input: [text, image]`。
  {
    match: ['mimo-v2.5'],
    except: ['mimo-v2.5-pro', 'mimo-v2.5-asr', 'mimo-v2.5-tts'],
    source: '小米 MiMo 官方模型表'
  }
]

/** 声明「能收图」时要写的值。pi-ai 只认 `text` 与 `image` 两个模态。 */
const VISION_INPUT = ['text', 'image']

/**
 * 一个模型 id 的官方图像能力。
 *
 * `except` 是给**共享前缀但能力不同**的型号用的：`mimo-v2.5` 支持全模态理解，而
 * `mimo-v2.5-pro` 官方只列了文本生成 —— 单靠最长命中分不开，因为它们的最长命中
 * 都是 `mimo-v2.5`。命中 `except` 里任意一条即视为认不出，不写声明。
 *
 * @param {unknown} id - 模型 id。
 * @returns {{ source: string } | undefined} 官方来源；认不出时为 undefined。
 */
export function visionSupport (id) {
  if (!nonEmptyString(id)) return undefined
  const lower = normalizeId(id).toLowerCase()
  let best
  let bestLength = 0
  for (const family of VISION_FAMILIES) {
    for (const pattern of family.match) {
      if (lower.includes(pattern) && pattern.length > bestLength) {
        best = family
        bestLength = pattern.length
      }
    }
  }
  if (best === undefined) return undefined
  if (Array.isArray(best.except) && best.except.some(pattern => lower.includes(pattern))) return undefined
  return { source: best.source }
}

/**
 * 一个模型条目已声明的输入模态。
 *
 * `input: []` 与不写等价：`dsh-llm-pi-ai` 的 `declaredInput()` 把空数组也当作
 * 「没表态」，随后退回路由默认值。所以空数组同样视为未声明。
 *
 * @returns {unknown[] | undefined} 非空声明，或 undefined（未声明）。
 */
function declaredInput (model) {
  if (!isRecord(model) || !Array.isArray(model.input) || model.input.length === 0) return undefined
  return model.input
}

/** 条目是否明确声明了图像输入。 */
function declaresImage (model) {
  const input = declaredInput(model)
  return Array.isArray(input) && input.includes('image')
}

/**
 * 只给“没有声明过思考等级”的模型补声明。
 *
 * `reasoningEfforts: false` 是“非推理模型”的显式声明，同样视为已有声明，绝不覆盖。
 *
 * @param {unknown} model - 用户层的一个模型条目。
 * @param {boolean} [includeUnknown] - 家族认不出来时，是否退到 {@link GENERIC_EFFORTS}。
 * @returns {Record<string, unknown> | undefined} 补全后的条目；无需改动时为 undefined。
 */
function fillEfforts (model, includeUnknown = false) {
  if (!isRecord(model)) return undefined
  if (model.reasoningEfforts !== undefined) return undefined
  const suggested = suggestEfforts(model.id)
  if (suggested !== undefined) return { ...model, reasoningEfforts: suggested }
  // 官方认得出、但确认不支持档位的模型，**连通用模板也不写** ——
  // 这正是插件刻意避免的那次有害写入，不能靠界面上少显示一个按钮来兜底。
  if (noEffortReason(model.id) !== undefined) return undefined
  if (!includeUnknown) return undefined
  const generic = sanitizeEfforts(GENERIC_EFFORTS)
  return generic === undefined ? undefined : { ...model, reasoningEfforts: generic }
}

/**
 * 读取 llm-pi-ai 的当前解析值、用户层与 revision。
 *
 * @returns {{ settings: object, descriptor?: object, resolved: object, user?: object } | undefined}
 *   宿主没有 settings 服务时为 undefined。
 */
function snapshot (ctx) {
  const settings = ctx.get('settings')
  if (settings === undefined || typeof settings.get !== 'function') return undefined
  const descriptor = typeof settings.describe === 'function'
    ? settings.describe().find(entry => entry.ns === NS)
    : undefined
  let resolved
  try {
    resolved = settings.get(NS)
  } catch {
    resolved = undefined
  }
  return { settings, descriptor, resolved, user: descriptor?.user }
}

/**
 * 构建界面所需的只读视图。
 *
 * 写入许可（`writable`）刻意保守：只有该路由出现在用户层、且解析后的模型集合
 * 与用户层的模型集合一致时才允许写。否则写回 `models` 数组会把底座层声明的
 * 模型固化成用户层内容（数组是整体覆盖，不是深合并）。
 */
function buildView (ctx) {
  const snap = snapshot(ctx)
  const resolvedProviders = isRecord(snap?.resolved?.providers) ? snap.resolved.providers : {}
  const userProviders = isRecord(snap?.user?.providers) ? snap.user.providers : {}

  const routes = Object.keys(resolvedProviders).map(route => {
    const merged = isRecord(resolvedProviders[route]) ? resolvedProviders[route] : {}
    const userProfile = isRecord(userProviders[route]) ? userProviders[route] : undefined
    const resolvedModels = Array.isArray(merged.models) ? merged.models.filter(isRecord) : []
    const userModels = userProfile !== undefined && Array.isArray(userProfile.models)
      ? userProfile.models.filter(isRecord)
      : []
    const userIds = new Set(userModels.map(model => model.id).filter(nonEmptyString))
    const baseOnly = resolvedModels.filter(model => !userIds.has(model.id))

    // 窗口/输出上限一律以**用户层**是否显式声明为准：写回写的是用户层，而 resolved
    // 里的值可能只是路由 defaultContextWindow / defaultMaxTokens 的回退 —— 拿它
    // 当“已经声明”会让对齐永远不触发。
    const userById = new Map()
    for (const model of userModels) {
      if (nonEmptyString(model.id)) userById.set(model.id, model)
    }
    const modelId = model => (typeof model.id === 'string' ? model.id : String(model.id))
    const needsCapacity = model => {
      const userModel = userById.get(modelId(model))
      return userModel === undefined
        || userModel.contextWindow === undefined
        || userModel.maxTokens === undefined
    }

    return {
      route,
      displayName: nonEmptyString(merged.displayName) ? merged.displayName : route,
      baseURL: nonEmptyString(merged.baseURL) ? merged.baseURL : '',
      api: nonEmptyString(merged.api) ? merged.api : '',
      modelCount: resolvedModels.length,
      undimensioned: resolvedModels.filter(needsCapacity).length,
      writable: userProfile !== undefined && baseOnly.length === 0,
      blockedReason: userProfile === undefined
        ? '该路由未在用户配置层定义'
        : (baseOnly.length > 0 ? '该路由含由底座层声明的模型，写回会固化它们' : undefined),
      models: resolvedModels.map(model => {
        const id = modelId(model)
        const userModel = userById.get(id)
        const suggested = model.reasoningEfforts === undefined ? (suggestEfforts(id) ?? null) : null
        // 「官方认得出但确认不支持档位」必须和「认不出家族」分开报给界面：
        // 前者是刻意不写，后者才需要用户决定。否则界面会把前者也列进「用通用模板补全」。
        const unsupported = model.reasoningEfforts === undefined && suggested === null
          ? (noEffortReason(id) ?? null)
          : null
        const vision = visionSupport(id)
        return {
          id,
          declared: model.reasoningEfforts !== undefined,
          suggested,
          unsupported,
          hasContextWindow: userModel?.contextWindow !== undefined,
          hasMaxTokens: userModel?.maxTokens !== undefined,
          // 输入模态以**用户层**是否声明为准：写回写的是用户层，拿 resolved 里
          // 目录回退出来的值当“已声明”，会让补全永远不触发。
          inputDeclared: declaredInput(userModel) !== undefined,
          declaresImage: declaresImage(userModel),
          // 只有官方认得出支持图像的才给建议；认不出为 null，界面不提供补全。
          vision: vision === undefined ? null : vision.source
        }
      })
    }
  })

  return { routes, namespace: NS, defaultModel: defaultModelDiagnosis(ctx) }
}

/**
 * 取一条路由的 API Key。
 *
 * 只在向该路由自己的 baseURL 发请求时使用，且只经 credentials 服务按引用解析，
 * 不做任何缓存、记录或外发。
 */
async function resolveApiKey (ctx, ref) {
  if (!nonEmptyString(ref)) return undefined
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.resolve !== 'function') return undefined
  try {
    const hit = await credentials.resolve(ref)
    return nonEmptyString(hit?.value) ? hit.value : undefined
  } catch {
    return undefined
  }
}

/**
 * 读一个中转站的 `/models` 列表。
 *
 * 兼容 OpenAI 风格的 `{ data: [...] }`（条目可以是字符串或 `{ id }`）。
 */
async function fetchModelIds (baseURL, apiKey) {
  const url = baseURL.replace(/\/+$/, '') + '/models'
  const headers = { accept: 'application/json' }
  if (apiKey !== undefined) headers.authorization = 'Bearer ' + apiKey

  let response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    throw new Error('请求 ' + url + ' 失败：' + (error instanceof Error ? error.message : String(error)))
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? '（检查该路由的 API Key）' : ''
    throw new Error('中转站返回 HTTP ' + String(response.status) + hint)
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new Error('模型列表不是 JSON')
  }
  if (!isRecord(body) || !Array.isArray(body.data)) throw new Error('模型列表不是 { data: [...] } 结构')

  const ids = body.data
    .map(entry => {
      if (typeof entry === 'string') return entry
      if (isRecord(entry) && nonEmptyString(entry.id)) return entry.id
      return undefined
    })
    .filter(nonEmptyString)

  const unique = [...new Set(ids)]
  if (unique.length === 0) throw new Error('模型列表为空')
  return unique
}

/**
 * 从一条回复里抠出一段可读文本，用来证明模型真的产出了内容。
 *
 * 三种形态都要认：OpenAI Chat Completions 的 `choices[].message.content`
 * （可能是字符串，也可能是 `[{type:'text',text}]` 数组）、只回了思考内容的
 * `reasoning_content`，以及 Responses API 的 `output[].content[].text`。
 */
function extractReplyText (body) {
  if (!isRecord(body)) return ''

  const fromParts = parts => {
    if (typeof parts === 'string') return parts
    if (!Array.isArray(parts)) return ''
    return parts
      .map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }

  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined
  if (isRecord(choice)) {
    const message = isRecord(choice.message) ? choice.message : undefined
    const text = fromParts(message?.content)
    if (text !== '') return text
    // 强制思考的模型可能把内容全放进 reasoning_content —— 那同样证明调用是通的。
    if (typeof message?.reasoning_content === 'string') return message.reasoning_content
    if (typeof choice.text === 'string') return choice.text
  }

  if (typeof body.output_text === 'string' && body.output_text !== '') return body.output_text
  if (Array.isArray(body.output)) {
    const text = body.output
      .map(item => (isRecord(item) ? fromParts(item.content) : ''))
      .join('')
    if (text !== '') return text
  }
  return ''
}

/** 从 usage 里取 token 消耗；两种 API 的字段名不同，取到哪个算哪个。 */
function extractUsage (body) {
  const usage = isRecord(body?.usage) ? body.usage : undefined
  if (usage === undefined) return undefined
  const input = usage.prompt_tokens ?? usage.input_tokens
  const output = usage.completion_tokens ?? usage.output_tokens
  if (!Number.isFinite(input) && !Number.isFinite(output)) return undefined
  return {
    ...(Number.isFinite(input) ? { inputTokens: input } : {}),
    ...(Number.isFinite(output) ? { outputTokens: output } : {})
  }
}

/**
 * 把一次探测失败翻译成一句能指导下一步的中文。
 *
 * 分开说是有用的：401 要改密钥，404 说明这个模型在这条渠道上没有，
 * 429 是限流（过会儿再试），超时则可能只是排队 —— 处理方式完全不同。
 *
 * **上游自己给的原因优先**：实测踩到过 —— 中转站对「余额不足」也回 403，
 * 若照状态码猜就会说成「密钥无效」，把人引去改密钥，而真正该做的是充值。
 * 所以只要上游给了 message，就把它放在最前面；状态码的解释退为补充，
 * 而且措辞要留余地（403 既可能是密钥，也可能是账户/权限问题）。
 */
function describeProbeFailure (status, detail) {
  const upstream = nonEmptyString(detail) ? '上游说：' + detail : ''
  let hint
  if (status === 401) hint = '密钥无效或未提供（HTTP 401）'
  else if (status === 403) hint = '上游拒绝了这次调用（HTTP 403，常见原因：余额不足、密钥无权调用该模型）'
  else if (status === 404) hint = '该渠道没有这个模型，或端点路径不对（HTTP 404）'
  else if (status === 429) hint = '被上游限流，稍后再试（HTTP 429）'
  else if (status === 400) hint = '上游认为请求不合法（HTTP 400）'
  else if (typeof status === 'number' && status >= 500) hint = '上游服务端故障（HTTP ' + String(status) + '）'
  else hint = 'HTTP ' + String(status)

  return upstream === '' ? hint : upstream + '；' + hint
}

/**
 * 从错误响应体里抠一句上游自己给的原因（比 HTTP 状态码有用得多）。
 */
function extractErrorDetail (text) {
  if (!nonEmptyString(text)) return ''
  try {
    const body = JSON.parse(text)
    const message = body?.error?.message ?? body?.message ?? body?.error
    if (typeof message === 'string') return message.slice(0, 200)
  } catch {
    // 不是 JSON：原样截一段，总比什么都不说强。
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * 探测一个模型是否真的可用 —— 发一句 `hi`，看能不能拿回回复。
 *
 * **为什么值得做**：中转站的 `/models` 只说明它**列出了**这个模型，不说明它真的**调得通**。
 * 渠道掉线、密钥没开通、模型已下线，都会让条目继续留在列表里 —— 只有真发一次请求
 * 才能把「列了」和「能用」分开。这正是 `/models` 与 `discoverModels` 都回答不了的问题。
 *
 * **三条硬约束**：
 *   - **只读**：不碰 settings，一个字段都不写。探测结果只回报给界面；
 *   - **必须由你点**：每次探测都是一次真实的上游请求（会计费），
 *     所以它不参与任何自动补全，也不在刷新时自动跑；
 *   - 输入固定为最短的 `hi`，`max_tokens` 压到 {@link PROBE_MAX_TOKENS}。
 *
 * 永远 resolve：失败作为一种**结果**返回，批量探测才能把每条都汇总给界面，
 * 而不是让第一个失败把整批带崩。
 *
 * @param {{ baseURL: string, api: string, apiKey?: string }} target - 该路由的调用参数。
 * @param {string} modelId - 要探测的模型 id。
 * @returns {Promise<object>} `{ id, ok, ms, reply?, usage?, reason?, status? }`。
 */
async function probeModel (target, modelId) {
  const started = Date.now()
  const elapsed = () => Date.now() - started

  // 只有 OpenAI 兼容的两种协议能这样直接探。别的协议（Anthropic Messages 等）
  // 报文形状不同，硬拼一个请求只会得到误导性的失败 —— 如实说明不支持。
  const api = target.api === '' ? 'openai-completions' : target.api
  if (api !== 'openai-completions' && api !== 'openai-responses') {
    return { id: modelId, ok: false, ms: 0, reason: '暂不支持探测 api 类型 "' + api + '"，只支持 OpenAI 兼容的 openai-completions / openai-responses' }
  }

  const url = target.baseURL.replace(/\/+$/, '') + (api === 'openai-responses' ? '/responses' : '/chat/completions')
  const headers = { 'content-type': 'application/json', accept: 'application/json' }
  if (target.apiKey !== undefined) headers.authorization = 'Bearer ' + target.apiKey
  const body = api === 'openai-responses'
    ? { model: modelId, input: PROBE_PROMPT, max_output_tokens: PROBE_MAX_TOKENS }
    : { model: modelId, messages: [{ role: 'user', content: PROBE_PROMPT }], max_tokens: PROBE_MAX_TOKENS }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return {
      id: modelId,
      ok: false,
      ms: elapsed(),
      reason: timedOut
        ? '超过 ' + String(Math.round(PROBE_TIMEOUT_MS / 1000)) + ' 秒没有响应（强制思考的模型首个 token 可能较慢，可重试一次）'
        : '请求发不出去：' + (error instanceof Error ? error.message : String(error))
    }
  }

  const text = await response.text().catch(() => '')
  if (!response.ok) {
    return {
      id: modelId,
      ok: false,
      ms: elapsed(),
      status: response.status,
      reason: describeProbeFailure(response.status, extractErrorDetail(text))
    }
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { id: modelId, ok: false, ms: elapsed(), reason: '上游回了非 JSON 内容，无法确认模型是否真的产出' }
  }

  // HTTP 200 不等于成功：中转站有时把上游错误包在 200 的 body 里（OpenAI 兼容端点
  // 的 error 字段）。这种「假成功」正是探测要抓的。
  if (isRecord(parsed.error)) {
    const message = typeof parsed.error.message === 'string' ? parsed.error.message : JSON.stringify(parsed.error).slice(0, 200)
    return { id: modelId, ok: false, ms: elapsed(), reason: '上游在 200 响应里返回了错误：' + message }
  }

  const reply = extractReplyText(parsed)
  if (reply === '') {
    return { id: modelId, ok: false, ms: elapsed(), reason: '调用通了，但回复里没有任何文本内容（可能是空回复或响应结构不认识）' }
  }

  const usage = extractUsage(parsed)
  return {
    id: modelId,
    ok: true,
    ms: elapsed(),
    reply: reply.replace(/\s+/g, ' ').trim().slice(0, 80),
    ...(usage === undefined ? {} : { usage })
  }
}

/**
 * 按固定并发跑一批任务，保持结果顺序与输入一致。
 *
 * 为什么限并发：一次探测几十个模型时，全放出去等于对中转站发一轮并发冲击 ——
 * 既容易被限流（429），也会把「限流」误报成「模型不可用」。
 */
async function mapLimit (items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * 批量探测一条路由上的模型。
 *
 * @param {string} route - 路由名。
 * @param {string[]} [only] - 只探这些模型 id；省略则探该路由用户层里的全部模型。
 */
async function probeRoute (ctx, route, only) {
  const snap = snapshot(ctx)
  if (snap === undefined) throw new Error('宿主没有 settings 服务')

  const userProviders = isRecord(snap.user?.providers) ? snap.user.providers : {}
  const userProfile = isRecord(userProviders[route]) ? userProviders[route] : undefined
  if (userProfile === undefined) throw new Error('路由 "' + route + '" 不在用户配置层')
  if (!Array.isArray(userProfile.models)) throw new Error('路由 "' + route + '" 在用户层没有 models 数组')

  const resolvedProfile = isRecord(snap.resolved?.providers?.[route]) ? snap.resolved.providers[route] : {}
  const baseURL = nonEmptyString(userProfile.baseURL)
    ? userProfile.baseURL
    : (nonEmptyString(resolvedProfile.baseURL) ? resolvedProfile.baseURL : '')
  if (baseURL === '') throw new Error('路由 "' + route + '" 没有 baseURL')

  const api = nonEmptyString(userProfile.api)
    ? userProfile.api
    : (nonEmptyString(resolvedProfile.api) ? resolvedProfile.api : '')

  const configured = userProfile.models
    .filter(isRecord)
    .map(model => model.id)
    .filter(nonEmptyString)
  const wanted = Array.isArray(only) && only.length > 0
    ? configured.filter(id => only.includes(id))
    : configured
  if (wanted.length === 0) throw new Error('该路由没有可探测的模型')

  const capped = wanted.slice(0, PROBE_MAX_MODELS)
  const apiKeyRef = nonEmptyString(userProfile.apiKeyEnv) ? userProfile.apiKeyEnv : resolvedProfile.apiKeyEnv
  const apiKey = await resolveApiKey(ctx, apiKeyRef)

  const results = await mapLimit(capped, PROBE_CONCURRENCY, id => probeModel({ baseURL, api, apiKey }, id))
  logLine(ctx, 'info', 'relay-toolkit: 探测 %s 的 %d 个模型，%d 个可用', route, results.length, results.filter(item => item.ok).length)

  return {
    route,
    baseURL,
    api: api === '' ? 'openai-completions' : api,
    prompt: PROBE_PROMPT,
    total: wanted.length,
    truncated: wanted.length > capped.length,
    results,
    okCount: results.filter(item => item.ok).length,
    failedCount: results.filter(item => !item.ok).length
  }
}

/**
 * 从一个中转站同步缺失的模型。
 *
 * 只把用户层已有的模型行原样保留、在尾部追加新模型；新模型会带上能确认的
 * 思考等级建议。不会删除任何条目，也不会改写已有条目的字段。
 */
async function syncRoute (ctx, route) {
  const snap = snapshot(ctx)
  if (snap === undefined) throw new Error('宿主没有 settings 服务')

  const userProviders = isRecord(snap.user?.providers) ? snap.user.providers : {}
  const userProfile = isRecord(userProviders[route]) ? userProviders[route] : undefined
  if (userProfile === undefined) {
    throw new Error('路由 "' + route + '" 不在用户配置层；为避免覆盖底座配置，未做修改')
  }
  if (!Array.isArray(userProfile.models)) {
    throw new Error('路由 "' + route + '" 在用户层没有 models 数组；为避免覆盖底座配置，未做修改')
  }

  const resolvedProfile = isRecord(snap.resolved?.providers?.[route]) ? snap.resolved.providers[route] : {}
  const baseURL = nonEmptyString(userProfile.baseURL)
    ? userProfile.baseURL
    : (nonEmptyString(resolvedProfile.baseURL) ? resolvedProfile.baseURL : '')
  if (baseURL === '') throw new Error('路由 "' + route + '" 没有 baseURL')

  const apiKeyRef = nonEmptyString(userProfile.apiKeyEnv) ? userProfile.apiKeyEnv : resolvedProfile.apiKeyEnv
  const apiKey = await resolveApiKey(ctx, apiKeyRef)
  const remoteIds = await fetchModelIds(baseURL, apiKey)

  const existing = new Set(userProfile.models.filter(isRecord).map(model => model.id).filter(nonEmptyString))
  const added = remoteIds.filter(id => !existing.has(id))
  if (added.length === 0) {
    return { route, total: remoteIds.length, added, note: '没有缺失的模型' }
  }

  const nextModels = [
    ...userProfile.models,
    ...added.map(id => {
      const row = { id, name: id }
      const suggested = suggestEfforts(id)
      if (suggested !== undefined) row.reasoningEfforts = suggested
      return row
    })
  ]

  await snap.settings.update(NS, { providers: { [route]: { models: nextModels } } }, snap.descriptor?.revision)
  return { route, total: remoteIds.length, added }
}

/**
 * 给缺少 `reasoningEfforts` 的模型补上声明。
 *
 * @param {string} [only] - 只处理这一条路由；省略则处理全部。
 * @param {boolean} [includeUnknown] - 是否对认不出家族的模型使用通用模板。
 */
async function autofill (ctx, only, includeUnknown = false) {
  const snap = snapshot(ctx)
  if (snap === undefined) throw new Error('宿主没有 settings 服务')

  const userProviders = isRecord(snap.user?.providers) ? snap.user.providers : {}
  const patchProviders = {}
  const fills = []
  const skipped = []

  for (const [route, profile] of Object.entries(userProviders)) {
    if (only !== undefined && route !== only) continue
    if (!isRecord(profile) || !Array.isArray(profile.models)) continue

    let changed = false
    const nextModels = profile.models.map(model => {
      const filled = fillEfforts(model, includeUnknown)
      if (filled === undefined) {
        if (isRecord(model) && model.reasoningEfforts === undefined) {
          skipped.push({ route, id: typeof model.id === 'string' ? model.id : String(model.id) })
        }
        return model
      }
      changed = true
      fills.push({ route, id: model.id, unknown: suggestEfforts(model.id) === undefined })
      return filled
    })

    if (changed) patchProviders[route] = { models: nextModels }
  }

  if (Object.keys(patchProviders).length === 0) {
    return { fills, skipped, note: '没有需要补全的模型' }
  }

  await snap.settings.update(NS, { providers: patchProviders }, snap.descriptor?.revision)
  logLine(ctx, 'info', 'relay-toolkit: 补全 %d 个模型的思考等级声明', fills.length)
  return { fills, skipped }
}

/**
 * 用 DSH 自己的模型发现，问出一条路由的权威容量。
 *
 * 这是“对齐官方”的正路，而且**不需要本插件维护任何规格数字**：
 * `ctx.llm.discoverModels()` 在该路由命中**已装目录**时直接返回目录条目（官方
 * pi-ai 目录里同 id 的 `contextWindow` / `maxTokens`），目录里没有才回到上游
 * `/models`，并且已经兼容 `context_length`、`max_input_tokens`、`limit.context`、
 * `top_provider.max_completion_tokens` 等多种拼写。
 *
 * 凭据也由它按该路由的 `apiKeyEnv` 自行解析，插件不经手。
 */
async function discoverRoute (ctx, route) {
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  if (llm === undefined || typeof llm.discoverModels !== 'function') {
    throw new Error('宿主没有可用的 llm.discoverModels')
  }
  const answer = await llm.discoverModels(NS, { provider: route })
  return Array.isArray(answer) ? answer.filter(isRecord) : []
}

/** 容量值判定：schema 要求 `step(1).min(1)`，所以只接受正整数。 */
function positiveInteger (value) {
  return Number.isInteger(value) && value > 0
}

/**
 * 对齐上下文窗口与最大输出上限。
 *
 * 把发现到的权威容量写进用户层，只补用户层里**没写过**的字段，绝不覆盖你已经
 * 填好的数字；每条路由只做一次发现，全部改动一次写入并带上 revision。
 *
 * @param {string} [only] - 只处理这一条路由；省略则处理全部。
 */
async function alignCapacity (ctx, only) {
  const snap = snapshot(ctx)
  if (snap === undefined) throw new Error('宿主没有 settings 服务')

  const userProviders = isRecord(snap.user?.providers) ? snap.user.providers : {}
  const patchProviders = {}
  const fills = []
  const skipped = []
  const discoveryErrors = []

  for (const [route, profile] of Object.entries(userProviders)) {
    if (only !== undefined && route !== only) continue
    if (!isRecord(profile) || !Array.isArray(profile.models)) continue

    let discovered = []
    try {
      discovered = await discoverRoute(ctx, route)
    } catch (error) {
      // 发现失败不再直接放弃：内置规格表仍可能补上数值，原因记下来交给界面。
      discoveryErrors.push({ route, reason: error instanceof Error ? error.message : String(error) })
    }

    const byId = new Map()
    for (const model of discovered) {
      if (nonEmptyString(model.id)) byId.set(model.id, model)
    }

    let changed = false
    const nextModels = profile.models.map(model => {
      if (!isRecord(model) || !nonEmptyString(model.id)) return model
      const found = byId.get(model.id)
      const spec = specFor(model.id)

      // 每一项都先信发现结果（官方目录或上游），它没给才退到内置规格表。
      const patch = {}
      let usedSpec = false
      if (model.contextWindow === undefined) {
        if (positiveInteger(found?.contextWindow)) patch.contextWindow = found.contextWindow
        else if (positiveInteger(spec?.contextWindow)) {
          patch.contextWindow = spec.contextWindow
          usedSpec = true
        }
      }
      if (model.maxTokens === undefined) {
        if (positiveInteger(found?.maxTokens)) patch.maxTokens = found.maxTokens
        else if (positiveInteger(spec?.maxTokens)) {
          patch.maxTokens = spec.maxTokens
          usedSpec = true
        }
      }

      if (Object.keys(patch).length === 0) {
        skipped.push({
          route,
          id: model.id,
          reason: found === undefined && spec === undefined
            ? '发现结果里没有这个模型，内置规格表也认不出'
            : '没有可用的容量数值'
        })
        return model
      }
      changed = true
      fills.push({
        route,
        id: model.id,
        ...patch,
        source: usedSpec ? 'spec' : 'discovery',
        ...(usedSpec ? { specSource: spec.source, specChecked: spec.checked } : {})
      })
      return { ...model, ...patch }
    })

    if (changed) patchProviders[route] = { models: nextModels }
  }

  if (Object.keys(patchProviders).length === 0) {
    return { fills, skipped, discoveryErrors, note: '没有可对齐的窗口/输出上限' }
  }

  await snap.settings.update(NS, { providers: patchProviders }, snap.descriptor?.revision)
  logLine(
    ctx,
    'info',
    'relay-toolkit: 对齐 %d 个模型的窗口与输出上限（%d 个来自内置规格表）',
    fills.length,
    fills.filter(fill => fill.source === 'spec').length
  )
  return { fills, skipped, discoveryErrors }
}

/**
 * 补全模型条目的图像输入声明。
 *
 * 只写用户层、只填空缺：已经有非空 `input` 的条目一律跳过 —— 哪怕它只写了
 * `text`，那也是你明确表态过，插件不替你改。认不出官方能力的模型同样跳过。
 *
 * **刻意不参与自动补全，必须由你点**：声明图像能力只代表模型本身能收图，
 * 中转站是否真的向上游透传要自己实测；写错了的表现是请求被上游拒绝，
 * 而不是静默降级 —— 但一次白跑的对话已经够烦了。
 *
 * @param {string} [only] - 只处理这一条路由；省略则处理全部。
 */
async function alignModalities (ctx, only) {
  const snap = snapshot(ctx)
  if (snap === undefined) throw new Error('宿主没有 settings 服务')

  const userProviders = isRecord(snap.user?.providers) ? snap.user.providers : {}
  const patchProviders = {}
  const fills = []
  const skipped = []

  for (const [route, profile] of Object.entries(userProviders)) {
    if (only !== undefined && route !== only) continue
    if (!isRecord(profile) || !Array.isArray(profile.models)) continue

    let changed = false
    const nextModels = profile.models.map(model => {
      if (!isRecord(model) || !nonEmptyString(model.id)) return model
      // 已有声明（含只写 text）：用户的明确表态，绝不覆盖。
      if (declaredInput(model) !== undefined) return model

      const vision = visionSupport(model.id)
      if (vision === undefined) {
        skipped.push({ route, id: model.id, reason: '官方能力表里认不出这个模型，未写入' })
        return model
      }
      changed = true
      fills.push({ route, id: model.id, input: [...VISION_INPUT], source: vision.source, checked: SPEC_CHECKED })
      return { ...model, input: [...VISION_INPUT] }
    })

    if (changed) patchProviders[route] = { models: nextModels }
  }

  if (Object.keys(patchProviders).length === 0) {
    return { fills, skipped, note: '没有可补全的图像输入声明' }
  }

  await snap.settings.update(NS, { providers: patchProviders }, snap.descriptor?.revision)
  logLine(ctx, 'info', 'relay-toolkit: 补全 %d 个模型的图像输入声明', fills.length)
  return { fills, skipped }
}

/**
 * 默认模型的多模态诊断 —— 这就是「模型支持却读不了图」的实际命中点。
 *
 * `read_image` 这类工具看的是**当前默认模型**的能力声明，而默认模型走哪条路由由
 * `agent-default-model` 命名空间决定。那条路由的模型条目没声明 `input` 时，
 * 模型被当纯文本，工具在发请求之前就拒了 —— 报错落在工具层，跟模型名无关。
 *
 * 能力判定用**生效条目**（resolved）：真正起作用的是解析结果，不是用户层写没写。
 * 但能不能补另算 —— 那取决于该模型条目在不在用户层。
 */
function defaultModelDiagnosis (ctx) {
  const snap = snapshot(ctx)
  if (snap === undefined) return undefined

  let selection
  try {
    selection = snap.settings.get(DEFAULT_MODEL_NS)
  } catch {
    return undefined
  }
  if (!isRecord(selection)) return undefined
  const provider = selection.provider
  const model = selection.model
  if (!nonEmptyString(provider) || !nonEmptyString(model)) return undefined

  const resolvedProviders = isRecord(snap.resolved?.providers) ? snap.resolved.providers : {}
  const resolvedProfile = isRecord(resolvedProviders[provider]) ? resolvedProviders[provider] : undefined
  const resolvedModels = resolvedProfile !== undefined && Array.isArray(resolvedProfile.models)
    ? resolvedProfile.models.filter(isRecord)
    : []
  const effective = resolvedModels.find(item => item.id === model)

  const userProviders = isRecord(snap.user?.providers) ? snap.user.providers : {}
  const userProfile = isRecord(userProviders[provider]) ? userProviders[provider] : undefined
  const userModels = userProfile !== undefined && Array.isArray(userProfile.models)
    ? userProfile.models.filter(isRecord)
    : []

  return {
    provider,
    model,
    // 生效条目在不在（不在说明这条路由/模型根本没解析出来）。
    resolved: effective !== undefined,
    // 生效声明里有没有 image —— 这才是工具侧真正读到的能力。
    declaresImage: declaresImage(effective),
    // 用户层有没有这条模型条目（决定插件能不能替它补声明）。
    inUserLayer: userModels.some(item => item.id === model),
    visionCapable: visionSupport(model) !== undefined
  }
}

/** 请求是否来自本机（路由只服务本机页面）。 */
function isLoopback (req) {
  const address = req.socket?.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** 发送 JSON 响应。 */
function sendJson (res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

/** 读取并解析 JSON 请求体。 */
async function readJsonBody (req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** 路由入口：`/api/relay-toolkit/{status|sync|autofill|align|modalities}`。 */
async function handleRequest (ctx, req, res) {
  if (!isLoopback(req)) {
    sendJson(res, 403, { ok: false, error: { message: '仅允许本机访问' } })
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const endpoint = url.pathname.slice(BASE_PATH.length).replace(/^\/+|\/+$/g, '')

  try {
    if (req.method === 'GET' && endpoint === 'status') {
      sendJson(res, 200, { ok: true, value: buildView(ctx) })
      return
    }
    if (req.method === 'POST' && endpoint === 'sync') {
      const body = await readJsonBody(req)
      if (!nonEmptyString(body.route)) throw new Error('缺少 route')
      sendJson(res, 200, { ok: true, value: await syncRoute(ctx, body.route) })
      return
    }
    if (req.method === 'POST' && endpoint === 'autofill') {
      const body = await readJsonBody(req)
      const only = nonEmptyString(body.route) ? body.route : undefined
      // includeUnknown 只有界面上的显式按钮才会带：默认绝不对认不出的模型下手。
      sendJson(res, 200, { ok: true, value: await autofill(ctx, only, body.includeUnknown === true) })
      return
    }
    if (req.method === 'POST' && endpoint === 'align') {
      const body = await readJsonBody(req)
      const only = nonEmptyString(body.route) ? body.route : undefined
      sendJson(res, 200, { ok: true, value: await alignCapacity(ctx, only) })
      return
    }
    if (req.method === 'POST' && endpoint === 'modalities') {
      const body = await readJsonBody(req)
      const only = nonEmptyString(body.route) ? body.route : undefined
      sendJson(res, 200, { ok: true, value: await alignModalities(ctx, only) })
      return
    }
    // 探测是唯一会向上游发**计费请求**的端点，而且只读不写配置。
    // 只接受显式指定的单条路由，避免一次点击把全部路由都探一遍。
    if (req.method === 'POST' && endpoint === 'probe') {
      const body = await readJsonBody(req)
      if (!nonEmptyString(body.route)) throw new Error('缺少 route')
      const only = Array.isArray(body.models)
        ? body.models.filter(nonEmptyString)
        : undefined
      sendJson(res, 200, { ok: true, value: await probeRoute(ctx, body.route, only) })
      return
    }
    sendJson(res, 404, { ok: false, error: { message: '未知端点 "' + endpoint + '"' } })
  } catch (error) {
    // 业务失败也回 200 + ok:false，界面据此显示原因。
    sendJson(res, 200, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
  }
}

export const name = 'dsh-relay-toolkit'

/** 模块级不声明任何依赖：没有 web 服务的组合也应能加载本插件。 */
export const inject = []

/**
 * 记一行日志。
 *
 * 两个坑都是实测出来的：
 *   - cordis 的 logger 是上下文**内置属性**（`ctx.logger`），不是可解析的服务 ——
 *     `ctx.get('logger')` 返回 undefined，用它记日志会一声不响地全部丢掉
 *     （本插件第一版就是这么瞎的，重启后日志里一条都找不到）；
 *   - 但不能写成裸的 `ctx.logger.info(…)`：上下文是 Proxy，访问未声明的**服务**
 *     属性会抛异常，可选链拦不住。logger 是内置属性，这里再用 try 兜一层 ——
 *     日志失败永远不该拖垮插件本身。
 */
function logLine (ctx, level, ...args) {
  try {
    const logger = ctx.logger
    const write = logger?.[level]
    if (typeof write === 'function') write.apply(logger, args)
  } catch {
    // 记不了就算了
  }
}

/**
 * 挂载宿主路由。
 *
 * 对 webServer / httpServer 各安排一次嵌套注入，先到者注册并占用；
 * 两个名字在真实发布里都存在过，只等其中一个正是面板 404 的经典成因。
 */
export function apply (ctx) {
  if (typeof ctx.inject !== 'function') {
    logLine(ctx, 'warn', 'relay-toolkit: 该 Cordis 没有 ctx.inject，无法挂载路由')
    return
  }

  logLine(ctx, 'info', 'relay-toolkit: waiting for %s to serve %s', WEB_SERVER_NAMES.join(' or '), BASE_PATH)

  let attached = false
  for (const serviceName of WEB_SERVER_NAMES) {
    ctx.inject([serviceName], scoped => {
      const server = scoped?.[serviceName]
      if (attached || server === undefined || typeof server.register !== 'function') return
      attached = true
      scoped.effect(
        () => server.register({
          kind: 'prefix',
          path: BASE_PATH,
          // 返回 Promise：webserver 以 `await route.handler(req, res)` 派发，
          // 让响应生命周期与错误都留在它可见的范围内。
          handler: (req, res) => handleRequest(scoped, req, res)
        }),
        'relay-toolkit: ' + BASE_PATH + ' routes'
      )
      logLine(ctx, 'info', 'relay-toolkit: serving %s via %s', BASE_PATH, serviceName)
    })
  }
}

export default { name, inject, apply }
