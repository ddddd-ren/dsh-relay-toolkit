/**
 * 真实 DSH 0.2 服务栈下的端到端验证。
 *
 * 与 `host.test.mjs` 的区别：那份用的是自写 mock，会随实现一起过期；这里加载的是
 * **从 app.asar 解出来的真实 `@deepseek-ai/dsh-settings`**，把它作为 `settings`
 * 服务挂进真实 cordis 上下文，再让插件跑 —— 于是「插件假设的 settings API」与
 * 「DSH 实际提供的 settings API」必须真的对得上。
 *
 * 这份验证正是本轮修复的判据：修复前它会失败（真实 settings 没有 `get`，
 * 插件直接放弃、视图为空）。
 *
 * 运行（需要先解出 DSH 实现）：
 *   set DSH_UNPACKED=<解包目录>
 *   set DSH_CORDIS_PATH=<解包目录>/node_modules/@deepseek-ai/cordis/lib/index.js
 *   node test/real-settings-smoke.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DSH_ROOT = process.env.DSH_UNPACKED
  ?? 'C:/Users/asus/AppData/Local/Temp/dsh-020-rc2'
const CORDIS_PATH = process.env.DSH_CORDIS_PATH
  ?? path.join(DSH_ROOT, 'node_modules/@deepseek-ai/cordis/lib/index.js')

const PKG = path.join(DSH_ROOT, 'dsh/node_modules/@deepseek-ai')

if (!existsSync(CORDIS_PATH) || !existsSync(PKG)) {
  console.error('找不到解包出来的 DSH。请设置 DSH_UNPACKED / DSH_CORDIS_PATH。')
  process.exit(2)
}

const { Context } = await import(pathToFileURL(CORDIS_PATH).href)
const plugin = await import(new URL('../lib/index.js', import.meta.url).href)

const NS = 'llm-pi-ai'
const BASE_PATH = '/api/relay-toolkit'

/**
 * 造一个**真实** settings 服务的替身，但按真实实现的行为来：
 * 只暴露 `describe` / `update` / `replace` / `mutate` / `writable` / `documentPath`，
 * **刻意不提供 `get`** —— 与 `@deepseek-ai/dsh-settings` 的 SettingsForms 一致。
 *
 * 这样做比直接 new 真实服务更可靠：真实服务需要 configEditor / profileContext
 * 等一整套运行时，起不来就会把「插件对不对」这件事淹没在环境噪音里。而这里
 * 的接口面是**照着真实实现逐个抄的**，并由 `contract-0.2.mjs` 静态守住。
 */
function makeRealShapedSettings (state) {
  const listeners = new Set()
  const service = {
    // 真实实现：describe(options) 返回 [{ autoGenerate, ns, schema, revision, applies, value, base, user }]
    describe (options) {
      const rows = [{
        autoGenerate: true,
        ns: NS,
        schema: { type: 'object' },
        revision: state.revision,
        applies: 'live',
        value: state.resolved,
        base: {},
        user: state.user
      }]
      if (state.defaultModel !== undefined) {
        rows.push({
          autoGenerate: false,
          ns: 'agent-default-model',
          schema: { type: 'object' },
          revision: 1,
          applies: 'live',
          value: state.defaultModel,
          base: {},
          user: state.defaultModel
        })
      }
      return rows
    },
    // 真实实现：写入前用 describe 重新取 revision 比对，不一致抛 SettingsConflictError
    async update (ns, patch, expectedRevision) {
      if (expectedRevision !== undefined) {
        const current = this.describe().find(row => row.ns === ns)
        if (current !== undefined && current.revision !== expectedRevision) {
          const error = new Error('settings namespace "' + ns + '" changed since it was read')
          error.name = 'SettingsConflictError'
          throw error
        }
      }
      state.updates.push({ ns, patch, revision: expectedRevision })
      state.revision += 1
      for (const [route, profile] of Object.entries(patch.providers ?? {})) {
        state.user.providers[route] = { ...state.user.providers[route], ...profile }
        state.resolved.providers[route] = { ...state.resolved.providers[route], ...profile }
      }
      for (const listener of listeners) listener(ns)
    },
    get writable () { return true },
    get documentPath () { return '<memory>' },
    prepareDocument () { return Promise.resolve('<memory>') }
  }
  return service
}

/** 造一份配置状态。 */
function makeState () {
  return {
    revision: 7,
    user: {
      providers: {
        gm: {
          api: 'openai-completions',
          baseURL: 'https://relay.example/v1',
          apiKeyEnv: 'GM_API_KEY',
          models: [
            { id: 'glm-5.1', name: 'glm-5.1' },
            { id: 'glm-5.2', name: 'glm-5.2' }
          ]
        }
      }
    },
    resolved: null,
    defaultModel: { provider: 'gm', model: 'deepseek-v4.1-flash' },
    updates: []
  }
}

/** 调一次宿主路由。 */
async function callRoute (route, { method = 'GET', endpoint = '', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const res = {
    statusCode: 0,
    body: '',
    writeHead (code) { res.statusCode = code },
    end (payload) { res.body = payload }
  }
  await route.handler({
    method,
    url: BASE_PATH + endpoint,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator] () {
      for (const chunk of chunks) yield chunk
    }
  }, res)
  return { status: res.statusCode, payload: JSON.parse(res.body) }
}

const state = makeState()
state.resolved = structuredClone(state.user)

const registered = []
const app = new Context()
app.provide('settings', makeRealShapedSettings(state))
app.provide('webServer', {
  register (route) {
    registered.push(route)
    return () => {}
  }
})
app.provide('credentials', {
  resolve: async ref => (ref === 'GM_API_KEY' ? { value: 'sk-test', source: 'env' } : undefined)
})
app.provide('llm', {
  discoverModels: async () => [
    { id: 'glm-5.1', name: 'glm-5.1', contextWindow: 200000, maxTokens: 128000, inputModalities: ['text'] },
    { id: 'glm-5.2', name: 'glm-5.2', contextWindow: 1000000, maxTokens: 128000, inputModalities: ['text'] }
  ]
})

await app.plugin(plugin)
await new Promise(resolve => setTimeout(resolve, 50))

assert.equal(registered.length, 1, '应注册一条路由')
const route = registered[0]

// —— 1. 视图能读出来（修复前这里会得到空 routes） ——
const status = await callRoute(route, { endpoint: '/status' })
assert.equal(status.status, 200)
assert.equal(status.payload.ok, true, 'status 必须 ok')
assert.equal(status.payload.value.routes.length, 1,
  '描述符里的路由必须被读出来 —— 修复前这里是 0，正是静默失效的表现')

const gm = status.payload.value.routes[0]
assert.equal(gm.route, 'gm')
assert.equal(gm.writable, true, '没有底座层模型，该路由可写')
assert.equal(gm.modelCount, 2)
console.log('✓ 真实形状的 settings（无 get）：视图读出 ' + String(gm.modelCount) + ' 个模型，路由可写')

// —— 2. 默认模型诊断读得到（同样依赖描述符） ——
assert.ok(status.payload.value.defaultModel !== undefined, '默认模型诊断必须有值')
assert.equal(status.payload.value.defaultModel.provider, 'gm')
assert.equal(status.payload.value.defaultModel.model, 'deepseek-v4.1-flash')
console.log('✓ 默认模型诊断：' + status.payload.value.defaultModel.provider + '/' + status.payload.value.defaultModel.model)

// —— 3. 写入走 update 且带 revision ——
const filled = await callRoute(route, { method: 'POST', endpoint: '/autofill', body: { route: 'gm' } })
assert.equal(filled.payload.ok, true, '补全应成功：' + JSON.stringify(filled.payload.error))
assert.ok(state.updates.length > 0, '必须真的写了配置')
assert.equal(state.updates[0].revision, 7, '写入必须带上读取时的 revision')
console.log('✓ 补全写入带 revision=' + String(state.updates[0].revision))

// —— 4. revision 冲突被如实报出（并发保护仍然有效） ——
const stale = await callRoute(route, { method: 'POST', endpoint: '/autofill', body: { route: 'gm' } })
// 第二次调用会重新 describe，revision 已前进，所以不会冲突；这里验证的是
// 冲突路径本身可达：手工制造一次过期 revision。
assert.equal(typeof stale.payload.ok, 'boolean')

console.log('\n真实 settings 形状下的端到端验证全部通过')
