# dsh-relay-toolkit

给 **DeepSeek Harness（DSH）** 用的中转站维护插件：把中转站 `/models` 里缺失的模型合并进
`llm-pi-ai` 路由，给缺少 `reasoningEfforts` 声明的模型补上思考等级，并把上下文窗口与最大
输出上限对齐到官方目录（或上游）给出的数值。

设置页会多出一个「中转站工具」区块，每条路由一张卡片，四个按钮：**同步模型**、
**补全思考等级**、**用通用模板补全**、**对齐窗口与输出**。

## 明确不做的事

- **不碰 `service_tier` / Fast 档位。** OpenAI 兼容中转站普遍接受并静默忽略该字段
  （很多还会把非法档位照单全收），把它包装成「加速开关」是不诚实的。
- **不按模型名字猜能力。** 只覆盖能确认的家族（deepseek / gpt / claude / gemini /
  grok / kimi / glm / qwen / mimo / minimax）；认不出来的模型在界面上标为「未识别」，
  一个字段都不写。
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

## 安装

```sh
dsh plugin --profile desktop add file:C:/Users/asus/dsh-plugins/dsh-relay-toolkit
```

安装后**重启 DSH Desktop** 才生效（插件在启动时组合）。卸载：

```sh
dsh plugin --profile desktop remove dsh-relay-toolkit
```

## 界面

设置 → 「中转站工具」。每张卡片显示：

- 路由名、路由 key、模型总数、`baseURL`；
- 「思考等级声明完整，没有可补的模型」，或
- 「可自动补全：<模型 id…>」与「家族认不出来、需要你决定：<模型 id…>」；
- 「已禁用写入：<原因>」（该路由不可写时）。

按钮（**禁用时鼠标悬停会说明原因** —— 置灰而不解释就是"点了没反应"）：

- **同步模型**：GET 该路由的 `/models`，把用户层没有的模型追加到 `models` 末尾
  （带 `{ id, name }`，能确认的再带 `reasoningEfforts`）。已存在的条目原样不动。
- **补全思考等级（N）**：只给「没有声明过 `reasoningEfforts` 且家族可确认」的模型写入建议。
  该路由没有可自动补全的模型时此按钮置灰，悬停会说明是"声明已完整"还是"家族认不出来"。
- **用通用模板补全（N）**：仅当存在「认不出家族」的模型时出现。写的是通用模板
  `off: null / low / medium / high`；上游是否支持这套拼写无法预先确认，所以它**必须由你点**，
  永远不参与自动补全。补完的模型会在结果里标为"用了通用模板"。
- **对齐窗口与输出（N）**：调用 DSH 自己的模型发现（`ctx.llm.discoverModels('llm-pi-ai', …)`），
  把 `contextWindow` 与 `maxTokens` 写进用户层里**还没声明这两项**的模型。数值优先来自 pi-ai
  的已装目录，目录里没有才回到上游 `/models`（那里已兼容 `context_length`、`max_input_tokens`、
  `limit.context`、`max_output_tokens`、`top_provider.max_completion_tokens` 等拼写）。

  为什么值得做：模型条目缺这两项时，DSH 会退回路由级的 `defaultContextWindow` /
  `defaultMaxTokens`，上下文预算与溢出判定都会按那个默认值算。对齐后按真实容量计算。

  两点设计取舍：**插件自己不带任何规格数字** —— 数值全部来自 DSH 的发现结果（官方目录或
  上游），所以不会像硬编码的规格表那样随模型更新而过期；**已经填好的数值一律不覆盖**，
  只填空缺。

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
node --test test/host.test.mjs test/client.test.mjs   # 22 项
node test/cordis-smoke.mjs                            # 真实 cordis 冒烟
```

- `test/host.test.mjs`：mock cordis 上下文与假 `/models` 响应，端到端驱动宿主逻辑 ——
  视图构建、只补缺失、已有声明原样保留、底座层路由拒绝写入、同步追加与凭据使用、
  上游报错不写入、非本机拒绝、未知端点、无 web 服务时仍可加载；对齐部分另外覆盖
  发现结果驱动写入、已有容量不被覆盖、发现失败只记原因不写入、缺 `llm` 服务时报可读原因。
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
dsh plugin --profile desktop add file:C:/Users/asus/dsh-plugins/dsh-relay-toolkit
```

然后重启 DSH Desktop。

## 已知边界

- 「未识别家族」的模型不会被补全，需要你自己在 settings.yaml 里手写 `reasoningEfforts`
  （合法等级键见上表）。
- 中转站 `/models` 若返回非 `{ data: [...] }` 结构会报错并保持配置不变。
- 中转站返回的模型 id 会原样写入；若你的中转站把渠道前缀写进 id（如 `openai/gpt-5.5`），
  同步进来的也就是那个 id。
