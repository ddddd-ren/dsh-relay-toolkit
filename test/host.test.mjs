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

import { apply, name, inject, noEffortReason, suggestEfforts } from '../lib/index.js'

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
