# 多模态（图像输入）排查与修复

- 首次排查：2026-09-11
- 复核：2026-09-16（新增可登记的图像家族；原有结论不变）
- 环境：DSH Desktop 0.1.5-rc.1，`DSH_HOME = %USERPROFILE%\.dsh`
- 一句话结论：**模型本身支持图像，是 provider 条目没有声明 `input`，DSH 就把它当纯文本路由了。**

这份记录既是排查过程，也是 `dsh-relay-toolkit` 里「补全图像声明」这个能力的依据。
插件能自动做的部分见 README；这里保留完整的判断链与官方限制。

> 下文配置示例里的 provider 名、`baseURL` 与凭据引用均已脱敏为通用占位，
> 不影响任何结论。

> **2026-09-16 复核补充**：本轮按各厂商官方文档新增了几组「官方确认能收图」的家族，
> 插件现在会给它们补 `input: [text, image]`：Kimi 的 `kimi-k2.6` / `kimi-k2.7-code*`、
> Qwen 的 `qwen3.8-max` / `qwen3.8-flash` / `qwen3.7-plus` / `qwen3.7-flash`、
> `MiniMax-M3`、`mimo-v2.5`（**不含 `mimo-v2.5-pro`**）。
> 本节排查方法（尤其是「能力由条目声明决定，不由模型名决定」）对它们同样适用 ——
> 声明只代表模型能收图，**中转站是否透传仍必须按第四节实测**。

---

## 一、现象

调用 `read_image` 读本地图片时直接报错，图片根本没送到模型：

```
Error: cannot read "...\vision-probe.png" as an image:
model "deepseek-v4.1-flash" does not declare image input;
switch to an image-capable model to read images
```

报错措辞是 **`does not declare`（未声明）**，不是「不支持」—— 这是定位问题的关键线索。
DSH 在**发请求之前**就拒了，所以这不是上游的问题。

---

## 二、根因

### 2.1 第一层：模型有能力

DeepSeek 官方 [Vision 文档](https://api-docs.deepseek.com/guides/vision/) 写明
`deepseek-flash`（即 V4.1 Flash）接受图像与文本，可用于描述图片、读截屏文字、分析图表。
旧的 `deepseek-v4-flash-vision-exp` 已退役，其请求由最新 Flash 接管。

DSH 内置的 DeepSeek 适配器条目也印证了这一点：

```yaml
- id: deepseek-flash
  name: DeepSeek-V4.1-Flash
  description: V4.1 Flash：552B MoE，原生多模态，1M 上下文，性价比最高。
  inputModalities:
    - text
    - image
  imagePixelBudget: 640000
  imageMaxBytes: 1048576
```

### 2.2 第二层：断点在 provider 条目

出问题的是默认模型走的那条第三方中转路由：

```yaml
agent-default-model:
  provider: relay              # baseURL: https://relay.example/v1
  model: deepseek-v4.1-flash
```

而 `relay` 下的这个条目**只声明了容量，没有 `input` 字段**：

```yaml
relay:
  displayName: https://relay.example/
  apiKeyEnv: RELAY_API_KEY
  api: openai-completions
  baseURL: https://relay.example/v1
  models:
    - id: deepseek-v4.1-flash
      name: deepseek-v4.1-flash
      reasoningEfforts: { 'off': null, low: low, high: high, max: max }
      contextWindow: 1000000
      maxTokens: 372000
      # ← 这里缺 input 声明
```

**DSH 对未声明 `input` 的模型一律按纯文本路由。**

### 2.3 第三层：反证

同一个 `deepseek-v4.1-flash`，在另一个 provider 下**已经**声明了图像：

```yaml
- id: deepseek-v4.1-flash
  name: deepseek-v4.1-flash
  input:
    - text
    - image
```

同一模型、同一份 DSH，只是条目写法不同，能力就不同 ——
**决定权在条目声明，不在模型名。**

### 2.4 代码层面的确认（本机 DSH 0.1.5-rc.1）

拆开 `@deepseek-ai/dsh-llm-pi-ai` 核对过，链路完全对得上：

| 事实 | 出处 |
|---|---|
| 条目没声明就退回路由默认值：`input: declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput]` | `dsh-llm-pi-ai` 解析模型条目处 |
| **默认值是 `["text"]`**：`const DEFAULT_INPUT = ["text"]` | 同上 |
| 合法模态只有两个：`MODALITIES = ['text', 'image']` | 同上 |
| `input: []` 与不写等价 —— `declaredInput()` 把空数组也当作「没表态」 | 同上 |
| 拒绝发生在**工具层**（`dsh-tool-fs`），不是模型层：`if (active.inputModalities === undefined \|\| !active.inputModalities.includes("image")) throw ...` | `dsh-tool-fs` |
| `discoverModels()` 只返回 `{ id, name, contextWindow, maxTokens }`，**不含模态** | `dsh-llm-pi-ai` |

最后一条很关键：**模态信息没法从 DSH 的模型发现里"对齐"**，所以插件只能靠内置的
官方能力表来建议，认不出就不写。

---

## 三、解决办法

### 手工

给该条目补三行：

```yaml
        - id: deepseek-v4.1-flash
          name: deepseek-v4.1-flash
          reasoningEfforts:
            'off': null
            low: low
            high: high
            max: max
          contextWindow: 1000000
          maxTokens: 372000
          input:            # ← 新增
            - text          # ← 新增
            - image         # ← 新增
```

**无需重启**：`dsh-settings-file` 是热重载的，官方描述为「用户可以直接编辑文档——
变更实时生效」。

### 用插件

`dsh-relay-toolkit` 把这件事做成了设置页上的一个按钮：

- 卡片标出「官方确认支持图像、但未声明 input：<模型 id…>」，配一个
  **补全图像声明（N）** 按钮，写入 `input: [text, image]`；
- 设置页顶部**单独告警当前默认模型**（顺着 `agent-default-model` 找到它在哪条路由上）——
  这一条正是实际踩坑的位置。

它**不参与自动补全**，必须由你点：声明图像能力只代表模型本身能收图，
中转站是否真的向上游透传要实测。已经声明过 `input` 的条目（哪怕只写了 `text`）
一律不动。

---

## 四、验证

生成一张已知构图的探针图（红圆 + 蓝矩形 + 黑字 `DSH 42`），用 `read_image` 读取，
识别结果与生成时完全一致，**确认链路打通**。

同时确认了 **该中转站确实向上游透传图像**，没有偷偷降级成纯文本 ——
这是实测结论，不是推断。

---

## 五、可复用的排查清单

以后遇到「模型明明支持却读不了图」，按此顺序查：

1. **看报错措辞**：`does not declare image input` = 声明缺失，不是能力缺失。
2. **查当前默认模型的 provider 条目**：`agent-default-model` 指向哪个 provider，
   该 provider 的 `models` 里对应条目有没有 `input: [text, image]`。
3. **补声明**，保存即可，热生效。
4. **实测**：发一张图或生成探针图验证。
5. **若补了声明仍失败** → 说明该中转站不透传图像，此时换官方直连
   `llm-deepseek/deepseek-flash`（与官方文档完全对齐，最可靠）。

### 三条经验

- **能力由 provider 条目的 `input` 字段决定，不由模型名决定。**
  同一个模型 id 在不同 provider 下可以有完全不同的能力。
- **`inputModalities` 与 `input` 是两套写法**：DSH 内置适配器（`llm-deepseek`）用
  `inputModalities`，pi-ai 风格的第三方 provider 用 `input`。改配置时不要写错 ——
  写错的表现是"改了没反应"。
- **中转站的透传能力必须实测**，不能靠猜 —— 这次实测证明该中转站是透传的。

---

## 附：官方图像输入限制

| 项目 | 限制 |
| --- | --- |
| 支持格式 | JPEG、PNG、GIF、WebP（按文件内容探测，不看扩展名与 MIME） |
| 单图大小（base64 / 外链） | 32 MiB |
| 单图大小（Files API `file_id`） | 64 MiB |
| 请求体大小 | 48 MiB |
| 单请求最大图片数 | 600 张 |
| 单边最大像素 | 8192 px（单请求 ≥15 张图时降为 4096 px） |
| 每张图 token 上限 | 1024（自动缩放到约 1300×1300 等效像素） |
| 外链长度上限 | 8192 字符 |
| 位置限制 | **图像只能放在 `user` 消息**，放 `system` / `assistant` 会返回 400 |

`detail` 字段可选：`low`（降到 512×512，更快更省）、`high` / `original`（保留原图）、
`auto`（当前等同 `original`）。
