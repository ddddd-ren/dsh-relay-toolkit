/**
 * dsh-relay-toolkit 宿主半侧的行为测试。
 *
 * 不碰真实 DSH：mock 一个 cordis 上下文（settings / credentials / webServer）、
 * mock 中转站的 fetch，然后直接调用插件注册出来的路由处理器。
 *
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, name, inject, noEffortReason, suggestEfforts, visionSupport as visionSupportOf } from '../lib/index.js'

const NS = 'llm-pi-ai'
const BASE_PATH = '/api/relay-toolkit'

/** 造一个用户层/解析层配置都一致的场景。 */
function makeState ({ userProviders, resolvedProviders, defaultModel }) {
  return {
    revision: 7,
    user: { providers: userProviders },
    resolved: { providers: resolvedProviders ?? userProviders },
    defaultModel,
    updates: []
  }
}

/** mock 一个足以驱动插件的宿主上下文，并返回它捕获到的信息。 */
function makeHost (state, options = {}) {
  const registered = []
  const logs = []
  const webServer = {
    register (route) {
      registered.push(route)
      return () => {}
    }
  }
  const settings = {
    get: ns => {
      if (ns === NS) return state.resolved
      if (ns === 'agent-default-model') return state.defaultModel
      return undefined
    },
    describe: () => [{ ns: NS, user: state.user, revision: state.revision }],
    update: async (ns, patch, revision) => {
      state.updates.push({ ns, patch, revision })
      // 模拟真实 settings：写入后 revision 前进，用户层被合并。
      state.revision += 1
      for (const [route, profile] of Object.entries(patch.providers ?? {})) {
        state.user.providers[route] = { ...state.user.providers[route], ...profile }
        state.resolved.providers[route] = { ...state.resolved.providers[route], ...profile }
      }
    }
  }
  const credentials = {
    resolve: async ref => (ref === 'GM_API_KEY' ? { value: 'sk-test' } : undefined)
  }

  const ctx = {
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args])
    },
    get: serviceName => {
      if (serviceName === 'logger') return ctx.logger
      if (serviceName === 'settings') return settings
      if (serviceName === 'credentials') return credentials
      if (serviceName === 'llm') return options.llm
      if (serviceName === (options.serveVia ?? 'webServer')) return webServer
      return undefined
    },
    inject: (deps, callback) => {
      const scoped = {
        get: ctx.get,
        effect: fn => { fn() },
        logger: ctx.logger
      }
      for (const dep of deps) {
        const service = ctx.get(dep)
        if (service !== undefined) scoped[dep] = service
      }
      callback(scoped)
    }
  }

  return { ctx, registered, logs, settings, credentials, webServer }
}

/** 造一个 node:http 风格的请求替身。 */
function makeRequest ({ method = 'GET', endpoint = '', body, remoteAddress = '127.0.0.1' }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url: BASE_PATH + endpoint,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator] () {
      for (const chunk of chunks) yield chunk
    }
  }
}

/** 造一个 node:http 风格的响应替身，并给出解析后的 JSON。 */
function makeResponse () {
  const res = {
    statusCode: 0,
    headers: undefined,
    body: '',
    writeHead (code, headers) {
      res.statusCode = code
      res.headers = headers
    },
    end (body) {
      res.body = body
    }
  }
  return res
}

/** 调一次路由，返回 { status, payload }。 */
async function callRoute (host, requestOptions) {
  const route = host.registered[0]
  assert.equal(route.path, BASE_PATH, '应注册在 /api/relay-toolkit 前缀上')
  assert.equal(route.kind, 'prefix')
  const res = makeResponse()
  await route.handler(makeRequest(requestOptions), res)
  return { status: res.statusCode, payload: JSON.parse(res.body) }
}

/** 用假的 /models 响应接管全局 fetch。 */
function stubFetch (t, handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  t.after(() => { globalThis.fetch = original })
}

const SAMPLE_USER = {
  gm: {
    api: 'openai-completions',
    baseURL: 'https://relay.example/v1',
    apiKeyEnv: 'GM_API_KEY',
    models: [
      { id: 'glm-5.1', name: 'glm-5.1', reasoningEfforts: { off: null, low: 'low', high: 'high' } },
      { id: 'glm-5.2', name: 'glm-5.2' },
      { id: 'totally-unknown-model', name: 'totally-unknown-model' }
    ]
  }
}

test('插件导出形态符合 cordis 契约', () => {
  assert.equal(name, 'dsh-relay-toolkit')
  assert.deepEqual(inject, [], '模块级不声明依赖，缺 web 服务的组合也应能加载')
  assert.equal(typeof apply, 'function')
})

test('apply 在 webServer 上挂载前缀路由，且双服务名只挂一次', () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)
  assert.equal(host.registered.length, 1)
  assert.equal(host.registered[0].path, BASE_PATH)
})

test('status 报告可写性、已声明与建议补全的数量', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  const { status, payload } = await callRoute(host, { endpoint: '/status' })
  assert.equal(status, 200)
  assert.equal(payload.ok, true)

  const route = payload.value.routes.find(item => item.route === 'gm')
  assert.equal(route.writable, true)
  assert.equal(route.modelCount, 3)

  const declared = route.models.find(model => model.id === 'glm-5.1')
  assert.equal(declared.declared, true)
  assert.equal(declared.suggested, null, '已有声明的模型不给建议')

  const fillable = route.models.find(model => model.id === 'glm-5.2')
  assert.equal(fillable.declared, false)
  assert.deepEqual(
    fillable.suggested,
    { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    'GLM-5.2 官方档位最全'
  )

  const unknown = route.models.find(model => model.id === 'totally-unknown-model')
  assert.equal(unknown.suggested, null, '认不出的家族不给建议')
})

test('autofill 只补缺失项，保留已有声明原样，并带 revision 写入', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/autofill', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value.fills, [{ route: 'gm', id: 'glm-5.2', unknown: false }])
  assert.deepEqual(payload.value.skipped, [{ route: 'gm', id: 'totally-unknown-model' }])

  assert.equal(state.updates.length, 1)
  const update = state.updates[0]
  assert.equal(update.ns, NS)
  assert.equal(update.revision, 7, '写入必须带上读取时的 revision')

  const models = update.patch.providers.gm.models
  assert.equal(models.length, 3, '不得增删模型条目')
  assert.deepEqual(
    models.find(model => model.id === 'glm-5.1').reasoningEfforts,
    { off: null, low: 'low', high: 'high' },
    '已有声明必须原样保留'
  )
  assert.deepEqual(
    models.find(model => model.id === 'glm-5.2').reasoningEfforts,
    { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    'GLM-5.2 按官方档位集合补全'
  )
  assert.equal(
    models.find(model => model.id === 'totally-unknown-model').reasoningEfforts,
    undefined,
    '未知家族不得写入'
  )
})

test('autofill 对未在用户层定义的路由不做任何写入', async () => {
  const state = makeState({
    userProviders: {},
    resolvedProviders: { base: { api: 'openai-completions', baseURL: 'https://base.example/v1', models: [{ id: 'glm-5.2' }] } }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/autofill', body: {} })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value.fills, [])
  assert.equal(state.updates.length, 0, '底座层声明的路由不得被写回固化')
})

test('status 对含底座层模型的路由给出不可写原因', async () => {
  const state = makeState({
    userProviders: { gm: { api: 'openai-completions', baseURL: 'https://relay.example/v1', models: [{ id: 'glm-5.2' }] } },
    resolvedProviders: {
      gm: { api: 'openai-completions', baseURL: 'https://relay.example/v1', models: [{ id: 'glm-5.2' }, { id: 'from-base' }] }
    }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { endpoint: '/status' })
  const route = payload.value.routes.find(item => item.route === 'gm')
  assert.equal(route.writable, false)
  assert.match(route.blockedReason, /底座层/)
})

test('sync 只追加缺失模型，并为新模型带上可确认的思考等级', async t => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  let requested = null
  stubFetch(t, async (url, init) => {
    requested = { url, init }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'glm-5.1' },
          { id: 'glm-5.2' },
          { id: 'totally-unknown-model' },
          { id: 'glm-5.3' },
          { id: 'kimi-k2.7-code' }
        ]
      })
    }
  })

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/sync', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value.added, ['glm-5.3', 'kimi-k2.7-code'])
  assert.equal(payload.value.total, 5)

  assert.equal(requested.url, 'https://relay.example/v1/models')
  assert.equal(requested.init.headers.authorization, 'Bearer sk-test', '按该路由自己的凭据引用取 Key')

  const models = state.updates[0].patch.providers.gm.models
  assert.equal(models.length, 5)
  assert.deepEqual(
    models[3].reasoningEfforts,
    { low: 'low', high: 'high', max: 'max' },
    'GLM-5.3 强制思考，官方只有三档'
  )
  assert.equal(
    models[4].reasoningEfforts,
    undefined,
    'Kimi K2.7-code 官方不支持 reasoning_effort，不得写入档位'
  )
  assert.equal(models[3].name, 'glm-5.3', '新模型补上 name')
})

test('sync 在中转站报错时给出可读原因，且不写入', async t => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  stubFetch(t, async () => ({ ok: false, status: 401, json: async () => ({}) }))

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/sync', body: { route: 'gm' } })
  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /401/)
  assert.match(payload.error.message, /API Key/)
  assert.equal(state.updates.length, 0)
})

test('sync 拒绝写入未在用户层定义的路由', async t => {
  const state = makeState({ userProviders: {} })
  const host = makeHost(state)
  apply(host.ctx)
  stubFetch(t, async () => { throw new Error('不该发出请求') })

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/sync', body: { route: 'ghost' } })
  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /用户配置层/)
})

test('非本机请求被拒绝', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  const { status, payload } = await callRoute(host, { endpoint: '/status', remoteAddress: '192.168.1.20' })
  assert.equal(status, 403)
  assert.equal(payload.ok, false)
})

test('未知端点返回 404 而不是抛错', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  const { status, payload } = await callRoute(host, { endpoint: '/nope' })
  assert.equal(status, 404)
  assert.equal(payload.ok, false)
})

test('没有 web 服务时仍然能加载，不抛错', () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state, { serveVia: 'nothing' })
  assert.doesNotThrow(() => apply(host.ctx))
  assert.equal(host.registered.length, 0)
  assert.ok(host.logs.some(entry => entry[0] === 'info'), '应留下等待 web 服务的日志')
})

test('autofill 只在 includeUnknown 下才对认不出家族的模型写通用模板', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, {
    method: 'POST',
    endpoint: '/autofill',
    body: { route: 'gm', includeUnknown: true }
  })
  assert.equal(payload.ok, true)

  const fills = payload.value.fills
  assert.deepEqual(fills.map(item => item.id).sort(), ['glm-5.2', 'totally-unknown-model'])
  assert.equal(fills.find(item => item.id === 'glm-5.2').unknown, false)
  assert.equal(fills.find(item => item.id === 'totally-unknown-model').unknown, true,
    '通用模板补的模型要打标记，界面据此说明')
  assert.deepEqual(payload.value.skipped, [], '通用模板模式下不再有跳过的模型')

  const models = state.updates[0].patch.providers.gm.models
  assert.deepEqual(
    models.find(model => model.id === 'totally-unknown-model').reasoningEfforts,
    { off: null, low: 'low', medium: 'medium', high: 'high' },
    '未识别家族写上通用模板'
  )
  assert.deepEqual(
    models.find(model => model.id === 'glm-5.1').reasoningEfforts,
    { off: null, low: 'low', high: 'high' },
    '已有声明依旧原样保留'
  )
})

test('align 用 DSH 的模型发现补上未声明的窗口与输出上限', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const calls = []
  const llm = {
    discoverModels: async (ns, request) => {
      calls.push({ ns, provider: request.provider })
      return [
        { id: 'glm-5.1', name: 'glm-5.1', contextWindow: 200000, maxTokens: 128000 },
        { id: 'glm-5.2', name: 'glm-5.2', contextWindow: 200000, maxTokens: 128000 },
        { id: 'totally-unknown-model', name: 'totally-unknown-model' }
      ]
    }
  }
  const host = makeHost(state, { llm })
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/align', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  assert.deepEqual(calls, [{ ns: 'llm-pi-ai', provider: 'gm' }], '每条路由只做一次发现')

  assert.deepEqual(payload.value.fills.map(item => item.id), ['glm-5.1', 'glm-5.2'])
  assert.ok(payload.value.skipped.some(item => item.id === 'totally-unknown-model'),
    '发现结果没给出容量数值的模型要跳过并说明')

  const models = state.updates[0].patch.providers.gm.models
  const aligned = models.find(model => model.id === 'glm-5.1')
  assert.equal(aligned.contextWindow, 200000)
  assert.equal(aligned.maxTokens, 128000)
  assert.deepEqual(aligned.reasoningEfforts, { off: null, low: 'low', high: 'high' },
    '对齐容量不得动已有的思考等级声明')
  assert.equal(state.updates[0].revision, 7, '写入要带上读取时的 revision')
})

test('align 不覆盖用户已经填好的窗口与输出数值', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [{ id: 'glm-5.1', name: 'glm-5.1', contextWindow: 128000, maxTokens: 8192 }]
      }
    }
  })
  const llm = { discoverModels: async () => [{ id: 'glm-5.1', contextWindow: 200000, maxTokens: 128000 }] }
  const host = makeHost(state, { llm })
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/align', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value.fills, [], '两个字段都已声明，没有可补的')
  assert.equal(state.updates.length, 0, '不得写回')
})

test('align 在发现失败时用内置规格表兜底，并把失败原因带回', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const llm = { discoverModels: async () => { throw new Error('上游不可达') } }
  const host = makeHost(state, { llm })
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/align', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value.discoveryErrors, [{ route: 'gm', reason: '上游不可达' }])

  const fills = payload.value.fills
  assert.deepEqual(fills.map(item => item.id), ['glm-5.1', 'glm-5.2'], '内置规格表补上了官方值')
  assert.ok(fills.every(item => item.source === 'spec'))
  assert.equal(fills[0].contextWindow, 200000, 'glm-5.1 官方 200K')
  assert.equal(fills[1].contextWindow, 1000000, 'glm-5.2 官方 1M')
  assert.equal(fills[1].maxTokens, 128000)
  assert.ok(payload.value.skipped.some(item => /规格表也认不出/.test(item.reason ?? '')))
})

test('align 在宿主没有 llm 服务时同样走内置规格表', async () => {
  const state = makeState({ userProviders: structuredClone(SAMPLE_USER) })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/align', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  assert.ok(payload.value.discoveryErrors.some(item => /discoverModels/.test(item.reason ?? '')))
  assert.ok(payload.value.fills.length > 0, '规格表仍能补上数值')
  assert.ok(payload.value.fills.every(item => item.source === 'spec'))
})

test('align 优先用发现结果，规格表只补它没给的项', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [{ id: 'glm-5.2', name: 'glm-5.2' }]
      }
    }
  })
  // 上游只给了 contextWindow（且与官方规格表不同），没给 maxTokens
  const llm = { discoverModels: async () => [{ id: 'glm-5.2', contextWindow: 524288 }] }
  const host = makeHost(state, { llm })
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/align', body: { route: 'gm' } })
  const fill = payload.value.fills[0]
  assert.equal(fill.contextWindow, 524288, '窗口以上游发现为准，不被规格表覆盖')
  assert.equal(fill.maxTokens, 128000, '输出上限上游没给，用规格表补')
  assert.equal(fill.source, 'spec', '只要有一项来自规格表就标注来源')
  assert.equal(fill.specSource, '智谱官方文档')
})

test('短别名 k3 归一化成 kimi-k3，档位与容量都按官方 id 取', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [{ id: 'k3', name: 'k3' }]
      }
    }
  })
  const llm = { discoverModels: async () => [] }
  const host = makeHost(state, { llm })
  apply(host.ctx)

  const status = await callRoute(host, { endpoint: '/status' })
  const route = status.payload.value.routes.find(item => item.route === 'gm')
  assert.deepEqual(
    route.models.find(item => item.id === 'k3').suggested,
    { low: 'low', high: 'high', max: 'max' },
    'k3 = kimi-k3：强制思考，只有三档、无 off'
  )

  const align = await callRoute(host, { method: 'POST', endpoint: '/align', body: { route: 'gm' } })
  const fill = align.payload.value.fills.find(item => item.id === 'k3')
  assert.equal(fill.contextWindow, 1000000, '容量也按 kimi-k3 的官方规格')
  assert.equal(fill.maxTokens, 1048576)
})

test('status 把「官方不支持档位」和「认不出家族」分开报', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [
          { id: 'glm-5.1', name: 'glm-5.1' },
          { id: 'totally-unknown-model', name: 'totally-unknown-model' }
        ]
      }
    }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { endpoint: '/status' })
  const route = payload.value.routes.find(item => item.route === 'gm')

  const unsupported = route.models.find(model => model.id === 'glm-5.1')
  assert.equal(unsupported.suggested, null, '官方不支持档位的模型不给建议')
  assert.match(unsupported.unsupported ?? '', /不支持/, '要说明是官方不支持，而不是认不出')

  const unknown = route.models.find(model => model.id === 'totally-unknown-model')
  assert.equal(unknown.suggested, null)
  assert.equal(unknown.unsupported, null, '真正认不出的模型不该被说成官方不支持')
})

test('通用模板也不会写进官方不支持档位的模型', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [
          { id: 'glm-5.1', name: 'glm-5.1' },
          { id: 'kimi-k2.7-code', name: 'kimi-k2.7-code' },
          { id: 'totally-unknown-model', name: 'totally-unknown-model' }
        ]
      }
    }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, {
    method: 'POST',
    endpoint: '/autofill',
    body: { route: 'gm', includeUnknown: true }
  })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value.fills.map(item => item.id), ['totally-unknown-model'],
    '只有真正认不出家族的模型才用通用模板')

  const models = state.updates[0].patch.providers.gm.models
  assert.equal(models.find(model => model.id === 'glm-5.1').reasoningEfforts, undefined,
    '官方不支持档位的模型不得被写入')
  assert.equal(models.find(model => model.id === 'kimi-k2.7-code').reasoningEfforts, undefined,
    '同上：Kimi K2.7-code 只有 thinking 开关')
  assert.deepEqual(
    models.find(model => model.id === 'totally-unknown-model').reasoningEfforts,
    { off: null, low: 'low', medium: 'medium', high: 'high' },
    '认不出家族的才写通用模板'
  )
})

test('status 报告输入模态声明与官方图像能力', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [
          { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' },
          { id: 'glm-5.2', name: 'glm-5.2', input: ['text'] },
          { id: 'totally-unknown-model', name: 'totally-unknown-model' }
        ]
      }
    }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { endpoint: '/status' })
  const route = payload.value.routes.find(item => item.route === 'gm')

  const vision = route.models.find(item => item.id === 'deepseek-v4.1-flash')
  assert.equal(vision.inputDeclared, false, '没写 input 就是未声明')
  assert.match(vision.vision ?? '', /Vision/, '官方确认支持图像的给出建议来源')

  const declared = route.models.find(item => item.id === 'glm-5.2')
  assert.equal(declared.inputDeclared, true, '只声明 text 也算已声明')
  assert.equal(declared.declaresImage, false, '只声明 text 不等于能收图')

  const unknown = route.models.find(item => item.id === 'totally-unknown-model')
  assert.equal(unknown.vision, null, '认不出官方能力的模型不给建议')
})

test('modalities 只给官方确认且未声明的模型补 input', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [
          { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' },
          { id: 'glm-5.2', name: 'glm-5.2', input: ['text'] },
          { id: 'totally-unknown-model', name: 'totally-unknown-model' }
        ]
      }
    }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/modalities', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.value.fills.map(item => item.id), ['deepseek-v4.1-flash'])
  assert.deepEqual(payload.value.fills[0].input, ['text', 'image'])
  assert.match(payload.value.fills[0].source, /Vision/)

  assert.equal(state.updates.length, 1)
  const models = state.updates[0].patch.providers.gm.models
  assert.deepEqual(models.find(model => model.id === 'deepseek-v4.1-flash').input, ['text', 'image'])
  assert.deepEqual(models.find(model => model.id === 'glm-5.2').input, ['text'],
    '已声明的 input 绝不被改写')
  assert.equal(models.find(model => model.id === 'totally-unknown-model').input, undefined,
    '认不出官方能力的模型不得写入')
  assert.equal(state.updates[0].revision, 7, '写入必须带上读取时的 revision')
})

test('status 诊断默认模型缺图像声明', async () => {
  const state = makeState({
    userProviders: {
      relay: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [{ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' }]
      }
    },
    defaultModel: { provider: 'relay', model: 'deepseek-v4.1-flash' }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { endpoint: '/status' })
  const info = payload.value.defaultModel
  assert.equal(info.provider, 'relay')
  assert.equal(info.model, 'deepseek-v4.1-flash')
  assert.equal(info.resolved, true)
  assert.equal(info.declaresImage, false, '没声明 input，工具层就读不到图像能力')
  assert.equal(info.inUserLayer, true, '在用户层，插件可以替它补')
  assert.equal(info.visionCapable, true, '官方确认它支持图像')
})

test('默认模型已声明图像时诊断不再报缺口', async () => {
  const state = makeState({
    userProviders: {
      relay: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [{ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', input: ['text', 'image'] }]
      }
    },
    defaultModel: { provider: 'relay', model: 'deepseek-v4.1-flash' }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { endpoint: '/status' })
  assert.equal(payload.value.defaultModel.declaresImage, true)
})

test('noEffortReason 与 suggestEfforts 严格互斥', () => {
  // 官方明确不支持档位的家族 → 给出原因，scripts/fix-efforts.mjs 据此删除声明。
  assert.match(noEffortReason('glm-5.1') ?? '', /不支持/)
  assert.match(noEffortReason('kimi-k2.7-code') ?? '', /不支持/)
  assert.match(noEffortReason('MiniMax-M3') ?? '', /档位/)
  assert.match(noEffortReason('qwen3.7-max') ?? '', /未公布/)
  assert.match(noEffortReason('hy4-preview') ?? '', /未公布/)

  // 真正认不出家族的 → 两边都没有答案；脚本据此「原样不动」，不替用户做决定。
  assert.equal(noEffortReason('totally-unknown-model'), undefined)
  assert.equal(suggestEfforts('totally-unknown-model'), undefined)

  // 互斥：能给官方档位建议的模型，绝不能同时被判成「不支持档位」。
  // 这是子串匹配的坑 —— 表里的 `glm-5` 会命中 glm-5.2 / glm-5.3，而它们都有官方档位。
  for (const id of ['glm-5.2', 'glm-5.3', 'kimi-k3', 'deepseek-v4.1-flash', 'hy3']) {
    assert.notEqual(suggestEfforts(id), undefined, id + ' 应该有官方档位')
    assert.equal(noEffortReason(id), undefined, id + ' 不该被判成不支持档位')
  }
})

test('Kimi 新模型：kimi-for-coding 有档位，而 highspeed 版本不被它盖住', () => {
  const threeTiers = { low: 'low', high: 'high', max: 'max' }

  // K2.8 Preview 的官方 Model ID 是 `kimi-for-coding`（不是 kimi-k2.8）。
  assert.deepEqual(suggestEfforts('kimi-for-coding'), threeTiers)
  // K3 的 256K 版本走独立 id，档位相同。
  assert.deepEqual(suggestEfforts('k3-256k'), threeTiers)
  // Kimi Code 用 `k3`，API 开放平台用 `kimi-k3`，同一个模型。
  assert.deepEqual(suggestEfforts('k3'), suggestEfforts('kimi-k3'))

  // 子串冲突回归：`kimi-for-coding` 是 `kimi-for-coding-highspeed` 的前缀，但高速版
  // 只有 Thinking 开关、没有档位。两张表合并 + 最长命中优先后，必须不被盖住。
  assert.equal(suggestEfforts('kimi-for-coding-highspeed'), undefined,
    '高速版不该被 kimi-for-coding 的档位盖住')
  assert.match(noEffortReason('kimi-for-coding-highspeed') ?? '', /Thinking/)
})

test('新登记的「认得出但官方不给档位」家族，不被当成未识别', () => {
  // Kimi K2.7 Code 高速版与普通版是同一个模型、思考行为一致，都只有 thinking 开关。
  // 这两条也是子串对：高速版更长，靠最长命中选中同一条规则。
  // 专用模型（Hy-MT2 翻译、Hy-Role 角色扮演、GLM-OCR）同理。
  for (const id of [
    'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6',
    'hy-mt2-pro', 'hy-mt2-plus', 'hy-mt2-lite',
    'hy-role', 'hunyuan-role-latest', 'glm-ocr'
  ]) {
    assert.equal(suggestEfforts(id), undefined, id + ' 官方不支持 reasoning_effort')
    assert.notEqual(noEffortReason(id), undefined,
      id + ' 必须能被认出来 —— 否则界面会把它归进「家族认不出来」再补上无效档位')
  }
})

test('新登记的官方规格：用 align 端点按内置规格表核对', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [
          { id: 'qwen3.7-flash', name: 'qwen3.7-flash' },
          { id: 'hy-mt2-pro', name: 'hy-mt2-pro' },
          { id: 'hy-role', name: 'hy-role' }
        ]
      }
    }
  })
  // 发现结果为空 → 只能走内置规格表，正好验证表里的新数值。
  const llm = { discoverModels: async () => [] }
  const host = makeHost(state, { llm })
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/align', body: { route: 'gm' } })
  const byId = new Map(payload.value.fills.map(item => [item.id, item]))
  assert.ok(payload.value.fills.every(item => item.source === 'spec'), '本轮全部来自规格表')

  assert.equal(byId.get('qwen3.7-flash').contextWindow, 1000000, '百炼官方 1M')
  assert.equal(byId.get('qwen3.7-flash').maxTokens, 131072)
  assert.equal(byId.get('hy-mt2-pro').contextWindow, 8000, 'TokenHub 官方 8k')
  assert.equal(byId.get('hy-mt2-pro').maxTokens, 4000)
  assert.equal(byId.get('hy-role').contextWindow, 32000, 'TokenHub 官方 32k')
  assert.equal(byId.get('hy-role').maxTokens, 4000)
})

test('新登记的支持图像家族，以及 mimo-v2.5 前缀的 except 排除', async () => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        models: [
          { id: 'kimi-k2.6', name: 'kimi-k2.6' },
          { id: 'qwen3.8-max', name: 'qwen3.8-max' },
          { id: 'MiniMax-M3', name: 'MiniMax-M3' },
          { id: 'mimo-v2.5', name: 'mimo-v2.5' },
          { id: 'mimo-v2.5-pro', name: 'mimo-v2.5-pro' }
        ]
      }
    }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/modalities', body: { route: 'gm' } })
  assert.deepEqual(
    payload.value.fills.map(item => item.id).sort(),
    ['MiniMax-M3', 'kimi-k2.6', 'mimo-v2.5', 'qwen3.8-max'],
    '官方确认能收图的才补，且都未声明 input'
  )

  // 前缀陷阱：mimo-v2.5 官方列了「全模态理解」，而同前缀的其它型号都没有该能力 ——
  // `-pro` 只列文本生成，`-asr` / `-tts` 是语音。它们的最长命中全都是 `mimo-v2.5`，
  // 单靠最长命中分不开，只能靠 except 逐个排除。这条正是回归防线。
  assert.ok(payload.value.skipped.some(item => item.id === 'mimo-v2.5-pro'),
    'mimo-v2.5-pro 不得因共享前缀被补上图像声明')
  assert.equal(visionSupportOf('mimo-v2.5-asr'), undefined,
    'mimo-v2.5-asr 是语音识别模型，不得被补上图像声明')
  assert.equal(visionSupportOf('mimo-v2.5-tts'), undefined,
    'mimo-v2.5-tts 是语音合成模型，不得被补上图像声明')
  assert.notEqual(visionSupportOf('mimo-v2.5'), undefined, '只有裸的 mimo-v2.5 支持全模态理解')
})

/** 造一个探测用的路由，模型列表可指定。 */
function probeState (ids) {
  return makeState({
    userProviders: {
      gm: {
        api: 'openai-completions',
        baseURL: 'https://relay.example/v1',
        apiKeyEnv: 'GM_API_KEY',
        models: ids.map(id => ({ id, name: id }))
      }
    }
  })
}

/** 一个成功的 Chat Completions 响应。 */
function chatOk (content) {
  return {
    ok: true,
    status: 200,
    async text () {
      return JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 }
      })
    }
  }
}

test('probe 发一句 hi 判定模型可用，并带上耗时与回复', async t => {
  const state = probeState(['glm-5.2'])
  const seen = []
  stubFetch(t, async (url, init) => {
    seen.push({ url, init })
    return chatOk('你好！')
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  assert.equal(payload.ok, true)
  const value = payload.value
  assert.equal(value.okCount, 1)
  assert.equal(value.failedCount, 0)
  assert.equal(value.prompt, 'hi', '探测输入就是 hi')
  assert.equal(value.results[0].id, 'glm-5.2')
  assert.equal(value.results[0].ok, true)
  assert.equal(value.results[0].reply, '你好！')
  assert.equal(value.results[0].usage.outputTokens, 2)
  assert.ok(Number.isInteger(value.results[0].ms))

  // 报文本身也要对：端点、鉴权头、以及**压到最小的 max_tokens**。
  assert.equal(seen[0].url, 'https://relay.example/v1/chat/completions')
  assert.equal(seen[0].init.method, 'POST')
  assert.equal(seen[0].init.headers.authorization, 'Bearer sk-test', '用该路由自己的凭据')
  const sent = JSON.parse(seen[0].init.body)
  assert.equal(sent.model, 'glm-5.2')
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'hi' }])
  assert.equal(sent.max_tokens, 32, 'max_tokens 必须压到最小，探测成本可忽略')

  // 探测是**只读**的：一个字段都不许写。
  assert.equal(state.updates.length, 0, '探测绝不写配置')
})

test('probe 把上游错误翻译成可指导下一步的原因', async t => {
  const state = probeState(['a', 'b', 'c', 'd'])
  stubFetch(t, async (url, init) => {
    const model = JSON.parse(init.body).model
    if (model === 'a') return { ok: false, status: 401, async text () { return '{"error":{"message":"invalid key"}}' } }
    if (model === 'b') return { ok: false, status: 404, async text () { return '{"error":{"message":"model not found"}}' } }
    if (model === 'c') return { ok: false, status: 429, async text () { return 'rate limited' } }
    return chatOk('ok')
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  const byId = new Map(payload.value.results.map(item => [item.id, item]))
  assert.equal(payload.value.okCount, 1)
  assert.equal(payload.value.failedCount, 3)

  assert.match(byId.get('a').reason, /密钥无效/, '401 指向密钥问题')
  assert.match(byId.get('a').reason, /invalid key/, '要把上游自己给的原因带出来')
  assert.match(byId.get('b').reason, /没有这个模型/)
  assert.match(byId.get('c').reason, /限流/)
  assert.equal(byId.get('d').ok, true)
})

test('probe 遇到 403 时以上游原因为准，不武断说成密钥问题', async t => {
  // 实测踩到的坑：中转站对「余额不足」也回 403。若照状态码猜成「密钥无效」，
  // 用户会去改密钥，而真正该做的是充值 —— 所以上游的 message 必须排在前面。
  const state = probeState(['paid-model'])
  stubFetch(t, async () => ({
    ok: false,
    status: 403,
    async text () { return '{"error":{"message":"Insufficient account balance"}}' }
  }))
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  const reason = payload.value.results[0].reason
  assert.match(reason, /Insufficient account balance/, '上游原因必须出现')
  assert.ok(reason.indexOf('Insufficient account balance') < reason.indexOf('403'),
    '上游原因要排在状态码解释之前，避免误导')
  assert.match(reason, /余额不足/, '403 的解释要提到余额这种可能')
})

test('probe 抓得住「HTTP 200 但 body 里是错误」的假成功', async t => {
  const state = probeState(['ghost-model'])
  stubFetch(t, async () => ({
    ok: true,
    status: 200,
    async text () {
      // 中转站常见的伪装：状态码 200，错误塞在 body 里。
      return JSON.stringify({ error: { message: 'upstream channel offline', type: 'upstream_error' } })
    }
  }))
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  assert.equal(payload.value.okCount, 0, '200 不等于成功')
  assert.match(payload.value.results[0].reason, /upstream channel offline/)
})

test('probe 对「调用通了但没内容」与网络失败分别给出可读原因', async t => {
  const state = probeState(['empty', 'netfail'])
  stubFetch(t, async (url, init) => {
    const model = JSON.parse(init.body).model
    if (model === 'empty') {
      return { ok: true, status: 200, async text () { return JSON.stringify({ choices: [{ message: { content: '' } }] }) } }
    }
    throw new Error('ECONNREFUSED')
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  const byId = new Map(payload.value.results.map(item => [item.id, item]))
  assert.equal(byId.get('empty').ok, false)
  assert.match(byId.get('empty').reason, /没有任何文本内容/)
  assert.equal(byId.get('netfail').ok, false)
  assert.match(byId.get('netfail').reason, /请求发不出去/)
})

test('probe 认得强制思考模型只回 reasoning_content 的情况', async t => {
  const state = probeState(['glm-5.3'])
  stubFetch(t, async () => ({
    ok: true,
    status: 200,
    async text () {
      // 强制思考的模型可能把内容全放在 reasoning_content 里 —— 那也证明调用是通的。
      return JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '', reasoning_content: '用户在打招呼' } }]
      })
    }
  }))
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  assert.equal(payload.value.okCount, 1, 'reasoning_content 有内容同样算可用')
  assert.match(payload.value.results[0].reply, /打招呼/)
})

test('probe 支持只探指定模型，并识别 openai-responses 协议', async t => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'openai-responses',
        baseURL: 'https://relay.example/v1',
        apiKeyEnv: 'GM_API_KEY',
        models: [{ id: 'm1', name: 'm1' }, { id: 'm2', name: 'm2' }, { id: 'm3', name: 'm3' }]
      }
    }
  })
  const seen = []
  stubFetch(t, async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      status: 200,
      async text () {
        return JSON.stringify({ output_text: 'hi there', usage: { input_tokens: 5, output_tokens: 2 } })
      }
    }
  })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, {
    method: 'POST',
    endpoint: '/probe',
    body: { route: 'gm', models: ['m1', 'm3'] }
  })
  assert.deepEqual(payload.value.results.map(item => item.id), ['m1', 'm3'], '只探指定的模型')
  assert.equal(seen.length, 2, '没被点名的模型不该被请求')
  assert.equal(seen[0].url, 'https://relay.example/v1/responses', 'responses 协议走 /responses')
  assert.equal(seen[0].body.input, 'hi', 'responses 用 input 而不是 messages')
  assert.equal(seen[0].body.max_output_tokens, 32)
  assert.equal(payload.value.results[0].usage.inputTokens, 5, '认得出 responses 的 usage 字段名')
})

test('probe 对不支持的 api 类型如实说明，而不是拼一个错请求', async t => {
  const state = makeState({
    userProviders: {
      gm: {
        api: 'anthropic-messages',
        baseURL: 'https://relay.example/v1',
        models: [{ id: 'claude-x', name: 'claude-x' }]
      }
    }
  })
  let called = false
  stubFetch(t, async () => { called = true; return chatOk('x') })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  assert.equal(payload.value.results[0].ok, false)
  assert.match(payload.value.results[0].reason, /暂不支持探测 api 类型/)
  assert.equal(called, false, '不支持的协议不该真的发请求')
})

test('probe 缺少 route、路由不存在、无模型时都给出可读错误', async t => {
  const host = makeHost(probeState(['x']))
  apply(host.ctx)

  const missing = await callRoute(host, { method: 'POST', endpoint: '/probe', body: {} })
  assert.equal(missing.payload.ok, false)
  assert.match(missing.payload.error.message, /缺少 route/)

  const unknown = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'nope' } })
  assert.equal(unknown.payload.ok, false)
  assert.match(unknown.payload.error.message, /不在用户配置层/)
})

test('probe 限制单次探测的模型数，并如实报告被截断', async t => {
  // 造 55 个模型：超过 PROBE_MAX_MODELS（50）后必须截断，防止一次点击打出几百个计费请求。
  const ids = Array.from({ length: 55 }, (_, index) => 'model-' + String(index))
  const state = probeState(ids)
  let calls = 0
  stubFetch(t, async () => { calls += 1; return chatOk('ok') })
  const host = makeHost(state)
  apply(host.ctx)

  const { payload } = await callRoute(host, { method: 'POST', endpoint: '/probe', body: { route: 'gm' } })
  assert.equal(payload.value.results.length, 50, '单次最多探 50 个')
  assert.equal(payload.value.truncated, true)
  assert.equal(payload.value.total, 55)
  assert.equal(calls, 50, '被截断的模型不该真的发请求')
})
