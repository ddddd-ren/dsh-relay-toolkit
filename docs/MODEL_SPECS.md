# 模型规格核对表

> 核对日期：2026-09-16（2026-09-13 补充 Kimi Code 的 4 个 Model ID；2026-09-16 复核
> 各厂商官方页，补入 Kimi K2.7 Code 高速版、腾讯 Hy-MT2 / Hy-Role、Qwen3.7-Flash 等新条目，
> 并修正 DeepSeek V4-Pro 的生命周期结论）
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

### 生命周期（2026-09-16 复核更新）

| 模型 id | 状态 |
|---|---|
| `deepseek-v4-flash` | **已退役**（兼容路由到 V4.1-Flash，按 Flash 价计费） |
| `deepseek-v4-flash-vision-exp` | **已退役**（同上） |
| `deepseek-v4-pro` | **在售，且官方已决定继续提供**。2026-09-10 公告原定 9/14 起把请求改路由到 V4.1-Flash，但**官方随后改口**：应客户需求，9 月 14 日之后继续提供 V4 Pro 的 API 服务、计费方式不变，后续如有变化再另行通知 |
| `deepseek-flash` | 在售，当前推荐名（= V4.1-Flash） |

**这一条推翻了 2026-09-13 版的结论**（当时记为「9/14 起全部改路由到 V4.1-Flash」）。
现在 `deepseek-v4-pro` 是**真实在售的独立模型**，不再是 V4.1-Flash 的兼容别名 ——
所以它保留自己的 1M / 384K 规格，档位也与 Flash 同族。中转站上同时列出两者是合理的。

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

来源：<https://platform.kimi.com/docs/models>、<https://platform.kimi.com/docs/guide/use-thinking-models>、
<https://platform.kimi.com/docs/guide/use-kimi-vision-model>

**2026-09-16 复核变化**：K3 已从「预告」转为**正式发布**（2.8T 参数、KDA 混合线性注意力，
官方称全球首个开源 3 万亿级模型）；模型列表新增 **`kimi-k2.7-code-highspeed`**（K2.7 Code 高速版）。

| 模型 | 上下文窗口 | 最大输出 | 思考控制 | 多模态输入 |
|---|---|---|---|---|
| `kimi-k3` | **1M** | `max_completion_tokens` 默认 131072，**最大 1048576** | `reasoning_effort`: `low`/`high`/`max`（默认 `max`）；始终思考、不可关闭 | 图片、视频 |
| `kimi-k2.7-code` | **256K** | 官方只给默认值 **32768**，未公布上限 | `thinking` 仅接受 `{"type":"enabled","keep":"all"}`；**不支持** `reasoning_effort` | 图片、视频 |
| `kimi-k2.7-code-highspeed` | **256K** | 未公布（与普通版同模型） | **与 `kimi-k2.7-code` 完全一致**（官方原文：同一个模型、思考行为一致，只提升输出速度） | 图片、视频 |
| `kimi-k2.6` | **256K** | 官方只给默认值 **32768**，未公布上限 | `thinking` 支持 `enabled`（默认）/`disabled`/`enabled`+`keep:"all"`；不支持 `reasoning_effort` | 图片、视频 |

**视觉能力的官方点名**（`/docs/guide/use-kimi-vision-model`）：能理解图片的 id 是
`kimi-k3` / `kimi-k2.6` / `kimi-k2.7-code` / `kimi-k2.7-code-highspeed`，其中除 `k2.6` 外还支持视频。
插件据此把 `kimi-k2.6` 与 `kimi-k2.7-code`（含高速版）也登记进多模态表。

**已下线**：`kimi-k2.5`、`moonshot-v1` 全系（含 `-vision-preview`）于 **2026-08-31 下线**；
`kimi-k2` 系列于 2026-05-25 下线；`kimi-k2-thinking` / `kimi-k2-thinking-turbo` 亦已下线。
中转站若仍列出它们，调用会失败。

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

## 腾讯混元（腾讯云 TokenHub 官方模型表，2026-09-15 更新）

来源：<https://cloud.tencent.com.cn/document/product/1823/130051>

| 模型 | 上下文窗口 | 最大输入 | 最大输出 |
|---|---|---|---|
| `hy3` | **256k** | 192k | **128k** |
| `hy4-preview` | **1M** | 960k | **64k** |
| `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite` | **8k** | 4k | **4k** |
| `hy-role` / `hunyuan-role-latest` | **32k** | 28k | **4k** |

`hy3` / `hy4-preview` **就是官方 model 参数本身**，不是简写别名；两者规格差异不小。

**2026-09-16 新增**：官方表里还有翻译（Hy-MT2 三档）与角色扮演（Hy-Role 两档）两组专用模型。
它们**只列了长度，没有「深度思考」能力项** —— 所以插件把 `hy-mt2*`、`hy-role`、
`hunyuan-role-latest` 登记为「认得出、但不给思考档位」，而不是留成「未识别」：
后者会让人用「通用模板补全」给它们写上无效档位。

顺带记一条同表信息：DeepSeek 系在 TokenHub 上以 `deepseek/deepseek-flash`、
`deepseek/deepseek-v4-pro` 这类**带渠道前缀**的 id 出现，并明确标注「原厂直供」。
这印证了 README 里那条边界 —— 中转站写什么 id，插件就同步什么 id。

---

## 阿里 Qwen（官方文档 help.aliyun.com）

来源：<https://help.aliyun.com/zh/model-studio/text-generation-model>、
<https://help.aliyun.com/zh/model-studio/qwen3-8-max>、
<https://help.aliyun.com/zh/model-studio/qwen3-7-flash>

| 模型 | 上下文 | 最大输出 | 思考等级 |
|---|---|---|---|
| `qwen3.8-max` | **1M** | **131,072** | `reasoning_effort` = `low`/`medium`/`xhigh`（默认 `xhigh`）；`max`→xhigh、`high`→xhigh、`minimal`→low；不可与 `thinking_budget` 同传 |
| `qwen3.8-flash` | **1M** | **131,072** | `reasoning_effort` = `xhigh`（默认）/`medium`/`low`；`max`/`high`→xhigh |
| `qwen3.7-plus` | **1M** | **131,072** | 混合模式默认开启，`thinking_budget` 控制深度（官方档位表未覆盖 3.7 系列） |
| `qwen3.7-flash` | **1M** | **131,072** | 同上；**原生视觉语言模型** |
| `qwen3.7-max` | **1M** | **131,072** | 同上；已被阿里列为**旧版模型**，快照 `qwen3.7-max-2026-06-08` 等 |

**2026-09-16 新增**：`qwen3.7-flash` 进入百炼「推荐模型」表（此前只在旧版/未列），
官方标注为原生视觉语言系列、强化多模态理解与 Agent 执行。规格与 3.7 系同族：1M 上下文、
最大输入 991,808（思考模式 983,616）、最大输出 131,072、最大思维链 262,144。

**多模态（逐个模型页确认，可用于「补全图像声明」）**：`qwen3.8-max`（含快照 `qwen3.8-max-0902`）、
`qwen3.8-flash`、`qwen3.7-plus`、`qwen3.7-flash` 的「输入模态」都写着 **Image / Text / Video**，
输出模态为 Text。这四者已登记进插件的多模态表。

`qwen3.8-max` 的快照名：`qwen3.8-max-0902`（别名 `qwen3.8-max-2026-09-02`）。

**官方冲突**：QwenCloud 总表把 3.7 系列最大输出记作 64k，与百炼的 131,072 不一致，原样并列。

同页第三方模型（阿里云转售）上下文：`glm-5.1` 198k、`glm-5` 198k、`MiniMax-M3` 192k、
`MiniMax-M2.7` 192k、`MiniMax-M2.5` 192k、`MiniMax-M2.1` 200k、
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

**多模态（2026-09-16 复核）**：官方博客 <https://www.minimax.cn/blog/minimax-m3> 原文写明
M3「是一个原生多模态模型，支持图片和视频的输入，并能操作电脑桌面」，且是「从 Step 0 开始
进行多模态混合训练」。所以 `MiniMax-M3` 已登记进插件的多模态表（补 `input: [text, image]`）。
M2.7 及更早的 M 系列**没有**这类官方表述，一律不补。

---

## 小米 MiMo（官方文档 mimo.mi.com）

来源：<https://mimo.mi.com/docs/zh-CN/quick-start/summary/model>、
<https://mimo.xiaomi.com/mimo-v2-5-pro>

| 模型 | 上下文窗口 | 最大输出 | 思考控制 |
|---|---|---|---|
| `mimo-v2.5` | **1M** | **128K** | 仅开关：`thinking.type` = `enabled`（默认）/`disabled`，无多档 |
| `mimo-v2.5-pro` | **1M** | **128K** | 同上；思考模式下 `temperature`/`top_p` 不可自定义 |

注意：开源基座 MiMo-V2.5-Base / Pro-Base 是 **256K**，与 API 型号的 1M 不是一回事，别混用。

**多模态差异（2026-09-16 复核，这是个真陷阱）**：官方模型表里，`mimo-v2.5` 的能力项含
**「全模态理解」**，`mimo-v2.5-pro` **只列了文本生成 / 深度思考 / 流式 / 函数调用 / 结构化输出 / 联网搜索**
—— **不含多模态理解**。官方「图片理解」文档的示例代码用的也正是 `model="mimo-v2.5"`。

两者共享 `mimo-v2.5` 前缀，最长命中分不开（命中长度都是 `mimo-v2.5`），所以插件的多模态表
给这条规则加了 `except`：`mimo-v2.5` 补图像声明，同前缀的 `mimo-v2.5-pro`（文本）、
`mimo-v2.5-asr`（语音识别）、`mimo-v2.5-tts*`（语音合成）**都不补**。
**改动那张表时必须保住这个排除**，否则会给这些专用模型错误地声明图像能力。

另：`mimo-v2-pro`、`mimo-v2-omni`、`mimo-v2-flash`、`mimo-v2-tts` 已于 **2026-06-30 下线**。

---

## 国外厂商（2026-09-16 复核：**仍然未能取得官方数值**）

这一节必须连同限制一起读 —— 本轮复核的网络环境**依旧无法访问绝大多数国外厂商官方站点**，
与 2026-09-11 那轮结论一致：

| 厂商 | 官方域状态（2026-09-16 实测） |
|---|---|
| OpenAI | `developers.openai.com/api/docs/models/compare` → **HTTP 403**（Cloudflare 拦截） |
| Google | `ai.google.dev/gemini-api/docs/models` → **连接失败** |
| Anthropic | `platform.claude.com/docs/...` → 被**跨域重定向**到 `www.anthropic.com`，正文取不到 |
| xAI | `x.ai`、`docs.x.ai` 连接失败 |
| Meta | `llama.com`、`ai.meta.com`、`huggingface.co` 连接失败 |
| Mistral | `mistral.ai`、`docs.mistral.ai` 连接失败 |

所以**国外模型的上下文窗口 / 最大输出 / 思考档位，一律标注「未找到官方数据」**，不采信任何
第三方站点流传的数字（例如 grok-4-fast 的"2M"、Gemini 的"2M"，均无官方佐证）。
插件的多模态表同样一个国外模型都不收 —— 认不出就不写。

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
| `deepseek-v4-pro`、`deepseek-v4-pro-0813` | 官方名；**2026-09-16 复核：官方已确认继续提供服务**，不再是「9/14 起改路由到 V4.1-Flash」 | 无需改动；它现在是真实在售的独立模型 |
| `deepseek-v4-flash-0731` | 日期快照名；官方未单列规格 | 可保留 |
| `deepseek-v4.1-flash` | 中转站习惯写法；官方要求的模型名是 `deepseek-flash` | 可保留（多数中转站只认这个 id） |
| `glm-5.1` / `glm-5.2` / `glm-5.3` / `glm-5.3-flash` | 官方名，均在售 | — |
| `kimi-k2.6` / `kimi-k2.7-code` / `kimi-k3` | 官方名 | — |
| `k3` | 与 `kimi-k3` 在同一路由并存 | **同物别名**（Kimi Code 侧的名字），插件已按别名归一化 |
| `hy3` / `hy4-preview` | **官方名本身**，非简写 | — |
| `qwen3.7-max` / `qwen3.7-plus` / `qwen3.8-max` / `qwen3.8-flash` | 官方名（`3.7-max` 属旧版） | — |
| `MiniMax-M2.7` / `MiniMax-M2.7-highspeed` / `MiniMax-M3` / `minimax-m3` | 官方名；`minimax-m3` 与 `MiniMax-M3` 大小写不同，**同物** | 二选一即可 |
| `mimo-v2.5` / `mimo-v2.5-pro` | 均为官方名，均在架；**只有非 pro 版支持全模态理解** | 需要读图时选 `mimo-v2.5` |

### 本轮（2026-09-16）复核后可考虑加入的官方新模型

下列 id 已在本轮取得官方来源，插件也已登记规格/档位/多模态，但**你的中转站未必已上架** ——
用设置页的「同步模型」拉到什么就以什么为准：

| 官方 id | 规格 | 说明 |
|---|---|---|
| `kimi-k2.7-code-highspeed` | 256K | K2.7 Code 高速版，官方称与普通版同模型、思考行为一致 |
| `qwen3.7-flash` | 1M / 131072 | 原生视觉语言模型，百炼推荐表新列 |
| `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite` | 8k / 4k | 混元翻译专用（无思考档位，插件刻意不写） |
| `hy-role` / `hunyuan-role-latest` | 32k / 4k | 混元角色扮演专用（同上） |
| `glm-ocr` | 单图 ≤10MB、PDF ≤50MB | 智谱轻量 OCR（无对话档位） |

`glm-image`（图像生成）、`cogvideox-3`（视频生成）、`glm-asr-2512`（语音识别）、`glm-tts`（语音合成）、
`embedding-3`（向量）等**非对话模型**不在本插件的适用范围内：它们没有 `reasoningEffort` 与
`contextWindow` 语义，插件也不会给它们写任何字段。
