/**
 * 真实 cordis 冒烟测试。
 *
 * 用从本机 DSH 里解出来的 `@deepseek-ai/cordis` 加载本插件，确认：
 *   1. 嵌套 `ctx.inject` + `scoped[serviceName]` 的访问方式不会触发
 *      `cannot get property "..." without inject`（这正是 dsh-relay-fast 栽的地方）；
 *   2. 双服务名只注册一条路由；
 *   3. 注册出来的路由在真实 cordis 上下文里能正常应答；
 *   4. 组合里没有 web 服务时，插件安静地不做事，而不是抛错。
 *
 * 运行（需要先解出 DSH 实现，见 README「开发」）：
 *   node test/cordis-smoke.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

const CORDIS_PATH = process.env.DSH_CORDIS_PATH
  ?? 'C:/Users/asus/AppData/Local/Temp/dsh-dev-unpacked/node_modules/@deepseek-ai/cordis/lib/index.js'

if (!existsSync(CORDIS_PATH)) {
  console.error('找不到 cordis：' + CORDIS_PATH + '\n请设置 DSH_CORDIS_PATH 指向 @deepseek-ai/cordis 的 lib/index.js')
  process.exit(2)
}

const { Context } = await import('file:///' + CORDIS_PATH.replace(/\\/g, '/'))
const plugin = await import(new URL('../lib/index.js', import.meta.url).href)

const NS = 'llm-pi-ai'
const BASE_PATH = '/api/relay-toolkit'

/** 造一份用户层配置。 */
function makeSettings () {
  const state = {
    revision: 3,
    user: {
      providers: {
        gm: {
          api: 'openai-completions',
          baseURL: 'https://relay.example/v1',
          apiKeyEnv: 'GM_API_KEY',
          models: [
            { id: 'glm-5.1', name: 'glm-5.1', reasoningEfforts: { off: null, low: 'low', high: 'high' } },
            { id: 'glm-5.2', name: 'glm-5.2' }
          ]
        }
      }
    }
  }
  return {
    state,
    service: {
      get: ns => (ns === NS ? state.user : undefined),
      describe: () => [{ ns: NS, user: state.user, revision: state.revision }],
      update: async () => {}
    }
  }
}

/** 造一个 node:http 风格的请求/响应替身并调用路由。 */
async function callRoute (route, { method = 'GET', endpoint = '', remoteAddress = '127.0.0.1' }) {
  const res = {
    statusCode: 0,
    body: '',
    writeHead (code) { res.statusCode = code },
    end (body) { res.body = body }
  }
  await route.handler({
    method,
    url: BASE_PATH + endpoint,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator] () {}
  }, res)
  return { status: res.statusCode, payload: JSON.parse(res.body) }
}

// —— 场景一：有 webServer 的组合 ——
{
  const registered = []
  const webServer = { register (route) { registered.push(route); return () => {} } }
  const settings = makeSettings()

  const app = new Context()
  app.provide('settings', settings.service)
  app.provide('webServer', webServer)

  await app.plugin(plugin)
  await new Promise(resolve => setTimeout(resolve, 50))

  assert.equal(registered.length, 1, '双服务名只应注册一条路由（webServer 先到）')
  const route = registered[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, BASE_PATH)

  const status = await callRoute(route, { endpoint: '/status' })
  assert.equal(status.status, 200)
  assert.equal(status.payload.ok, true)

  const gm = status.payload.value.routes.find(item => item.route === 'gm')
  assert.equal(gm.writable, true)
  assert.equal(gm.models.find(model => model.id === 'glm-5.1').declared, true)
  assert.deepEqual(
    gm.models.find(model => model.id === 'glm-5.2').suggested,
    { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    'GLM-5.2 按官方档位集合给建议'
  )

  const refused = await callRoute(route, { endpoint: '/status', remoteAddress: '10.0.0.9' })
  assert.equal(refused.status, 403)

  console.log('✓ 有 webServer：注册 1 条路由，端点应答正常，非本机请求被拒')
}

// —— 场景二：没有 web 服务的组合 ——
{
  const settings = makeSettings()
  const app = new Context()
  app.provide('settings', settings.service)

  await app.plugin(plugin)
  await new Promise(resolve => setTimeout(resolve, 50))

  console.log('✓ 无 webServer：加载未抛错，安静等待')
}

console.log('\n真实 cordis 冒烟测试全部通过')
