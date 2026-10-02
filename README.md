# dsh-relay-toolkit

给 **DeepSeek Harness（DSH）0.2** 用的中转站维护插件：把中转站 `/models` 里缺失的模型合并进
`llm-pi-ai` 路由，给缺少 `reasoningEfforts` 声明的模型补上思考等级，把上下文窗口与最大
输出上限对齐到官方目录（或上游）给出的数值，补上缺失的图像输入声明（多模态），
并**实测每个模型是否真的调得通**。

> 适配 **DSH 0.2.0-rc.2**。0.1.5-rc.1 时代的版本在 0.2 上会**静默失效**
> （0.2 移除了 `settings.get(ns)`）—— 症状是设置页区块一片空白却没有任何报错。
> 详见「兼容性 → 0.1.5-rc.1 → 0.2.0-rc.2 改了什么」。

设置页会多出一个「中转站工具」区块，每条路由一张卡片。按钮随该路由的实际情况出现：
**同步模型**与**测试连通性**恒在，**补全思考等级**、**用通用模板补全**、**对齐窗口与输出**、
**补全图像声明**按需出现，卡片底部另有一个**刷新**。若当前默认模型缺图像声明，
区块顶部会单独告警 —— 那正是「模型支持却读不了图」的直接成因。

## 明确不做的事

- **不碰 `service_tier` / Fast 档位。** OpenAI 兼容中转站普遍接受并静默忽略该字段
  （很多还会把非法档位照单全收），把它包装成「加速开关」是不诚实的。
- **不按模型名字猜能力。** 只覆盖能确认的家族（deepseek / glm / kimi / qwen / hy3）；
  认不出来的模型在界面上标为「未识别」，一个字段都不写。
- **不改 `baseURL`、`apiKeyEnv`、`compat`，也不删任何模型条目。**
- **不发送遥测。** 对外请求只有两类，都发往你在 `llm-pi-ai` 里配置的那条路由自己的
  `baseURL`：向 `/models` 发 GET（带该路由凭据引用解析出的 Key），
  以及**你点「测试连通性」时**向 `/chat/completions`（或 `/responses`）发的那一句 `hi`。

## 行为保证

| 保证 | 实现方式 |
|---|---|
| 只写用户配置层 | 只改 `settings.describe()` 里 `user` 层的 `providers[route].models`（0.2 起描述符是唯一读取入口） |
| 只填空缺，绝不覆盖 | 已有 `reasoningEfforts`（含 `reasoningEfforts: false`）一律跳过 |
| 不固化底座层配置 | 若某路由的生效模型集合不等于用户层集合（含底座声明的模型），该路由禁用写入并在界面说明原因 |
| 不覆盖并发修改 | 每次 `settings.update` 都带上读取时的 `revision` |
| 只服务本机 | 路由拒绝非 loopback 来源的请求 |
| 只写合法声明 | 建议值经 `LEVELS` 白名单过滤；等级键只能是 `off/minimal/low/medium/high/xhigh/max`，值只能是该等级的线上拼写（仅 `off` 可为 `null`），且至少一个非 `off` 等级 |
| 不给官方不支持的模型写档位 | 官方确认不支持 `reasoning_effort` 的家族一个字段都不写，连「用通用模板补全」也绕开它们（见下方「官方不支持档位 ≠ 认不出家族」） |
| 不猜多模态能力 | 图像输入声明先信 `discoverModels` 的 `inputModalities`，没给才退回内置官方能力表；两处都认不出就不写。已声明 `input` 的条目（含只写 `text`）一律不动 |
| 探测绝不写配置 | `/probe` 只发一句 `hi` 并回报结果，不调用 `settings.update`；对不可写的路由同样可用 |
| 探测不误报限流 | 单次最多 50 个模型、并发 3，避免把「被上游限流」误报成「模型不可用」 |

## 安装

需要 **Node 22 或更高**（宿主用到 `AbortSignal.timeout` 与顶层 `await`；DSH 0.2 自带的
运行时是 Node 24，直接用它即可）。

把仓库放到任意位置，然后按你的实际路径安装 —— 下面这条是示例路径，**换成你自己的**：

```sh
dsh plugin --profile desktop add file:C:/Users/<你>/dsh-plugins/dsh-relay-toolkit
```

安装后**重启 DSH Desktop** 才生效（插件在启动时组合）。卸载：

```sh
dsh plugin --profile desktop remove dsh-relay-toolkit
```

## 界面

设置 → 「中转站工具」。每张卡片显示：

- 路由名、路由 key、模型总数、`baseURL`；
- 「思考等级声明完整，没有可补的模型」，或
- 「可自动补全：<模型 id…>」、「家族认不出来、需要你决定：<模型 id…>」、
  「官方不支持档位、刻意跳过：<模型 id…>」；
- 「窗口/输出上限未声明：N 个」；
- 「官方确认支持图像、但未声明 input：<模型 id…>」；
- 「已禁用写入：<原因>」（该路由不可写时）。

按钮（**禁用时鼠标悬停会说明原因** —— 置灰而不解释就是"点了没反应"）：

- **同步模型**：GET 该路由的 `/models`，把用户层没有的模型追加到 `models` 末尾
  （带 `{ id, name }`，能确认的再带 `reasoningEfforts`）。已存在的条目原样不动。
- **补全思考等级（N）**：只给「没有声明过 `reasoningEfforts` 且家族可确认」的模型写入建议。
  该路由没有可自动补全的模型时此按钮置灰，悬停会说明是"声明已完整"、"家族认不出来"，
  还是"剩下的模型官方不支持档位"。
- **用通用模板补全（N）**：仅当存在「认不出家族」的模型时出现。写的是通用模板
  `off: null / low / medium / high`；上游是否支持这套拼写无法预先确认，所以它**必须由你点**，
  永远不参与自动补全。补完的模型会在结果里标为"用了通用模板"。
  **官方确认不支持档位的模型不在其中** —— 即使你点了这个按钮，宿主也不会写它们。
- **对齐窗口与输出（N）**：调用 DSH 自己的模型发现（`ctx.llm.discoverModels('llm-pi-ai', …)`），
  把 `contextWindow` 与 `maxTokens` 写进用户层里**还没声明这两项**的模型。数值优先来自 pi-ai
  的已装目录，目录里没有才回到上游 `/models`（那里已兼容 `context_length`、`max_input_tokens`、
  `limit.context`、`max_output_tokens`、`top_provider.max_completion_tokens` 等拼写）。

  为什么值得做：模型条目缺这两项时，DSH 会退回路由级的 `defaultContextWindow` /
  `defaultMaxTokens`，上下文预算与溢出判定都会按那个默认值算。对齐后按真实容量计算。

  三处取舍：**发现结果优先**（官方目录与上游给什么就用什么）；它们没给的项才退到**内置官方
  规格表**（2026-09-16 人工核对、每条带官方来源，完整表见 `docs/MODEL_SPECS.md`）；
  **已经填好的数值一律不覆盖**，只填空缺。

  结果里会标出有多少个用了规格表 —— 那是**官方值，不一定等于你中转站的上限**
  （实测：`MiniMax-M3` 原厂 1M，阿里云转售只给 192k）。规格表只认能确认的家族，认不出就留空，
  不会拿同家族其它型号的数字凑。发现失败（上游不可达等）不阻断对齐：规格表照常兜底，
  失败原因一并回报给界面。

- **补全图像声明（N）**：给「官方确认能收图、但条目没声明 `input`」的模型写入
  `input: [text, image]`。**必须由你点**，不参与自动补全（理由见下方「图像输入声明」）。
- **测试连通性（N）**：向该路由的每个模型发一句 `hi`，看能不能拿回回复 ——
  失败排在前面，每条给出耗时与失败原因。**这是唯一会向上游发计费请求的按钮**
  （每次约几十 token），但**只读不写配置**，也不受「该路由不可写」限制。
  详见下方「连通性探测」。
- **刷新**：重新拉一次 `/status`，卡片上的数量与按钮随之更新。

### 连通性探测：为什么需要它

**`/models` 只说明「列出了」，不说明「调得通」。** 渠道掉线、密钥没开通、模型已下线、
账户余额不足，都会让条目继续留在列表里 —— 而 `/models` 与 `discoverModels` 都回答不了
「这个模型现在到底能不能用」。只有真发一次请求才能把两者分开。

实测过的真实差别（同一份 `/models` 列表里，条目长得一模一样）：

| 情况 | 探测结果 |
|---|---|
| 正常可用 | `✓ 1683ms 回复="Hi there! How can I help you today?" 输出 10 token` |
| 模型在这条渠道上没有 | `✗ 351ms 上游说：No available channel for model ... under group 国模` |
| 账户余额不足 | `✗ 849ms 上游说：Insufficient account balance；上游拒绝了这次调用（HTTP 403...）` |

**四条设计取舍**：

1. **输入固定是最短的 `hi`**，`max_tokens` 压到 32 —— 探测要回答的只是「通不通」，
   不是「答得好不好」。为什么不是 1：GLM-5.3、Kimi K3 这类**强制思考**的模型会把预算
   先花在思考上，实测 `glm-5.3-flash` 回一句问候就用了 **264 token**，
   预算过小时可能直接被上游拒绝。
2. **上游自己给的原因优先**。中转站对「余额不足」也回 403 —— 若照状态码猜成「密钥无效」，
   你会去改密钥，而真正该做的是充值。所以上游的 `message` 永远排在状态码解释之前。
3. **抓「假成功」**：HTTP 200 不等于成功。有的中转站把上游错误包在 200 的 body 里，
   插件会检查 `error` 字段；也认 `reasoning_content` 与 Responses API 的 `output_text`。
4. **限流与截断**：单次最多探 50 个模型、并发 3 —— 一次点击不该对中转站发起并发冲击
   （那会把「被限流」误报成「模型不可用」），也不该打出几百个计费请求。被截断时界面会说明。

**不支持的协议如实说明**：只有 OpenAI 兼容的 `openai-completions` 与 `openai-responses`
能这样探。别的 `api` 类型（如 Anthropic Messages）报文形状不同，硬拼请求只会得到
误导性的失败，所以直接回一句「暂不支持探测」，**不发请求**。

**超时 30 秒**，比 `/models` 的 15 秒宽松：强制思考的模型首个 token 可能要等十几秒。
超时会提示「可重试一次」，而不是断言模型不可用。

### 官方不支持档位 ≠ 认不出家族

这两类模型界面都不给建议，但**原因不同，界面上分开说**：

- **认不出家族**：插件没有这个模型的资料 → 显示「家族认不出来、需要你决定」，
  并出现「用通用模板补全」按钮。
- **官方不支持档位**：插件认得出，但官方文档明确它只有 thinking 开关（开/关），
  或压根没公布档位枚举 → 显示「官方不支持档位、刻意跳过」，**不出现按钮**，
  「用通用模板补全」也绕开它们。

为什么要分：DSH 会把 `reasoningEfforts` 里的档位显示给用户选，一选就真发
`reasoning_effort`；对不支持该参数的上游，这是报错或静默忽略。所以
`glm-5.1`、`kimi-k2.6`、`kimi-k2.7-code`（含 `-highspeed`）、`kimi-for-coding-highspeed`、
`mimo-v2.5*`、`MiniMax-M3`、`MiniMax-M2.7*`、`qwen3.7-*`、`hy4-preview`，
以及混元翻译/角色扮演（`hy-mt2*`、`hy-role`、`hunyuan-role-latest`）与 `glm-ocr`
这些模型**一个字段都不写**，无论你点哪个按钮。

Grok 的旧型号同理：`grok-4`（含 `-fast` / `-1-fast` / `-0709`）、`grok-code-fast*`、
`grok-3*`、`grok-2*` 官方都明确不支持 `reasoning_effort`（`grok-4` 始终以固定档位推理；
`grok-3` 只有 mini 变体有档位，而该家族已于 2026-05-15 整体重定向到 `grok-4.3`）。

### 国外厂商的档位（2026-10-03 补入）

上一轮核对时国外厂商官方域全部不可达，本轮部分已能取到官方数据，故补入规则：

| 厂商 | 官方档位 | 能否关闭推理 | 来源性质 |
|---|---|---|---|
| OpenAI `gpt-6*` / `gpt-5.6*` / `5.5` / `5.4` / `5.1-codex-max` | `none` / `low` / `medium` / `high` / `xhigh` | ✅ 可关（`none`） | Azure OpenAI 官方文档（云平台口径） |
| OpenAI `gpt-5.1` | 同上但**无** `xhigh` | ✅ | 同上 |
| OpenAI 初代 `gpt-5*` | `minimal` / `low` / `medium` / `high`（**无** `none`） | ❌ | 同上 |
| OpenAI `gpt-5-pro` | **仅 `high`** | ❌ | 同上 |
| OpenAI `o1` / `o3` / `o3-mini` / `o4-mini` / `o3-pro` | `low` / `medium` / `high`（官方未逐型号列枚举，按适用范围反推） | ❌ | 同上 |
| Anthropic `claude-fable-5` / `mythos-5` / `opus-5` / `sonnet-5` | `low` / `medium` / `high` / `xhigh` / `max` | Fable/Mythos ❌；Opus 5/Sonnet 5 ✅ | Anthropic 官方 SDK |
| Google Gemini | `minimal` / `low` / `medium` / `high`（`thinking_level`） | 官方未说明 | Google 官方 SDK |
| **Mistral** `mistral-medium-3*` / `magistral*` | `none` / `minimal` / `low` / `medium` / `high` / `xhigh`（**无 `max`**） | ✅ 可关 | Mistral 官方 SDK |
| **字节豆包** `doubao-seed-*` | `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`（七档全收） | ✅ 可关 | 火山方舟官方文档 |
| **阶跃 Step** `step-5*` / `step-3.7*` / `step-3.5*` | `low` / `medium` / `high` | ❌ 官方无关闭方式 | 阶跃官方文档 |

**刻意不写档位（官方确认不支持，登记原因避免被通用模板误补）：**

| 厂商 | 模型 | 官方依据 |
|---|---|---|
| **Meta Llama** | 全系（`llama-4-scout` / `-maverick` / `llama-3.3-70b` …） | 官方 Python / TypeScript SDK 参数表**无 `reasoning_effort`**；`CoreModelId` 枚举无任何推理变体 |
| **百度 ERNIE** | 全系 | 官方 `reasoning_effort` 支持清单**只有 deepseek 系**；ERNIE 用 `enable_thinking` 开关 |
| **Mistral** | `mistral-large-3` | 官方模型卡 output 仅 `text`、**未标 reasoning**，档位未按模型确认 |
| 智谱 | `glm-4.x` / `glm-5.1` / `glm-5` / `glm-image` / `glm-ocr` | 官方明确「仅 5.2 及以上支持」 |
| 月之暗面 | `kimi-k2.6` / `kimi-k2.7-code*` / `kimi-for-coding-highspeed` | 只有 thinking 开关 |
| 小米 | `mimo-v2.5*` / `mimo-v2.6*` | 只有 thinking 开关 |
| 腾讯 | `hy4*` / `hy-mt2*` / `hy-role` | 官方未公布档位枚举 |
| 阿里 | `qwen3.7-*` | 官方未公布档位枚举 |
| xAI | `grok-4*`（旧）/ `grok-3*` / `grok-2*` | 官方明确不支持 |
| OpenAI | `o1-mini` | 官方脚注明确不支持 |
| Anthropic | `claude-opus-4-8` / `claude-haiku-4-5` | 官方只标 "Reasoning: Supported"，未公布枚举 |

**四处刻意不写，都是为了避免「看起来能选、实际被拒」：**

1. **OpenAI 的 `max` 一个都不写**。官方原文限定：`max` 只在 GPT-6 或 GPT-5.6 **且用
   Responses API** 时可用。本插件服务的路由是 OpenAI 兼容的 `openai-completions`
   （走 Chat Completions），写了就是必然被拒的档位。
   （注意这与 Claude 的 `max` 无关 —— 后者是 Anthropic 自己的 effort 枚举。）
2. **Anthropic 的 `off` 不写**。Anthropic 关闭思考是 `thinking: {"type":"disabled"}`，
   它**不是** effort 的一个档位值。写成 `off` 会让 DSH 显示一个「关闭思考」选项，
   而实际效果只是不发 effort 字段、思考照旧按默认开启 —— 那是误导。
3. **阶跃的 `off` 不写**：官方文档完全没有 thinking / enable_thinking 字段，无关闭方式。
4. **Mistral 的 `mistral-large-3` 不写档位**：官方模型卡 output 仅 `text`、未标 `reasoning`，
   且官方**未按模型声明**档位子集（六档枚举是 API 层联合类型，不等于每个模型都支持）。

另外两处「官方没写就不猜」：`claude-opus-4-8` / `claude-haiku-4-5` 官方只标
"Reasoning: Supported" 而**未公布档位枚举**，插件登记为刻意不写；**Gemini 的上下文窗口与
最大输出一个数字都没取到**，所以只写档位、不写规格。

**豆包只认 `doubao-seed-*`**：`doubao-pro` / `doubao-1.5-pro` 不在方舟官方模型列表里，
也不在 reasoning_effort 支持表中 —— 插件**刻意不写宽泛的 `doubao` 前缀**，
因为那等于凭厂商名猜能力。

**OpenAI o 系列**（`o1` / `o3` / `o3-mini` / `o4-mini` / `o3-pro`）：官方支持表只标了
「Reasoning effort ✅」而**未逐型号列出枚举**。插件按官方给的三条适用范围约束反推，
只写唯一确定可用的三档 `low` / `medium` / `high`：
`none` 的官方列表不含 o 系列；`minimal` 官方原文限定 "only with the **original GPT-5**
reasoning models"；`xhigh` / `max` 限定更新的型号。规格统一 200,000 / 100,000。
官方脚注还明确 `o1-mini` **不支持** `reasoning_effort`、`gpt-5-codex` 不支持 `minimal`，两者都已单独处理。

### 短 id 需要词边界（改表时留意）

`match` 是子串匹配，但**长度 < 4 的模式额外要求落在词边界上**。这不是洁癖，是踩出来的：
`o1` / `o3` 这种两字符模式当裸子串用，会命中 `audio1`、`video3`、`ratio1` 这些
**完全无关**的模型 id，并给它们写进一组根本不支持的思考档位（实测确认）。

边界规则：id 里以 `-` / `_` / `.` / `/` / `:` 或串首开头、且后面紧跟分隔符或串尾才算命中。
于是 `o3`、`o3-mini`、`gpt-o3`、`openai/o3` 命中，而 `audio1`、`video3` 不命中。
长模式（≥4 字符）保持原来的纯子串语义 —— 那是 `openai/gpt-5.1-codex-max` 这类
带渠道前缀的 id 需要的宽松匹配。三张表（档位 / 规格 / 多模态）共用同一套边界规则。

### 覆盖度自查

改完规则表想知道「主流厂商都覆盖到了吗」，跑：

```sh
node scripts/coverage-report.mjs
```

它会打印三张表的全部规则，并用一批代表性 id（覆盖国内外主流厂商）实测判定，
最后给出「认不出」的数量。**认不出的模型会被界面列为「需要你决定」**，
所以这个数字就是插件的实际能力缺口。

已知仍认不出的（官方数据未取得，按「认不出就不写」处理）：
Cohere Command、Mistral `devstral-2` / `leanstral` / `mistral-small-4-0`、
`doubao-pro`（官方列表无此 id）、`phi-4` 等。截至 2026-10-03 第二轮核对，
74 个样本中仅 4 个认不出 —— 都是有依据的「官方没写就不猜」，而非遗漏。

### Grok 的档位随版本变（改表时务必留意）

Grok 是这张表里唯一「**同家族不同版本档位不同、且能不能关闭推理也变**」的情况：

| 模型 | 官方档位 | 能否关闭推理 |
|---|---|---|
| `grok-4.3` | `none` / `low`(默认) / `medium` / `high` | ✅ 可关 |
| `grok-4.5` | `low` / `medium` / `high` | ❌ 不可关 |
| `grok-4.6` | `low`(默认) / `medium` / `high` / `xhigh` | ❌ 不可关 |
| `grok-4.7` | `low` / `medium` / `high`(默认) / `xhigh` | ❌ 不可关 |

**所以这四条必须逐版本分开写，不能合并成一个 `grok-4` 前缀规则** —— 合并会把 4.3 的
`off` 档安到 4.5/4.6/4.7 上，而 4.5 对 `none` 直接返回 400
（`This model does not support reasoning_effort value none`，有实测记录）。

核对来源（2026-10-02；`docs.x.ai` 本机不可直连，故用转载 xAI 官方规格的模型卡交叉核对，
三家彼此一致）：[AWS Bedrock · Grok 4.3](https://docs.aws.eu/bedrock/latest/userguide/model-card-xai-grok-4-3.html)、
[Cloudflare AI · Grok 4.5](https://developers.cloudflare.com/ai/models/xai/grok-4.5/)、
[AWS Bedrock · Grok 4.6](https://docs.aws.eu/bedrock/latest/userguide/model-card-xai-grok-4-6.html)、
[Oracle OCI · Grok 4.7](https://docs.oracle.com/en-us/iaas/Content/generative-ai/x-ai-grok-4-7.htm)。
另有一条实测旁证：grok-4.5 还接受未公布的 `minimal` 与 `xhigh`（见
[ghc-proxy 探测报告](https://raw.githubusercontent.com/wxxb789/ghc-proxy/5fb86208379a4f312ff44636cfe26e577ff78327/docs/research/grok-4.5-schema.md)）——
但插件只写官方公布的档位，不把探测到的额外档位写进配置。

### 图像输入声明（多模态）

**症状**：模型明明支持图像，`read_image` 却报
`model "X" does not declare image input`。

**根因**：`input` 没声明。pi-ai 的模型条目缺 `input` 时，`dsh-llm-pi-ai` 会退回路由级
`defaultInput`（本机实测默认值是 `["text"]`），该模型于是被当**纯文本**路由，
工具在发请求之前就拒了。注意报错是「未声明」而不是「不支持」—— 决定权在条目声明，
不在模型名：同一个模型 id、同一份 DSH，在声明了 `input: [text, image]` 的 provider 下
能读图，在没声明的 provider 下读不了。

**插件做什么**：

- 卡片上标出「官方确认支持图像、但未声明 input：<模型 id…>」，并给一个
  **补全图像声明（N）** 按钮，写入 `input: [text, image]`；
- 设置页顶部**单独告警当前默认模型**：默认模型走哪条路由由 `agent-default-model`
  决定，而工具侧读的就是默认模型的能力声明 —— 这一条正是实际踩坑的位置。

**三条边界**：

1. 只写 `input`，**不写** `inputModalities`。后者是模型条目在 `discoverModels`
   结果里的字段名（以及 DSH 内置适配器 `llm-deepseek` 的配置字段），pi-ai 风格的路由
   配置里用的是 `input`，写错等于没写；
2. 能力来源**两级**：先信 `discoverModels` 的 `inputModalities`（上游或已装目录自己的
   声明），它没给模态时才退回内置官方能力表 —— `deepseek-flash` / `deepseek-v4.1*`、
   `glm-5.3-flash`、Kimi 的 `kimi-k3` / `k3-256k` / `kimi-for-coding*` / `kimi-k2.6` /
   `kimi-k2.7-code*`、Qwen 的 `qwen3.8-max` / `qwen3.8-flash` / `qwen3.7-plus` / `qwen3.7-flash`、
   `MiniMax-M3`、`mimo-v2.5`（**不含 `mimo-v2.5-pro`**，见下）。
   两处都认不出就不补 —— 国外厂商没有可核对的官方来源，内置表里一个都不收；
3. **官方能力 ≠ 中转站能力**。声明只代表模型本身能收图，你的中转站是否真的向上游透传
   图像**必须自己实测**。所以这一步**必须由你点**，
   不参与自动补全 —— 写错了的表现是请求被上游拒绝，而不是静默降级。

**前缀陷阱（改多模态表时务必保住）**：`mimo-v2.5` 官方列了「全模态理解」，
而同前缀的其它型号都没有该能力（`mimo-v2.5-pro` 只列文本生成，`mimo-v2.5-asr` 是语音识别，
`mimo-v2.5-tts*` 是语音合成）—— 它们的最长命中长度全都一样（都是 `mimo-v2.5`），
**单靠最长命中分不开**。所以那张表支持 `except`：命中 `except` 里任意一条即视为认不出、不写声明。
`kimi-for-coding` 与 `kimi-for-coding-highspeed` 是同类问题，但两者能力相同，靠最长命中即可。

已经声明过 `input` 的条目（哪怕只写了 `text`）一律不动：那是你的明确表态。

完整排查记录 —— 含官方图像限制表（支持格式、32 MiB / 8192 px 上限、每图 1024 token、
图像只能放 `user` 消息否则 400 等）—— 见 `docs/MULTIMODAL.md`。

## 兼容性

针对 **DSH 0.2.0-rc.2**（`@deepseek-ai/cordis` 4.0.4 线）逐项核对过：

- 宿主路由注册：`ctx.effect(() => server.register({ kind, path, handler }))`，
  `webServer` / `httpServer` 双名兼容 —— Cordis 的 `inject` 没有可选形式，
  所以这两个名字是放在**嵌套** `ctx.inject` 里等待的，模块级 `inject` 留空，
  没有 web 服务的组合也能正常加载；
- **`settings.get(ns)` 在 0.2 已被移除**，描述符成为唯一读取入口：
  `settings.describe()` → `[{ ns, revision, value, base, user, schema, applies }]`，
  其中 `value` 是解析后的生效值（旧 `get(ns)` 的替代物）、`user` 是用户写下的那一层；
  写入仍是 `settings.update(ns, patch, revision)`，revision 冲突检测照旧；
- `credentials.resolve(ref)` → `{ value }`；
- `llm.discoverModels(settingsNs, { provider })` → `[{ id, name, contextWindow?, maxTokens?, inputModalities? }]`
  —— 窗口/输出上限的对齐来源：provider 命中已装目录时直接返回目录数值，否则查上游；
  **0.2 新增的 `inputModalities` 也用于图像声明**，且优先于内置官方能力表（见下）；
- 客户端：`ctx.slots.inject('settings.section', () => ctx.slots.register({...}, Component))`，
  `settings.section` 是 list 槽位，注册必须带 `id`；
- 客户端 bundle 只 `require('react')` 与 `react/jsx-runtime`（平台播种表内），
  因此不需要 `dsh.client.external` 声明。

### 0.1.5-rc.1 → 0.2.0-rc.2 改了什么

**根因**：0.2 移除了 `settings.get(ns)`。旧实现把它当成必需方法
（`typeof settings.get !== 'function'` 就直接放弃），于是插件在新宿主上
**整体静默失效** —— 设置页一片「读取中…」，日志里却没有一句报错。这正是
「mock 全绿、实机全废」的典型：测试里的假 settings 提供了 `get`，真宿主没有。

三处改动：

1. 读取改走 `settings.describe()`，取 `value`（生效值）与 `user`（用户层）；
   一次请求只取一次快照，因为 `describe()` 会推进 revision 并广播事件；
2. 默认模型诊断同样改走描述符（`agent-default-model` 的 `provider` / `model`
   都是 volatile 字段，会出现在 `value` 里）；
3. 图像声明改为**发现结果优先**：0.2 的 `discoverModels` 新增了
   `inputModalities`，这是比内置官方能力表更权威的一手来源；发现结果没给模态时
   才退回内置表，发现失败也只记原因、不阻断补全。

测试也一并加固，避免同类问题复发：`test/host.test.mjs` 的 mock **刻意不再提供
`get`**，并新增 6 条 0.2 回归用例；`test/contract-0.2.mjs` 直接对解包出来的真实
DSH 实现做 20 项静态契约断言（含「`settings.get()` 必须不存在」这条）。

## 开发

无构建步骤：`lib/index.js`（宿主，ESM）与 `lib/client.js`（浏览器，手写的
`__ModuleLoader__` bundle）都是可直接运行的产物。

```sh
node --test test/host.test.mjs test/client.test.mjs test/scripts.test.mjs   # 80 项
node test/cordis-smoke.mjs                            # 真实 cordis 冒烟
node test/real-settings-smoke.mjs                     # 真实 settings 形状下的端到端
node test/contract-0.2.mjs                            # 真实 DSH 0.2 契约核对（20 项）
```

- `test/host.test.mjs`：mock cordis 上下文与假 `/models` 响应，端到端驱动宿主逻辑 ——
  视图构建、只补缺失、已有声明原样保留、底座层路由拒绝写入、同步追加与凭据使用、
  上游报错不写入、非本机拒绝、未知端点、无 web 服务时仍可加载、短别名归一化、
  「官方不支持档位」与「认不出家族」的区分；对齐部分另外覆盖
  发现结果驱动写入、已有容量不被覆盖、发现失败只记原因不写入、缺 `llm` 服务时报可读原因。
  另有三组回归用例钉住 2026-09-16 新增的条目：新登记「认得出但官方不给档位」的家族、
  新登记官方规格（`qwen3.7-flash` / `hy-mt2*` / `hy-role`）、以及 `mimo-v2.5` 前缀下
  `mimo-v2.5-pro` 的 `except` 排除。
  探测部分（9 项）覆盖：报文形状（端点、鉴权头、`max_tokens` 压到最小）、
  只读不写配置、401/403/404/429 的错误翻译、**403 以上游原因为准**、
  「HTTP 200 但 body 是错误」的假成功、`reasoning_content` 与 Responses API 的
  `output_text`、不支持的 `api` 类型不发请求、模型数截断与并发。
  **0.2 适配部分（6 项）**：无 `settings.get` 时照常工作、`value`/`user` 分层读取、
  `inputModalities` 优先于内置表、无模态时退回内置表、发现失败仍兜底、
  缺 `settings` 服务时端点回可读原因。
  **新模型规则部分（11 项）**：OpenAI 档位随型号收窄且不写只在 Responses API 可用的 `max`、
  `gpt-5-pro` 只有 `high` 且 `gpt-5.1-codex-max` 独有 `xhigh`、Anthropic 五档含 `xhigh`
  但不写 `off`、Gemini 只有官方四档、小米 V2.6 无档位且两代多模态能力分布相反、
  OpenAI o 系列只给官方确定的三档、短 id 需词边界（`o1`/`o3` 不误伤 `audio1`/`video3`）、
  Meta Llama 官方无该参数、百度 ERNIE 只有 enable_thinking 开关、
  阶跃三档且无关闭方式（含 `step-3` 下线的子串冲突）、豆包七档但只认官方在架的 `doubao-seed` 系、
  Mistral 六档（无 `max`）且只给官方标记 reasoning 的型号。
- `test/client.test.mjs`：执行 `lib/client.js`，验证 bundle 契约（以包名注册、
  只依赖平台播种表内的 react）与 `settings.section` 的注册形状。
- `test/scripts.test.mjs`（10 项）：`scripts/fix-efforts.mjs` 的参数解析与安全阀。
  这脚本改的是真实配置，所以它的参数解析单独测 —— 第一版曾因 `--profile` 缺失时
  丢掉第一个位置参数，让目标静默落回真实路径（详见「脚本」一节）。
- `test/cordis-smoke.mjs`：用**真实的 `@deepseek-ai/cordis`** 加载本插件，确认嵌套
  `inject` + 服务访问不会触发 `cannot get property "..." without inject`。
- `test/real-settings-smoke.mjs`：把**按真实 `dsh-settings` 接口面逐个抄下来**的
  settings 服务（**没有 `get`**）挂进真实 cordis，端到端驱动插件。这是本轮修复的判据：
  旧代码在这里读出 `routes: 0`（静默失效），修复后为 1。
- `test/contract-0.2.mjs`：读**解包出来的真实 DSH 源码**做静态契约断言。
  mock 会随实现一起过期（本轮就是这么栽的），所以这一层专门用来钉住
  「插件假设的 API」与「DSH 实际提供的 API」一致。

这三个需要 DSH 实现代码的检查，先用脚本解出来（默认解到系统临时目录）：

```sh
node scripts/unpack-dsh.mjs
# DSH 装在别处：node scripts/unpack-dsh.mjs "D:/path/to/app.asar"
# 解到别处时用环境变量指路：
#   set DSH_CORDIS_PATH=<...>/@deepseek-ai/cordis/lib/index.js
#   set DSH_UNPACKED=<解包目录>
```

### 改完源码要重装

`dsh plugin --profile desktop add file:…` 是把插件**拷贝**进 profile 的
`node_modules`，不是软链接。改完 `lib/` 下的源码后必须重装一次才生效：

```sh
dsh plugin --profile desktop remove dsh-relay-toolkit
dsh plugin --profile desktop add file:C:/Users/<你>/dsh-plugins/dsh-relay-toolkit
```

或者用仓库里的同步脚本（等价于重装，但会先列出差异并备份旧副本）：

```sh
node scripts/sync-to-profile.mjs --check   # 只看哪些文件有差异
node scripts/sync-to-profile.mjs           # 同步（默认 desktop profile）
node scripts/sync-to-profile.mjs --profile web
```

两种方式之后都要重启 DSH Desktop。

## 脚本

`scripts/` 下有三个**不随插件加载**的辅助脚本：

- **`sync-to-profile.mjs`** —— 把源码同步进 profile 的已安装副本（见上）。
  `--check` 只比对差异、不写；写入前会把旧副本备份成
  `node_modules/dsh-relay-toolkit.bak-before-sync`。

- **`fix-efforts.mjs`** —— 按同一张官方档位表批改**补丁层配置**（直接 import 插件的
  `suggestEfforts`，不另抄一份表，所以判定永远与插件一致）。它比界面上的按钮激进：
  官方确认不支持 `reasoning_effort`（或未公布档位）的模型，它会把已有的
  `reasoningEfforts` **删掉**；认不出家族的原样不动。留着无效档位是有害的 ——
  DSH 会把它们显示给用户选，一选就真发 `reasoning_effort`。

  **DSH 0.2 起配置不在 `~/.dsh/settings.yaml` 了**（旧文件会被一次性导入后改名成
  `.imported`），真实配置在 profile 的补丁层
  `~/.dsh/profiles/<profile>/cordis.patch.yml` 里 `llm-pi-ai` 条目的 `config.providers`。
  脚本因此改读那个文件，并且**用能保留注释的 yaml 库**重写 —— 补丁层是手写的，
  用丢注释的库会把你的注释一并抹掉。

  ```sh
  node scripts/fix-efforts.mjs --dry-run          # 只看会改什么，不写文件
  node scripts/fix-efforts.mjs                    # 真正写入（默认 desktop profile）
  node scripts/fix-efforts.mjs --profile web      # 指定 profile
  node scripts/fix-efforts.mjs <cordis.patch.yml> # 指定文件
  node scripts/fix-efforts.mjs --print-target     # 只打印会改哪个文件，别的都不做
  ```

  **每次运行都会先把目标路径打印出来**（`目标：…`），动真实配置前请自己看一眼。
  它另外带一道安全阀：目标必须真的是补丁层（顶层非空序列 + 含 `llm-pi-ai` 条目 +
  该条目有 `config.providers`），否则拒绝写入。

  > 这道安全阀是踩出来的：脚本第一版的参数解析有 bug —— `--profile` 不存在时
  > `indexOf` 返回 -1，`index !== profileIndex + 1` 恰好把**第一个位置参数丢掉**，
  > 于是目标静默落回默认路径（真实配置），指定的测试文件反而没被读。参数解析已改成
  > 显式循环，安全阀再加一层。

  脚本需要 `yaml`（eemeli/yaml，DSH 自己的依赖，支持 document 级编辑因而能保留注释）；
  它向 DSH 的 profile 借，找不到时用 `DSH_YAML` 指路：

  ```sh
  set DSH_YAML=%USERPROFILE%\.dsh\profiles\desktop\node_modules\yaml\dist\index.js
  ```

- **`unpack-dsh.mjs`** —— 从 DSH Desktop 的 `app.asar` 解出实现代码，供
  `cordis-smoke.mjs` 与 `contract-0.2.mjs` 用（见上）。

## 已知边界

- 「未识别家族」的模型不会被补全，需要你自己在配置里手写 `reasoningEfforts`
  （合法等级键见上表）。官方配置入口是 **设置 → 插件 → 模型**，也可以直接改
  `~/.dsh/profiles/<profile>/cordis.patch.yml` 里 `llm-pi-ai` 的 `config.providers`。
  官方确认不支持档位的模型同理，但那是**刻意不写**，不建议手写。
- **短别名只在精确匹配时归一化**：目前只有 `k3` → `kimi-k3` 一条 —— 它们是同一个模型
  在两处官方入口下的名字（Kimi Code 用 `k3`，API 开放平台用 `kimi-k3`）。别名只用于查表，
  写回配置的仍是中转站给的原 id。之所以不做子串匹配，是因为 `k3` 这种短 id 当子串用
  会误伤任何含 `k3` 的模型 id。
- **规则表是子串匹配 + 最长命中优先**：`kimi-for-coding` 是 `kimi-for-coding-highspeed`
  的前缀，前者有三档、后者只有 Thinking 开关，全靠最长命中区分开。改动那张表时要保住
  这个性质，否则会给高速版错误地补上档位。Grok 是同类且更险的一对：`grok-4`（不支持档位）
  是 `grok-4.5`（有档位）的前缀，**判定完全相反**，写错会让 4.5 拿不到档位或让
  `grok-4` 被错误补上字段。
- **同家族不同版本的档位可能不同，规则要按版本写**：Grok 4.3 可关推理、4.5 起不可关、
  4.6/4.7 才多出 `xhigh`。不要图省事合并成家族前缀规则。
- **最长命中解决不了的，用 `except`**：多模态表里 `mimo-v2.5` 与 `mimo-v2.5-pro` 的
  最长命中长度相同（都是 `mimo-v2.5`），但只有前者官方支持图像输入 —— 这种「共享前缀、
  能力不同」的情况必须显式排除，不能指望最长命中。
- 中转站 `/models` 若返回非 `{ data: [...] }` 结构会报错并保持配置不变。
- 中转站返回的模型 id 会原样写入；若你的中转站把渠道前缀写进 id（如 `openai/gpt-5.5`），
  同步进来的也就是那个 id。
- `/models` 请求超时 15 秒，请求体上限 64 KB；返回空列表会报「模型列表为空」并保持配置不变。
- **多模态能力在 0.2 起部分来自 `discoverModels`**：0.2 的模型发现结果新增了
  `inputModalities`，插件的图像声明因此**发现结果优先**（那是上游或已装目录自己的
  声明），发现结果没给模态时才退回内置官方能力表；两处都认不出就不写 —— 这是刻意的，不猜。
  （0.1.5 时代的发现结果只有 `{ id, name, contextWindow, maxTokens }`，
  所以当时只能靠内置表。）

## 排障与恢复

**先备份。** 插件只改 `llm-pi-ai` 这条配置里的 `providers[路由].models`，
但它写的是你的真实配置。

DSH 0.2 起配置**不再放在 `~/.dsh/settings.yaml`**（旧文件会被一次性导入后改名成
`.imported`），而是写在 profile 的补丁层里：

```sh
copy %USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml %USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml.bak
```

改坏了就停掉 DSH Desktop，把 `.bak` 覆盖回去再启动。

**日志**：插件的日志走 DSH 自己的 logger（`ctx.logger`），不是 `console`，
所以要去 DSH Desktop 的日志里看，搜 `relay-toolkit`。正常启动会看到
`relay-toolkit: waiting for webServer or httpServer to serve /api/relay-toolkit`
和 `relay-toolkit: serving /api/relay-toolkit via <服务名>`；
**只看到前一条**说明这次组合里没有 web 服务，设置页的区块会拿不到数据。

**区块一直"读取中…"**：先确认插件已随 DSH 启动（见上面的日志），再确认 `/status` 可达 ——
该路由只接受本机请求，非 loopback 一律 403。

**升级 DSH 后整个区块空白、且没有任何报错**：这是 0.1.5 → 0.2 那次 `settings.get()`
被移除的典型症状（插件会静默失效）。用契约核对脚本自查：

```sh
set DSH_UNPACKED=<解包目录>
node test/contract-0.2.mjs
```

## HTTP 端点

设置页用的就是这五个端点，挂在 `/api/relay-toolkit` 前缀下，只服务本机（loopback）。
业务失败也回 HTTP 200，但带 `ok: false`：

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| GET | `/status` | — | 只读视图：每条路由的可写性、模型、建议、`unsupported` 原因 |
| POST | `/sync` | `{ route }` | 拉该路由的 `/models`，追加缺失的模型 |
| POST | `/autofill` | `{ route?, includeUnknown? }` | 补思考等级；省略 `route` 则处理全部路由 |
| POST | `/align` | `{ route? }` | 用 `discoverModels` 对齐窗口与输出上限 |
| POST | `/modalities` | `{ route? }` | 给确认能收图的模型补 `input: [text, image]`（发现结果优先，内置表兜底） |
| POST | `/probe` | `{ route, models? }` | 发一句 `hi` 实测连通性；**只读**，但会向上游发计费请求 |

`/probe` 是唯一必须显式指定 `route` 的端点 —— 一次点击不该把全部路由都探一遍。
`models` 可选，用来只探指定模型。返回 `{ route, baseURL, api, prompt, total, truncated,
okCount, failedCount, results: [{ id, ok, ms, reply?, usage?, reason?, status? }] }`。

响应形如 `{ ok: true, value: … }` 或 `{ ok: false, error: { message } }`。手工调用：

```powershell
Invoke-RestMethod http://127.0.0.1:<DSH端口>/api/relay-toolkit/status
# 探一条路由（会向上游发出真实的计费请求）：
Invoke-RestMethod http://127.0.0.1:<DSH端口>/api/relay-toolkit/probe -Method POST `
  -ContentType 'application/json' -Body '{"route":"gm"}'
```

## License

MIT，见 `LICENSE`。
