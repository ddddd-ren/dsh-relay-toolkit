# dsh-relay-toolkit

给 **DeepSeek Harness（DSH）** 用的中转站维护插件：把中转站 `/models` 里缺失的模型合并进
`llm-pi-ai` 路由，给缺少 `reasoningEfforts` 声明的模型补上思考等级，把上下文窗口与最大
输出上限对齐到官方目录（或上游）给出的数值，并补上缺失的图像输入声明（多模态）。

设置页会多出一个「中转站工具」区块，每条路由一张卡片。按钮随该路由的实际情况出现：
**同步模型**恒在，**补全思考等级**、**用通用模板补全**、**对齐窗口与输出**、
**补全图像声明**按需出现，卡片底部另有一个**刷新**。若当前默认模型缺图像声明，
区块顶部会单独告警 —— 那正是「模型支持却读不了图」的直接成因。

## 明确不做的事

- **不碰 `service_tier` / Fast 档位。** OpenAI 兼容中转站普遍接受并静默忽略该字段
  （很多还会把非法档位照单全收），把它包装成「加速开关」是不诚实的。
- **不按模型名字猜能力。** 只覆盖能确认的家族（deepseek / glm / kimi / qwen / hy3）；
  认不出来的模型在界面上标为「未识别」，一个字段都不写。
- **不改 `baseURL`、`apiKeyEnv`、`compat`，也不删任何模型条目。**
- **不发送遥测。** 唯一的对外请求是向你在 settings.yaml 里配置的那条路由自己的
  `baseURL + /models` 发 GET，并带上该路由自己的凭据引用解析出的 Key。

## 行为保证

| 保证 | 实现方式 |
|---|---|
| 只写用户配置层 | 只改 `settings.describe()` 里 `user` 层的 `providers[route].models` |
| 只填空缺，绝不覆盖 | 已有 `reasoningEfforts`（含 `reasoningEfforts: false`）一律跳过 |
| 不固化底座层配置 | 若某路由的生效模型集合不等于用户层集合（含底座声明的模型），该路由禁用写入并在界面说明原因 |
| 不覆盖并发修改 | 每次 `settings.update` 都带上读取时的 `revision` |
| 只服务本机 | 路由拒绝非 loopback 来源的请求 |
| 只写合法声明 | 建议值经 `LEVELS` 白名单过滤；等级键只能是 `off/minimal/low/medium/high/xhigh/max`，值只能是该等级的线上拼写（仅 `off` 可为 `null`），且至少一个非 `off` 等级 |
| 不给官方不支持的模型写档位 | 官方确认不支持 `reasoning_effort` 的家族一个字段都不写，连「用通用模板补全」也绕开它们（见下方「官方不支持档位 ≠ 认不出家族」） |
| 不猜多模态能力 | 图像输入声明只补官方文档确认能收图的模型，认不出就不写；已声明 `input` 的条目（含只写 `text`）一律不动 |

## 安装

需要 **Node 18 或更高**（宿主用到 `AbortSignal.timeout` 与顶层 `await`；用 DSH 自带的运行时即可）。

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
- **刷新**：重新拉一次 `/status`，卡片上的数量与按钮随之更新。

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

1. 只写 `input`，**不写** `inputModalities`。后者是 DSH 内置适配器（`llm-deepseek`）
   的字段，pi-ai 风格的路由用的是 `input`，写错等于没写；
2. 只补官方文档确认能收图的模型：`deepseek-flash` / `deepseek-v4.1*`、
   `glm-5.3-flash`、Kimi 的 `kimi-k3` / `k3-256k` / `kimi-for-coding*` / `kimi-k2.6` /
   `kimi-k2.7-code*`、Qwen 的 `qwen3.8-max` / `qwen3.8-flash` / `qwen3.7-plus` / `qwen3.7-flash`、
   `MiniMax-M3`、`mimo-v2.5`（**不含 `mimo-v2.5-pro`**，见下）。
   国外厂商本轮复核依旧没有可核对的官方来源，一个都不补；
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

针对 **DSH 0.1.5-rc.1**（`@deepseek-ai/cordis` 4.x 线）逐项核对过：

- 宿主路由注册：`ctx.effect(() => server.register({ kind, path, handler }))`，
  `webServer` / `httpServer` 双名兼容 —— Cordis 的 `inject` 没有可选形式，
  所以这两个名字是放在**嵌套** `ctx.inject` 里等待的，模块级 `inject` 留空，
  没有 web 服务的组合也能正常加载；
- `settings.get(ns)` / `settings.describe()` / `settings.update(ns, patch, revision)`；
- `credentials.resolve(ref)` → `{ value }`；
- `llm.discoverModels(settingsNs, { provider })` → `[{ id, name, contextWindow?, maxTokens? }]`
  —— 窗口/输出上限的对齐来源：provider 命中已装目录时直接返回目录数值，否则查上游；
- 客户端：`ctx.slots.inject('settings.section', () => ctx.slots.register({...}, Component))`；
- 客户端 bundle 只 `require('react')` 与 `react/jsx-runtime`（平台播种表内），
  因此不需要 `dsh.client.external` 声明。

## 开发

无构建步骤：`lib/index.js`（宿主，ESM）与 `lib/client.js`（浏览器，手写的
`__ModuleLoader__` bundle）都是可直接运行的产物。

```sh
node --test test/host.test.mjs test/client.test.mjs   # 35 项
node test/cordis-smoke.mjs                            # 真实 cordis 冒烟
```

- `test/host.test.mjs`：mock cordis 上下文与假 `/models` 响应，端到端驱动宿主逻辑 ——
  视图构建、只补缺失、已有声明原样保留、底座层路由拒绝写入、同步追加与凭据使用、
  上游报错不写入、非本机拒绝、未知端点、无 web 服务时仍可加载、短别名归一化、
  「官方不支持档位」与「认不出家族」的区分；对齐部分另外覆盖
  发现结果驱动写入、已有容量不被覆盖、发现失败只记原因不写入、缺 `llm` 服务时报可读原因。
  另有三组回归用例钉住 2026-09-16 新增的条目：新登记「认得出但官方不给档位」的家族、
  新登记官方规格（`qwen3.7-flash` / `hy-mt2*` / `hy-role`）、以及 `mimo-v2.5` 前缀下
  `mimo-v2.5-pro` 的 `except` 排除。
- `test/client.test.mjs`：执行 `lib/client.js`，验证 bundle 契约（以包名注册、
  只依赖平台播种表内的 react）与 `settings.section` 的注册形状。
- `test/cordis-smoke.mjs`：用**真实的 `@deepseek-ai/cordis`** 加载本插件，确认嵌套
  `inject` + 服务访问不会触发 `cannot get property "..." without inject`。

冒烟测试需要 DSH 的实现代码，先用脚本解出来（默认解到系统临时目录）：

```sh
node scripts/unpack-dsh.mjs
# DSH 装在别处：node scripts/unpack-dsh.mjs "D:/path/to/app.asar"
# 解到别处时用环境变量指路：set DSH_CORDIS_PATH=<...>/@deepseek-ai/cordis/lib/index.js
```

### 改完源码要重装

`dsh plugin --profile desktop add file:…` 是把插件**拷贝**进 profile 的
`node_modules`，不是软链接。改完 `lib/` 下的源码后必须重装一次才生效：

```sh
dsh plugin --profile desktop remove dsh-relay-toolkit
dsh plugin --profile desktop add file:C:/Users/<你>/dsh-plugins/dsh-relay-toolkit
```

然后重启 DSH Desktop。

## 脚本

`scripts/` 下有两个**不随插件加载**的辅助脚本：

- **`fix-efforts.mjs`** —— 按同一张官方档位表批改 `settings.yaml`（直接 import 插件的
  `suggestEfforts`，不另抄一份表，所以判定永远与插件一致）。它比界面上的按钮激进：
  官方确认不支持 `reasoning_effort`（或未公布档位）的模型，它会把已有的
  `reasoningEfforts` **删掉**；认不出家族的原样不动。留着无效档位是有害的 ——
  DSH 会把它们显示给用户选，一选就真发 `reasoning_effort`。

  ```sh
  node scripts/fix-efforts.mjs --dry-run          # 只看会改什么，不写文件
  node scripts/fix-efforts.mjs                    # 真正写入（默认 ~/.dsh/settings.yaml）
  node scripts/fix-efforts.mjs <settings.yaml>    # 指定文件
  ```

  **跑之前先备份 settings.yaml。** 脚本需要 `js-yaml`，它向 DSH 的 profile 借；
  找不到时用 `DSH_JS_YAML` 指路：

  ```sh
  set DSH_JS_YAML=%USERPROFILE%\.dsh\profiles\desktop\node_modules\js-yaml\dist\js-yaml.mjs
  ```

- **`unpack-dsh.mjs`** —— 从 DSH Desktop 的 `app.asar` 解出实现代码，供冒烟测试用（见上）。

## 已知边界

- 「未识别家族」的模型不会被补全，需要你自己在 settings.yaml 里手写 `reasoningEfforts`
  （合法等级键见上表）。官方确认不支持档位的模型同理，但那是**刻意不写**，不建议手写。
- **短别名只在精确匹配时归一化**：目前只有 `k3` → `kimi-k3` 一条 —— 它们是同一个模型
  在两处官方入口下的名字（Kimi Code 用 `k3`，API 开放平台用 `kimi-k3`）。别名只用于查表，
  写回配置的仍是中转站给的原 id。之所以不做子串匹配，是因为 `k3` 这种短 id 当子串用
  会误伤任何含 `k3` 的模型 id。
- **规则表是子串匹配 + 最长命中优先**：`kimi-for-coding` 是 `kimi-for-coding-highspeed`
  的前缀，前者有三档、后者只有 Thinking 开关，全靠最长命中区分开。改动那张表时要保住
  这个性质，否则会给高速版错误地补上档位。
- **最长命中解决不了的，用 `except`**：多模态表里 `mimo-v2.5` 与 `mimo-v2.5-pro` 的
  最长命中长度相同（都是 `mimo-v2.5`），但只有前者官方支持图像输入 —— 这种「共享前缀、
  能力不同」的情况必须显式排除，不能指望最长命中。
- 中转站 `/models` 若返回非 `{ data: [...] }` 结构会报错并保持配置不变。
- 中转站返回的模型 id 会原样写入；若你的中转站把渠道前缀写进 id（如 `openai/gpt-5.5`），
  同步进来的也就是那个 id。
- `/models` 请求超时 15 秒，请求体上限 64 KB；返回空列表会报「模型列表为空」并保持配置不变。
- **多模态能力不来自 `discoverModels`**：DSH 的模型发现只返回
  `{ id, name, contextWindow, maxTokens }`，**不含**模态信息。所以图像声明只能靠内置的
  官方能力表，认不出就不写 —— 这是刻意的，不猜。

## 排障与恢复

**先备份。** 插件只改 `~/.dsh/settings.yaml` 里 `llm-pi-ai.providers[路由].models`，
但它写的是你的真实配置。动之前复制一份：

```sh
copy %USERPROFILE%\.dsh\settings.yaml %USERPROFILE%\.dsh\settings.yaml.bak
```

改坏了就停掉 DSH Desktop，把 `.bak` 覆盖回去再启动。

**日志**：插件的日志走 DSH 自己的 logger（`ctx.logger`），不是 `console`，
所以要去 DSH Desktop 的日志里看，搜 `relay-toolkit`。正常启动会看到
`relay-toolkit: waiting for webServer or httpServer to serve /api/relay-toolkit`
和 `relay-toolkit: serving /api/relay-toolkit via <服务名>`；
**只看到前一条**说明这次组合里没有 web 服务，设置页的区块会拿不到数据。

**区块一直"读取中…"**：先确认插件已随 DSH 启动（见上面的日志），再确认 `/status` 可达 ——
该路由只接受本机请求，非 loopback 一律 403。

## HTTP 端点

设置页用的就是这四个端点，挂在 `/api/relay-toolkit` 前缀下，只服务本机（loopback）。
业务失败也回 HTTP 200，但带 `ok: false`：

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| GET | `/status` | — | 只读视图：每条路由的可写性、模型、建议、`unsupported` 原因 |
| POST | `/sync` | `{ route }` | 拉该路由的 `/models`，追加缺失的模型 |
| POST | `/autofill` | `{ route?, includeUnknown? }` | 补思考等级；省略 `route` 则处理全部路由 |
| POST | `/align` | `{ route? }` | 用 `discoverModels` 对齐窗口与输出上限 |
| POST | `/modalities` | `{ route? }` | 给官方确认能收图的模型补 `input: [text, image]` |

响应形如 `{ ok: true, value: … }` 或 `{ ok: false, error: { message } }`。手工调用：

```powershell
Invoke-RestMethod http://127.0.0.1:<DSH端口>/api/relay-toolkit/status
```

## License

MIT，见 `LICENSE`。
