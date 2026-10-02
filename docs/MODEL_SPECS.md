# 模型规格核对表

> 核对日期：**2026-10-03**（本轮补入国外厂商与小米 V2.6；前几轮：2026-09-16 复核各厂商
> 官方页并补入 Kimi K2.7 Code 高速版、腾讯 Hy-MT2 / Hy-Role、Qwen3.7-Flash 等；
> 2026-09-13 补充 Kimi Code 的 4 个 Model ID；2026-10-02 补入 xAI Grok 全系档位）
> 方法：只采信厂商官方来源（官方 API 文档、官方发布公告、官方 SDK 生成代码、云厂商官方模型卡）；
> 每个数值附来源 URL，并**标明是厂商口径还是云平台口径**。查不到官方数值的一律标注
> 「未找到官方数据」，不按模型名推测。
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
<https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/deep-thinking>、
<https://mimo.mi.com/docs/zh-CN/updates/deprecate>

**2026-10-03 复核**：官方模型表已更新到 **V2.6 系列**（页面更新日期 2026-09-22）。

| 模型 | 上下文窗口 | 最大输出 | 思考控制 | 多模态 |
|---|---|---|---|---|
| `mimo-v2.6-pro` | **1M** | **128K** | 仅开关：`thinking.type` = `enabled`（默认）/`disabled`，无多档 | **全模态理解** ✅ |
| `mimo-v2.6-flash` | **1M** | **128K** | 同上 | **全模态理解** ✅ |
| `mimo-v2.6-pro-ultraspeed` | **1M** | **128K** | 同上 | **全模态理解** ✅ |
| `mimo-v2.5` | 1M | 128K | 同上 | 全模态理解 ✅ |
| `mimo-v2.5-pro` | 1M | 128K | 同上；思考模式下 `temperature`/`top_p` 不可自定义 | **无**多模态理解 ❌ |

⚠️ **下线公告（官方）**：`mimo-v2.5` 与 `mimo-v2.5-pro` 将于北京时间 **2026.10.21 10:00**
下线，且**无系统替换模型**（到期直接报错，不会自动改路由）。请尽快切到 `mimo-v2.6-*`。

**多模态差异（这是个真陷阱，两代分布相反）**：官方模型表里，
**V2.6 三款都带「全模态理解」**（该能力单元格 rowspan 覆盖 pro / flash / pro-ultraspeed 三行）；
而 **V2.5 只有非 pro 版有** —— `mimo-v2.5-pro` 只列了文本生成 / 深度思考。

所以插件的多模态表**为两代各写一条规则**，不能合并成一个 `mimo-v2` 前缀：
合并会让 V2.5 的 pro 版被错误地声明成能收图。V2.5 那条另带 `except`，排除
`mimo-v2.5-pro`（文本）、`mimo-v2.5-asr`（语音识别）、`mimo-v2.5-tts*`（语音合成）——
它们的最长命中长度都是 `mimo-v2.5`，单靠最长命中分不开。
**改动那张表时必须保住这个排除**，否则会给这些专用模型错误地声明图像能力。

注意：开源基座 MiMo-V2.5-Base / Pro-Base 是 **256K**，与 API 型号的 1M 不是一回事，别混用。

另：`mimo-v2-pro`、`mimo-v2-omni`、`mimo-v2-flash`、`mimo-v2-tts` 已于 **2026-06-30 下线**。

---

## 国外厂商（2026-10-03 复核：**部分已取得官方数据**）

上一轮（2026-09-16）记录「全部不可达」，本轮网络环境有变化，逐域实测结果：

| 厂商 | 官方域状态（2026-10-03 实测） | 本轮结论 |
|---|---|---|
| OpenAI | `developers.openai.com` → **仍 HTTP 403**（Cloudflare）；但 **Azure/Microsoft Foundry 官方文档可达**，且其 markdown 源在官方 GitHub 仓库可直取 | ✅ 取到逐型号的档位与规格表 |
| Anthropic | `platform.claude.com` → 跨域重定向到 `www.anthropic.com`（404）；`docs.claude.com` 与之形成重定向环。但 **`code.claude.com` 可达**，官方 SDK 的 GitHub 仓库亦可直取 | ✅ 取到官方 effort 枚举；规格取 Bedrock 卡 |
| xAI | `docs.x.ai` 仍不可达；改用转载其规格的云厂商模型卡 | ✅ 已由 AWS / Oracle / Cloudflare 三方交叉核对（见 Grok 节） |
| Google | `ai.google.dev`、`cloud.google.com`、`docs.cloud.google.com`、`generativelanguage.googleapis.com` **全部抓取失败**；`r.jina.ai` 代理亦失败 | ⚠️ 仅取到官方 SDK 的 `thinking_level` 枚举，**规格一个数字都没有** |
| Meta / Mistral | 未重测 | 未取得 |

### OpenAI（Azure / Microsoft Foundry 官方文档 —— **云平台口径**）

来源：<https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning>
（官方 markdown 源：<https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/how-to/reasoning.md>）

**档位枚举**：`none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`，但**可用范围逐型号收窄**。
官方原文（API 支持表脚注）：

- `max` —— **只在 GPT-6 或 GPT-5.6 且使用 Responses API** 时可用
- `xhigh` —— 只支持 GPT-6 / GPT-5.6 / GPT-5.5 / GPT-5.4 / `gpt-5.1-codex-max`
- `minimal` —— 只支持**初代** GPT-5 推理模型；**`gpt-5.1` 及更高不支持**
- `none`（关闭推理）—— 支持 5.6 / 5.5 / 5.4 / 5.2 / 5.1 系列（初代 GPT-5 **不在**列表中）
- `gpt-5-pro` —— **只支持 `high`**，且它就是默认值

| 模型 | 上下文 | 最大输出 | 档位（本插件写入值） |
|---|---|---|---|
| `gpt-6-*`（astra / sol / luna） | **1,050,000** | **128,000** | `none`/`low`/`medium`/`high`/`xhigh` |
| `gpt-5.6-*`（sol / terra / luna） | **1,050,000** | **128,000** | 同上 |
| `gpt-5.5` / `5.4` / `5.2` / `5.1` | 400,000 | 128,000 | 同上 |
| `gpt-5.1-chat` | 128,000 | **16,384** | 同上 |
| `gpt-5.1-codex-max` | 400,000 | 128,000 | 同上（5.1 系里唯一有 `xhigh`） |
| `gpt-5-pro` | 400,000 | 128,000 | **仅 `high`** |
| 初代 `gpt-5*`（含 -mini / -nano / -codex） | 400,000 | 128,000 | `minimal`/`low`/`medium`/`high`（**无** `none`） |

> **插件刻意不写 `max`**：本插件服务的路由是 OpenAI 兼容的 `openai-completions`
> （走 Chat Completions），而官方明确 `max` 只在 Responses API 下工作。写进去等于让
> 界面显示一个在该协议下必然被拒的档位。注意这与 Claude 的 `max` 无关 —— 后者是
> Anthropic 自己的 effort 枚举，不受 OpenAI 的 Responses API 限制。

**o 系列（推理模型）**：官方支持表对 `codex-mini` / `o3-pro` / `o4-mini` / `o3` / `o3-mini` / `o1`
**全部**标了「Reasoning effort ✅」，但**未逐型号列出枚举**。规格统一 200,000 输入 / 100,000 输出。

插件按官方那三条适用范围约束反推，只写唯一确定可用的三档 `low` / `medium` / `high`：

| 档位 | 官方原文的适用范围 | o 系列能否用 |
|---|---|---|
| `none` | 5.6 / 5.5 / 5.4 / 5.2 / 5.1 系列 | ❌ 列表不含 o 系列 |
| `minimal` | "only with the **original GPT-5** reasoning models" | ❌ 不是 GPT-5 |
| `low`/`medium`/`high` | 通用枚举 | ✅ |
| `xhigh` | GPT-6 / 5.6 / 5.5 / 5.4 / `gpt-5.1-codex-max` | ❌ 限定更新的型号 |
| `max` | GPT-6 / 5.6 且 Responses API | ❌ |

官方另有两处脚注，插件都已单独处理：**`o1-mini` 不支持 `reasoning_effort`**；
**`gpt-5-codex` 不支持 `minimal`**。

### Mistral（AWS Bedrock 官方模型卡 —— **云平台口径**）

| 模型 | 上下文 | 最大输出 | 档位 |
|---|---|---|---|
| `mistral-large-3` | 256K | 32K | **卡片未提 reasoning**，插件只写规格、不写档位 |

来源：<https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-mistral-large-3.html>

Mistral 其余型号（`mistral-medium-3`、`magistral-medium` 等）本轮未取得官方数据，插件无规则。

### Anthropic Claude

**档位枚举（厂商官方一手来源，Anthropic 官方 SDK 的生成代码）**：
`output_config.effort` = `low` / `medium` / `high` / `xhigh` / `max` —— **共 5 档，注意有 `xhigh`**。
来源：<https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/src/anthropic/types/output_config_param.py>

**Messages API 顶层没有 `reasoning_effort` 字段**，effort 挂在 `output_config` 下。

`thinking` 是四选一联合类型，**支持关闭**：`{"type":"enabled","budget_tokens":N}`（N≥1024）、
`{"type":"disabled"}`、`{"type":"adaptive"}`、`{"type":"between_tools"}`。

> **插件刻意不写 `off`**：Anthropic 关闭思考是 `thinking: {"type":"disabled"}`，它**不是**
> effort 的一个档位值。写成 `off` 会让 DSH 显示一个「关闭思考」选项，而实际效果只是
> 不发 effort 字段、思考照旧按默认开启 —— 那是误导。

上下文窗口与最大输出（**云平台口径**，AWS Bedrock 官方模型卡）：

| 模型 id | 上下文 | 最大输出 | 能否关闭思考 | 来源 |
|---|---|---|---|---|
| `claude-fable-5` / `claude-mythos-5-1` | 1M | 128K | **否**（官方原文 "adaptive thinking is always on and cannot be disabled"） | [Fable 5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5.html) |
| `claude-opus-5` | 1M | 128K | 是（禁用时 effort 上限为 high） | [Opus 5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5.html) |
| `claude-sonnet-5` | 1M | 128K | 是 | [Sonnet 5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html) |
| `claude-opus-4-8` | 1M | 128K | 未列（卡片仅写 "Reasoning: Supported"，**未公布档位枚举**） | [Opus 4.8](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-8.html) |
| `claude-haiku-4-5` | 200K | 64K | 未列 | [Haiku 4.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html) |

`claude-opus-4-8` 与 `claude-haiku-4-5` 官方**未公布档位枚举**，插件因此登记为
「认得出、但不写档位」—— 免得界面把它们归进「认不出家族」再诱导用户用通用模板补上无效档位。

### Google Gemini

**档位枚举（厂商官方 SDK 生成代码）**：`thinking_level` = `MINIMAL` / `LOW` / `MEDIUM` / `HIGH`
（另有 `THINKING_LEVEL_UNSPECIFIED`）。REST 侧小写。
来源：<https://raw.githubusercontent.com/googleapis/js-genai/main/src/types.ts>、
<https://raw.githubusercontent.com/googleapis/python-genai/main/google/genai/types.py>

**关键区别**：Gemini 用的是 **`thinking_level`，不是 `reasoning_effort`** —— 后者在 Google 官方
SDK 与官方 proto 中**均不存在**。另有 `thinking_budget`（int32）与 `include_thoughts`（bool），
挂在 `GenerationConfig.thinking_config`。
来源：<https://raw.githubusercontent.com/googleapis/googleapis/master/google/ai/generativelanguage/v1beta/generative_service.proto>

**未找到官方数据**：Gemini 任何在售型号的**上下文窗口与最大输出**（一个数字都没有）；
**能否关闭思考**（官方 proto 里没有任何关闭字段，但也未说明 `thinking_budget=0` 的语义，
故不推断）。插件因此**不给 Gemini 写规格**，只写与官方枚举同名的四档。

### 仍然值得记下的两条结论

1. **Anthropic 命名早已换代**：当前产品线是 Claude **Fable 5.1** / **Mythos 5.1**（2026-09-01）、
   **Opus 5**（2026-07-24）、**Sonnet 5**（2026-06-30）、**Haiku 4.5**（未换代）。
   `claude-opus-4.x` / `claude-sonnet-4.x` 那套写法已经过时。注意 Anthropic 官方产品页的
   `<h1>` 仍写着旧版本号（Opus 4.8 / Sonnet 4.6），只有正文是新版 —— 只看标题会取到错误版本。
2. **OpenAI 已有更新的旗舰 `gpt-6-astra`**（2026-09-08），且 GPT-5.6 是 **Sol / Terra / Luna
   三个分档**，不带后缀的 `gpt-5.6` 未见官方模型页。

要补齐 Google 这块，需要能绕过网络封锁的环境，重点核对：
`ai.google.dev/gemini-api/docs/models`、`cloud.google.com/vertex-ai/generative-ai/docs/models`。

---

## 本机配置映射

DSH 0.2 起配置**不在 `~/.dsh/settings.yaml`**（旧文件会被一次性导入后改名成 `.imported`），
而在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里 `llm-pi-ai` 条目的 `config.providers`。

配置里那 30 个 id 的归属判断：

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
| `grok-4.5` / `grok-4.6` / `grok-4.7` | 官方名 | 声明**不要写 `off`**（4.5 起不可关闭推理）；4.6/4.7 可加 `xhigh` |
| `mimo-v2.5` / `mimo-v2.5-pro` | 均为官方名；**只有非 pro 版支持全模态理解** | ⚠️ **2026.10.21 下线，无替换**，请尽快切到 `mimo-v2.6-*` |

### 本轮（2026-10-03）新增适配

**你的中转站上已提供、但插件此前认不出的 10 个模型**（用设置页的「同步模型」拉进来时
会用到这些判定）：

| 模型 id | 档位判定 | 规格 | 图像 |
|---|---|---|---|
| `gpt-6-astra` / `gpt-5.6-sol` / `gpt-5.6-terra` | `none`/`low`/`medium`/`high`/`xhigh` | 1,050,000 / 128,000 | ✅ |
| `gpt-5.5` | 同上 | 400,000 / 128,000 | ✅ |
| `claude-fable-5` / `claude-opus-5` / `claude-sonnet-5` | `low`/`medium`/`high`/`xhigh`/`max`（**不写 `off`**） | 1M / 128K | ✅ |
| `claude-opus-4-8` | **刻意不写**（官方未公布枚举） | 1M / 128K | ✅ |
| `mimo-v2.6-pro` / `mimo-v2.6-flash` | **刻意不写**（只有 thinking 开关） | 1M / 128K | ✅ |

### 本轮复核后可考虑加入的官方新模型

下列 id 已取得官方来源，插件也已登记规格/档位/多模态，但**你的中转站未必已上架** ——
用设置页的「同步模型」拉到什么就以什么为准：

| 官方 id | 规格 | 说明 |
|---|---|---|
| `kimi-k2.7-code-highspeed` | 256K | K2.7 Code 高速版，官方称与普通版同模型、思考行为一致 |
| `qwen3.7-flash` | 1M / 131072 | 原生视觉语言模型，百炼推荐表新列 |
| `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite` | 8k / 4k | 混元翻译专用（无思考档位，插件刻意不写） |
| `hy-role` / `hunyuan-role-latest` | 32k / 4k | 混元角色扮演专用（同上） |
| `glm-ocr` | 单图 ≤10MB、PDF ≤50MB | 智谱轻量 OCR（无对话档位） |
| `mimo-v2.6-pro` / `mimo-v2.6-flash` / `mimo-v2.6-pro-ultraspeed` | 1M / 128K | **V2.5 的替代品**（后者 10.21 下线） |
| `grok-4.3` | — | 唯一可关闭推理的 Grok；`grok-4.5`+ 均不可关 |
| `claude-mythos-5-1` / `claude-haiku-4-5` | 1M / 128K；200K / 64K | Haiku 官方未公布档位枚举（插件不写） |

`glm-image`（图像生成）、`cogvideox-3`（视频生成）、`glm-asr-2512`（语音识别）、`glm-tts`（语音合成）、
`embedding-3`（向量）等**非对话模型**不在本插件的适用范围内：它们没有 `reasoningEffort` 与
`contextWindow` 语义，插件也不会给它们写任何字段。

### 仍未取得官方数据的厂商

**Google Gemini**：官方 SDK 已给出 `thinking_level` 四档枚举（插件据此写入），但
**上下文窗口与最大输出一个数字都没取到**（`ai.google.dev`、`cloud.google.com`、
`docs.cloud.google.com`、`generativelanguage.googleapis.com` 全部抓取失败，
`r.jina.ai` 代理亦失败）。所以插件**不给 Gemini 写规格**，只写档位。

**Meta Llama**：`llama-4-scout` / `llama-4-maverick` / `llama-3.3-70b` 均未取得官方档位数据，
插件无规则（认不出就不写）。本轮曾派查证任务但未返回结果，**未完成**。

**Mistral**：仅 `mistral-large-3` 取得 Bedrock 官方模型卡的规格（256K / 32K），
档位未提故不写；`mistral-medium-3` / `magistral-medium` 未查证。

**Cohere**：`docs.cohere.com` 的 Reasoning 与 Command A Reasoning 页面均可访问，
但**正文被导航结构占满、未取到实质档位内容**，故不收录。

**国产厂商**：百度 ERNIE（`ernie-5.0`）、字节豆包（`doubao-pro`）、阶跃 Step（`step-3`）
本轮未查证（派出的查证任务未返回结果），插件无规则。

### 覆盖度自查

改完规则表后跑 `node scripts/coverage-report.mjs`：它打印三张表的全部规则，
并用一批覆盖国内外主流厂商的代表性 id 实测判定，最后给出「认不出」的数量。
截至 2026-10-03，66 个样本中 13 个认不出（即上列未取得官方数据的厂商）。
