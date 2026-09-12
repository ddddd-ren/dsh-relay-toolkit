# 模型规格核对表

> 核对日期：2026-09-11（2026-09-13 补充 Kimi Code 的 4 个 Model ID）
> 方法：只采信厂商官方来源（官方 API 文档、官方发布公告、云厂商官方模型表）；每个数值附来源 URL。
> 查不到官方数值的一律标注「未找到官方数据」，不按模型名推测。
>
> 用途：给 `dsh-relay-toolkit` 的「对齐窗口与输出」提供 `discoverModels` 之外的参考值，
> 并顺带发现配置里已退役、已过期或规格可疑的模型。

## 最重要的一条结论

**同一个模型名，在不同平台的上限是不一样的。** 本表核对时就撞到三处：

| 模型 | 原厂官方 | 第三方平台（阿里云百炼） |
|---|---|---|
| `MiniMax-M3` | **1,000,000**（MiniMax 官方文档） | **192k**（阿里云官方页） |
| `MiniMax-M2.7` | **204,800**（MiniMax 官方） | **192k**（阿里云） |
| `glm-5.1` | **200K**（智谱官方） | **198k**（阿里云） |

所以这张表是**参考值，不是你的中转站的真实值**。真实值只有一个可靠来源：
中转站自己（`/models` 元数据），或者 DSH 的 `ctx.llm.discoverModels()` —— 插件那一步会先问它。

三种来源形态要分清：

| 形态 | 规格由谁决定 | 本表是否适用 |
|---|---|---|
| **官方 API 转发** | 厂商官方 | 适用 |
| **原厂直供**（云厂商标明） | 厂商官方，经云平台转售 | 通常适用，但也可能加限制（见上表） |
| **第三方自部署**（开源权重） | **部署方自己**（可裁剪上下文、可量化） | **不适用** |

---

## DeepSeek（官方 API）

来源：<https://api-docs.deepseek.com/quick_start/pricing>、
<https://api-docs.deepseek.com/guides/thinking_mode>、
<https://api-docs.deepseek.com/news/news260910>

| 官方模型名 | 上下文窗口 | 最大输出 | 思考等级 |
|---|---|---|---|
| `deepseek-flash`（=V4.1-Flash） | **1M** | **384K** | `low`/`high`/`max`，默认 `high`，思考默认开启 |
| `deepseek-v4-pro`（=V4-Pro-0813） | **1M** | **384K** | 同上 |

请求值 → 实际值映射：`minimal→low`、`low→low`、`medium→high`、`high→high`、
`xhigh→high`、`max→max`、`ultra→max`。

**命名澄清**：`deepseek-v4.1-flash` **未出现在官方文档中**，官方要求的模型名是
`deepseek-flash`，前者只是社区/中转站的习惯写法。`deepseek-v4-flash-0731` 的窗口与输出
官方未单列（只说与 V4-Flash-Preview"结构、尺寸保持一致"）。

### 生命周期（2026-09 官方公告）

| 模型 id | 状态 |
|---|---|
| `deepseek-v4-flash` | **已退役**（兼容路由到 V4.1-Flash） |
| `deepseek-v4-flash-vision-exp` | **已退役**（同上） |
| `deepseek-v4-pro` | **2026-09-14 04:00 UTC 起全部改路由到 V4.1-Flash**，直到 V4.1-Pro 发布 |
| `deepseek-flash` | 在售，当前推荐名 |

---

## 智谱 GLM（官方文档 docs.bigmodel.cn）

| 模型 | 上下文窗口 | 最大输出 | 思考等级 | 来源 |
|---|---|---|---|---|
| `glm-5.1` | **200K** | **128K** | `thinking.type` = enabled（默认）/disabled；**不支持** `reasoning_effort`（官方：仅 5.2 及以上支持） | <https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1> |
| `glm-5.2` | **1M** | **128K** | `reasoning_effort` = `max`（默认）/`xhigh`/`high`/`medium`/`low`/`minimal`/`none`；可按轮关闭思考 | <https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2> |
| `glm-5.3` | **1M** | **128K** | 仅 `low`/`high`/`max`（默认 `max`）；**强制思考、不可关闭** | <https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3> |
| `glm-5.3-flash` | **1M** | **128K** | 同 5.3；原生多模态（视频/图像/文本/文件） | <https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash> |

**破坏性变更**：`glm-5.3` 起不再支持关闭思考，官方明确仍发 `thinking.type: "disabled"`
的请求**会失败**（迁移：改成 `enabled` + `reasoning_effort: low`）。

---

## 月之暗面 Kimi

Kimi 有**两个入口，model id 不同**，别混用：

- **API 开放平台**（`platform.kimi.com`，按量计费）：`kimi-k3`、`kimi-k2.7-code`、`kimi-k2.6`
- **Kimi Code**（`kimi.com/code`，订阅制，Base URL `https://api.kimi.com/coding/v1`）：
  `k3`、`k3-256k`、`kimi-for-coding`、`kimi-for-coding-highspeed`

来源：<https://platform.kimi.com/docs/api/models-overview>、
<https://www.kimi.com/code/docs/kimi-code/models.html>

### API 开放平台

| 模型 | 上下文窗口 | 最大输出 | 思考控制 |
|---|---|---|---|
| `kimi-k3` | **1M** | `max_completion_tokens` 默认 131072，**最大 1048576** | `reasoning_effort`: `low`/`high`/`max`（默认 `max`）；始终思考、不可关闭 |
| `kimi-k2.7-code` | **256K** | 官方只给默认值 **32768**，未公布上限 | `thinking` 仅接受 `{"type":"enabled","keep":"all"}`；**不支持** `reasoning_effort` |
| `kimi-k2.6` | **256K** | 官方只给默认值 **32768**，未公布上限 | `thinking` 支持 `enabled`（默认）/`disabled`/`enabled`+`keep:"all"`；不支持 `reasoning_effort` |

### Kimi Code（订阅制）

2026-09-11 起 `kimi-for-coding` 已由 **K2.8 Preview** 接管，且**Model ID 保持不变** ——
也就是说这个 id 的规格会随产品升级而变，插件里的数值必须按核对日期复查。

| Model ID | 版本 | 上下文窗口 | 思考程度 | 多模态输入 |
|---|---|---|---|---|
| `k3` | K3 | **1048576** | `reasoning_effort`: `low`/`high`/`max`（默认 `high`） | 图片、视频 |
| `k3-256k` | K3 | **262144** | 同上 | 仅图片 |
| `kimi-for-coding` | **K2.8 Preview** | **1048576** | `reasoning_effort`: `low`/`high`/`max`（默认 `max`） | 图片、视频 |
| `kimi-for-coding-highspeed` | K2.7 Code HighSpeed | **262144** | `Thinking:ON`（**无档位**） | 图片、视频 |

工具传入的 effort 官方映射（原文照抄）：

```
null / undefined       → 模型默认值（K3 为 high，K2.8 Preview 为 max）
其它未知取值            → HTTP 400 请求报错
ultra / max / xhigh    → max
high / medium          → high（推荐）
low / minimum / light  → low
none                   → thinking.type disabled
```

**子串冲突提示**：`kimi-for-coding` 是 `kimi-for-coding-highspeed` 的前缀，而前者有三档、
后者只有 Thinking 开关。插件的规则表靠「最长命中优先」区分这两者 —— 改动那张表时必须
保住这个性质，否则会给高速版错误地补上档位。

K3 官方注明：输入长度 + `max_completion_tokens` 超出窗口会返回 `invalid_request_error`；
切换 effort 档位会破坏前缀缓存命中。

---

## 腾讯混元（腾讯云 TokenHub 官方模型表，2026-09-10 更新）

来源：<https://cloud.tencent.com.cn/document/product/1823/130051>

| 模型 | 上下文窗口 | 最大输入 | 最大输出 |
|---|---|---|---|
| `hy3` | **256k** | 192k | **128k** |
| `hy4-preview` | **1M** | 960k | **64k** |

`hy3` / `hy4-preview` **就是官方 model 参数本身**，不是简写别名；两者规格差异不小。

---

## 阿里 Qwen（官方文档 help.aliyun.com）

来源：<https://help.aliyun.com/zh/model-studio/text-generation-model>、
<https://www.alibabacloud.com/help/tc/model-studio/qwen3-8-max>

| 模型 | 上下文 | 最大输出 | 思考等级 |
|---|---|---|---|
| `qwen3.8-max` | **1M** | **131,072** | `reasoning_effort` = `low`/`medium`/`xhigh`（默认 `xhigh`）；`max`→xhigh、`high`→xhigh、`minimal`→low；不可与 `thinking_budget` 同传 |
| `qwen3.8-flash` | **1M** | **131,072** | `reasoning_effort` = `xhigh`（默认）/`medium`/`low`；`max`/`high`→xhigh |
| `qwen3.7-plus` | **1M** | **131,072** | 混合模式默认开启，`thinking_budget` 控制深度（官方档位表未覆盖 3.7 系列） |
| `qwen3.7-max` | **1M** | **131,072** | 同上；已被阿里列为**旧版模型**，快照 `qwen3.7-max-2026-06-08` 等 |

补充：3.7 系列最大输入 991,808（思考模式 983,616），最大思维链 262,144。
**官方冲突**：QwenCloud 总表把 3.7 系列最大输出记作 64k，与百炼的 131,072 不一致，原样并列。

同页第三方模型（阿里云转售）上下文：`glm-5.1` 198k、`MiniMax-M3` 192k、`MiniMax-M2.7` 192k、
`kimi-k2.7-code` 256k、`deepseek-v4-pro`/`deepseek-v4-flash` 1M、`mimo-v2.5-pro` 1M。

---

## MiniMax（官方文档 platform.minimaxi.com）

来源：<https://platform.minimaxi.com/docs/guides/text-generation>、
<https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json>

| 模型 | 上下文窗口 | 最大输出 | 思考控制 |
|---|---|---|---|
| `MiniMax-M3` | **1,000,000** | 官方模型页未列（schema 归类：推荐 131,072 / 最大 524,288） | `thinking.type` = `adaptive`（默认）/`disabled` |
| `MiniMax-M2.7` | **204,800** | 官方未逐型号公布（schema 归类 65,536 / 204,800） | 无档位（不能关闭思考） |
| `MiniMax-M2.7-highspeed` | **204,800** | 同上 | 同上 |
| `MiniMax-M2.5` / `M2.5-highspeed` | 204,800 | — | — |
| `MiniMax-M2.1` | 204,800 | — | — |
| `M2-her` | 64K | — | — |

官方注明 M2.7 及更早为**历史模型，仍正常提供服务**。**输出上限官方未逐型号点名** —— 本表与
插件规格表都刻意留空，不拿 schema 归类值或上代型号（M2 的 200k/128k 含 CoT）硬凑。

注意：阿里云百炼上的 `MiniMax-M3` 只给 **192k**，与官方 1,000,000 冲突 —— 转售会加限制。

---

## 小米 MiMo（官方文档 mimo.mi.com）

来源：<https://mimo.mi.com/docs/zh-CN/quick-start/summary/model>、
<https://mimo.xiaomi.com/mimo-v2-5-pro>

| 模型 | 上下文窗口 | 最大输出 | 思考控制 |
|---|---|---|---|
| `mimo-v2.5` | **1M** | **128K** | 仅开关：`thinking.type` = `enabled`（默认）/`disabled`，无多档 |
| `mimo-v2.5-pro` | **1M** | **128K** | 同上；思考模式下 `temperature`/`top_p` 不可自定义 |

注意：开源基座 MiMo-V2.5-Base / Pro-Base 是 **256K**，与 API 型号的 1M 不是一回事，别混用。

---

## 国外厂商（本轮**未能取得官方数值**）

这一节必须连同限制一起读 —— 本轮核对的网络环境**无法访问绝大多数国外厂商官方站点**：

| 厂商 | 官方域状态 |
|---|---|
| OpenAI | `developers.openai.com`、`platform.openai.com`、`openai.com` 全部 **HTTP 403**（Cloudflare 拦截） |
| Google | `ai.google.dev`、`cloud.google.com`、`deepmind.google` 全部连接失败；`blog.google` 正文被截断 |
| xAI | `x.ai`、`docs.x.ai` 连接失败 |
| Meta | `llama.com`、`ai.meta.com`、`huggingface.co` 连接失败 |
| Mistral | `mistral.ai`、`docs.mistral.ai` 连接失败 |
| Anthropic | API 文档站被重定向到官网，正文取不到；官网本身可读 |

所以**国外模型的上下文窗口 / 最大输出 / 思考档位，一律标注「未找到官方数据」**，不采信任何
第三方站点流传的数字（例如 grok-4-fast 的"2M"、Gemini 的"2M"，均无官方佐证）。

唯一可读的间接来源是 **AWS Bedrock model card**（AWS 官方文档，**不是模型厂商官方**），它给出：
`claude-fable-5-1` / `claude-mythos-5-1` / `claude-opus-5` / `claude-sonnet-5` = 1M 上下文 / 128K 输出；
`claude-haiku-4-5` = 200K / 64K；`mistral-large-3` = 256K / 32K；`gpt-6-astra` = 1,050,000 / 128,000。
**这些请当作云平台口径，不是厂商口径。**

### 仍然值得记下的两条结论

1. **Anthropic 命名早已换代**：当前产品线是 Claude **Fable 5.1** / **Mythos 5.1**（2026-09-01）、
   **Opus 5**（2026-07-24）、**Sonnet 5**（2026-06-30）、**Haiku 4.5**（未换代）。
   `claude-opus-4.x` / `claude-sonnet-4.x` 那套写法已经过时。注意 Anthropic 官方产品页的
   `<h1>` 仍写着旧版本号（Opus 4.8 / Sonnet 4.6），只有正文是新版 —— 只看标题会取到错误版本。
2. **OpenAI 已有更新的旗舰 `gpt-6-astra`**（2026-09-08），且 GPT-5.6 是 **Sol / Terra / Luna
   三个分档**，不带后缀的 `gpt-5.6` 未见官方模型页。

要补齐国外这块，需要能绕过 Cloudflare/网络封锁的环境，重点核对：
`developers.openai.com/api/docs/models/compare`、
`platform.claude.com/docs/en/about-claude/models/overview`、
`ai.google.dev/gemini-api/docs/models`、`docs.x.ai/docs/models`、
`docs.mistral.ai/getting-started/models`。

---

## 本机配置映射

`C:\Users\asus\.dsh\settings.yaml` 里那 30 个 id 的归属判断：

| 配置里的 id | 判断 | 建议 |
|---|---|---|
| `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` | 官方**已退役**，兼容路由到 V4.1-Flash | 可保留（仍能调用），但要知道实际服务的是 V4.1-Flash |
| `deepseek-v4.1-flash-expires-on-0910` | **中转站临时渠道名**（读作 "expires on 0910"），官方无此 id | **已到期，建议移除** |
| `deepseek-v4-pro`、`deepseek-v4-pro-0813` | 官方名；9/14 起改路由到 V4.1-Flash | 无需改动，注意服务模型会变 |
| `deepseek-v4-flash-0731` | 日期快照名；官方未单列规格 | 可保留 |
| `glm-5.1` / `glm-5.2` / `glm-5.3` / `glm-5.3-flash` | 官方名，均在售 | — |
| `kimi-k2.6` / `kimi-k2.7-code` / `kimi-k3` | 官方名 | — |
| `k3` | 与 `kimi-k3` 在同一路由并存 | **疑似同物别名，待确认** |
| `hy3` / `hy4-preview` | **官方名本身**，非简写 | — |
| `qwen3.7-max` / `qwen3.7-plus` / `qwen3.8-max` / `qwen3.8-flash` | 官方名（`3.7-max` 属旧版） | — |
| `MiniMax-M2.7` / `MiniMax-M2.7-highspeed` / `MiniMax-M3` / `minimax-m3` | 官方名；`minimax-m3` 与 `MiniMax-M3` 大小写不同，**疑似同物** | 二选一即可 |
| `mimo-v2.5` / `mimo-v2.5-pro` | `-pro` 在阿里云在架；非 pro 待确认 | — |
