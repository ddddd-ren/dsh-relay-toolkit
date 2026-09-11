# 模型规格核对表

> 核对日期：2026-09-11
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

## 月之暗面 Kimi（官方文档 platform.kimi.com）

| 模型 | 上下文窗口 | 最大输出 | 思考控制 | 来源 |
|---|---|---|---|---|
| `kimi-k3` | **1M** | `max_completion_tokens` 默认 131072，**最大 1048576** | `reasoning_effort`: `low`/`high`/`max`（默认 `max`）；始终思考、不可关闭 | <https://platform.kimi.com/docs/api/models-overview> |
| `kimi-k2.7-code` | **256K** | 官方只给默认值 **32768**，未公布上限 | `thinking` 仅接受 `{"type":"enabled","keep":"all"}`；**不支持** `reasoning_effort` | 同上 |
| `kimi-k2.6` | **256K** | 官方只给默认值 **32768**，未公布上限 | `thinking` 支持 `enabled`（默认）/`disabled`/`enabled`+`keep:"all"`；不支持 `reasoning_effort` | 同上 |

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

来源：<https://help.aliyun.com/zh/model-studio/text-generation-model>

| 模型 | 上下文 | 状态 |
|---|---|---|
| `qwen3.8-max` | **1M** | 推荐（最强推理），快照 `qwen3.8-max-0902` |
| `qwen3.8-flash` | **1M** | 推荐（轻量低成本） |
| `qwen3.7-plus` | **1M** | 推荐（能力成本均衡，Agent 首选） |
| `qwen3.7-max` | **1M** | **旧版模型**（不再首选推荐），快照 `qwen3.7-max-2026-06-08` 等 |

所有 Qwen3 及以上模型均支持思考模式，通过 `enable_thinking` 开启（Responses API 用
`reasoning.effort` 控制开关与深度）。**最大输出该页未给。**

同页第三方模型（阿里云转售）的上下文：`glm-5.1` 198k、`MiniMax-M3` 192k、
`MiniMax-M2.7` 192k、`kimi-k2.7-code` 256k、`deepseek-v4-pro`/`deepseek-v4-flash` 1M、
`mimo-v2.5-pro` **1M**。

---

## MiniMax（官方文档 platform.minimaxi.com）

来源：<https://platform.minimaxi.com/docs/guides/text-generation>

| 模型 | 上下文窗口 | 说明 |
|---|---|---|
| `MiniMax-M3` | **1,000,000** | 最新旗舰，原生多模态，输出约 100+ TPS |
| `MiniMax-M2.7` | **204,800** | 输出约 60 TPS |
| `MiniMax-M2.7-highspeed` | **204,800** | M2.7 极速版（官方明示：效果不变、更快） |
| `MiniMax-M2.5` / `M2.5-highspeed` | 204,800 | |
| `MiniMax-M2.1` | 204,800 | |
| `M2-her` | 64K | 对话/角色扮演 |

官方注明 M2.7 及更早为**历史模型，仍正常提供服务**。**最大输出该页未给。**

注意：阿里云百炼上的 `MiniMax-M3` 只给 **192k**，与官方 1,000,000 冲突 —— 转售会加限制。

---

## 小米 MiMo

`mimo-v2.5-pro` 在阿里云百炼官方页列为 **1M 上下文**（来源同 Qwen 章节）。
`mimo-v2.5`（非 pro）与两者的最大输出**未找到官方数据**，待补。

---

## 待核对

- 国外：OpenAI、Anthropic、Google、xAI、Meta、Mistral
- 各家的**最大输出**上限（多家官方页只给上下文，不给输出）

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
