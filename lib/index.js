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

/** 宿主路由前缀。webServer 按最长前缀匹配，优先于 `/api` 共享通道。 */
const BASE_PATH = '/api/relay-toolkit'

/** 宿主 HTTP 路由注册表的服务名，新名在前；两个都真实存在过，先到者生效。 */
const WEB_SERVER_NAMES = ['webServer', 'httpServer']

/** 中转站 `/models` 请求超时。 */
const REQUEST_TIMEOUT_MS = 15_000

/** 请求体上限，防止意外的大 body。 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * pi-ai 允许声明的思考等级，按升级顺序。
 *
 * 取自 `@deepseek-ai/dsh-llm-pi-ai` 的 `THINKING_LEVELS`：`reasoningEfforts` 的
 * **键**必须落在这个集合内，**值**是该等级在线上报文的拼写（字符串），
 * 只有 `off` 允许为 null。写出集合外的键会被 schema 直接拒绝。
 */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * 模型家族 → 思考等级建议。
 *
 * `match` 是小写子串，最长命中优先。wire 值刻意与键同名（`low: 'low'`），
 * 因为这是 OpenAI 兼容端点的通用拼写；`off` 用 null 表示“该档不发字段”。
 *
 * 只覆盖能确认的家族：**认不出来的模型不给建议**，宁可让它在界面上显示
 * “未识别”，也不要把猜测写进配置。
 */
const FAMILIES = [
  { match: ['deepseek-v4', 'deepseek-v3.2', 'deepseek-v3.1'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { match: ['deepseek-reasoner', 'deepseek-r1'], efforts: { off: null, low: 'low', high: 'high' } },
  { match: ['deepseek'], efforts: { off: null, low: 'low', high: 'high' } },
  { match: ['gpt-5'], efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' } },
  { match: ['o1', 'o3', 'o4'], efforts: { low: 'low', medium: 'medium', high: 'high' } },
  { match: ['gpt-4'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { match: ['claude'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { match: ['gemini'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { match: ['grok'], efforts: { off: null, low: 'low', high: 'high' } },
  { match: ['kimi', 'moonshot'], efforts: { off: null, low: 'low', high: 'high' } },
  { match: ['glm', 'chatglm'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { match: ['qwen'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { match: ['mimo'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { match: ['minimax'], efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } }
]

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
  if (clean.off === undefined) clean.off = null
  return clean
}

/**
 * 一个模型 id 的思考等级建议。
 *
 * @param {unknown} id - 模型 id。
 * @returns {Record<string, string | null> | undefined} 建议映射；家族未知时为 undefined。
 */
function suggestEfforts (id) {
  if (!nonEmptyString(id)) return undefined
  const lower = id.toLowerCase()
  let best
  let bestLength = 0
  for (const family of FAMILIES) {
    for (const pattern of family.match) {
      if (lower.includes(pattern) && pattern.length > bestLength) {
        best = family
        bestLength = pattern.length
      }
    }
  }
  return best === undefined ? undefined : sanitizeEfforts(best.efforts)
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
    ?? (includeUnknown ? sanitizeEfforts(GENERIC_EFFORTS) : undefined)
  if (suggested === undefined) return undefined
  return { ...model, reasoningEfforts: suggested }
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
        return {
          id,
          declared: model.reasoningEfforts !== undefined,
          suggested: model.reasoningEfforts === undefined ? (suggestEfforts(id) ?? null) : null,
          hasContextWindow: userModel?.contextWindow !== undefined,
          hasMaxTokens: userModel?.maxTokens !== undefined
        }
      })
    }
  })

  return { routes, namespace: NS }
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

  for (const [route, profile] of Object.entries(userProviders)) {
    if (only !== undefined && route !== only) continue
    if (!isRecord(profile) || !Array.isArray(profile.models)) continue

    let discovered
    try {
      discovered = await discoverRoute(ctx, route)
    } catch (error) {
      skipped.push({ route, reason: error instanceof Error ? error.message : String(error) })
      continue
    }

    const byId = new Map()
    for (const model of discovered) {
      if (nonEmptyString(model.id)) byId.set(model.id, model)
    }

    let changed = false
    const nextModels = profile.models.map(model => {
      if (!isRecord(model) || !nonEmptyString(model.id)) return model
      const found = byId.get(model.id)
      if (found === undefined) {
        skipped.push({ route, id: model.id, reason: '发现结果里没有这个模型' })
        return model
      }
      const patch = {}
      if (model.contextWindow === undefined && positiveInteger(found.contextWindow)) {
        patch.contextWindow = found.contextWindow
      }
      if (model.maxTokens === undefined && positiveInteger(found.maxTokens)) {
        patch.maxTokens = found.maxTokens
      }
      if (Object.keys(patch).length === 0) {
        skipped.push({ route, id: model.id, reason: '发现结果没有可用的容量数值' })
        return model
      }
      changed = true
      fills.push({ route, id: model.id, ...patch })
      return { ...model, ...patch }
    })

    if (changed) patchProviders[route] = { models: nextModels }
  }

  if (Object.keys(patchProviders).length === 0) {
    return { fills, skipped, note: '没有可对齐的窗口/输出上限' }
  }

  await snap.settings.update(NS, { providers: patchProviders }, snap.descriptor?.revision)
  logLine(ctx, 'info', 'relay-toolkit: 对齐 %d 个模型的窗口与输出上限', fills.length)
  return { fills, skipped }
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

/** 路由入口：`/api/relay-toolkit/{status|sync|autofill}`。 */
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
