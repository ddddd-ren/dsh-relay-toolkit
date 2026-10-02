/**
 * DSH 0.2 契约核对 —— 对着**解包出来的真实 DSH 实现**验证插件依赖的每个触点。
 *
 * 为什么需要它：`host.test.mjs` 用的是自己写的 mock，mock 过期时会跟着一起错
 * （本轮就是这样：mock 里有 `settings.get`，真实 0.2 里已经没有了，于是 48 项
 * 测试全绿而插件在真宿主上完全失效）。这个脚本读的是 DSH 自己的源码，任何
 * 「插件假设的 API」与「DSH 实际提供的 API」不一致都会在这里失败。
 *
 * 它不启动 DSH，也不写任何配置 —— 只做静态契约断言。
 *
 * 运行（需要先解出 DSH 实现，见 README「开发」）：
 *   node test/contract-0.2.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DSH_ROOT = process.env.DSH_UNPACKED
  ?? 'C:/Users/asus/AppData/Local/Temp/dsh-020-rc2'

const PKG = path.join(DSH_ROOT, 'dsh/node_modules/@deepseek-ai')

if (!existsSync(PKG)) {
  console.error('找不到解包出来的 DSH：' + PKG + '\n请设置 DSH_UNPACKED 指向解包目录')
  process.exit(2)
}

/**
 * 读一个包的实现文件。
 *
 * 宿主包的主体在 `lib/index.js`；**双面包（dsh.client）的主体在 `lib/client.js`**，
 * 它的 `lib/index.js` 只是一个几十字节的转发壳。读错文件会让断言凭空失败。
 */
function read (name, face = 'host') {
  const file = face === 'client'
    ? path.join(PKG, name, 'lib/client.js')
    : path.join(PKG, name, 'lib/index.js')
  if (!existsSync(file)) throw new Error('找不到 ' + name + ' 的 ' + face + ' 实现：' + file)
  return readFileSync(file, 'utf8')
}

/** 读一个包的 package.json。 */
function version (name) {
  return JSON.parse(readFileSync(path.join(PKG, name, 'package.json'), 'utf8')).version
}

const checks = []
function check (title, run) {
  try {
    run()
    checks.push(['ok', title])
  } catch (error) {
    checks.push(['fail', title, error instanceof Error ? error.message : String(error)])
  }
}

// ── 版本基线 ──────────────────────────────────────────────────────────────
const dshVersion = version('dsh')
check('DSH 版本是 0.2 线（插件本轮适配的目标）', () => {
  assert.match(dshVersion, /^0\.2\./, '当前 DSH 是 ' + dshVersion)
})
check('cordis 是 4.x 线', () => {
  assert.match(version('cordis'), /^4\./, '当前 cordis 是 ' + version('cordis'))
})

// ── settings 服务 ─────────────────────────────────────────────────────────
const settingsSrc = read('dsh-settings')

check('settings 服务名仍是 "settings"', () => {
  assert.match(settingsSrc, /super\(\s*ownerContext\s*,\s*"settings"\s*\)/,
    'settings 服务的注册名变了')
})

check('settings.describe() 存在（插件的唯一读取入口）', () => {
  assert.match(settingsSrc, /describe\s*\(\s*options\s*\)\s*\{/, 'describe() 不见了')
})

check('describe() 的每个条目带 ns / revision / value / user', () => {
  for (const field of ['ns:', 'revision,', 'value:', 'user:']) {
    assert.ok(settingsSrc.includes(field), 'describe() 的返回里缺少 ' + field)
  }
})

check('settings.get() **不存在** —— 插件绝不能依赖它', () => {
  // 这正是本轮失效的根因：旧实现用 settings.get(NS)，0.2 上它没了。
  const getter = /^\t(?:async\s+)?get\s*\(\s*ns\s*\)\s*\{/m
  assert.equal(getter.test(settingsSrc), false,
    'settings.get() 又出现了；若真回归，插件可以简化，但必须先更新这条断言')
})

check('settings.update(ns, patch, expectedRevision) 签名不变', () => {
  assert.match(settingsSrc, /async update\(ns,\s*patch,\s*expectedRevision\)/,
    'update() 的签名变了')
})

check('写入前会校验 expectedRevision（插件的并发保护依赖它）', () => {
  assert.match(settingsSrc, /SettingsConflictError/, '冲突检测不见了')
})

check('llm-pi-ai 的 providers 仍是 volatile（描述符能看见它）', () => {
  const src = read('dsh-llm-pi-ai')
  assert.match(src, /providers:\s*z\.dict\(profile\)[^\n]*\.volatile\(\)/,
    'providers 不再 volatile，describe() 里就看不到它了')
})

// ── llm 服务 ──────────────────────────────────────────────────────────────
const llmSrc = read('dsh-llm')
check('llm.discoverModels(settingsNs, request) 仍存在', () => {
  assert.match(llmSrc, /async discoverModels\(settingsNs,\s*request,\s*signal\)/,
    'discoverModels 的签名变了')
})

check('发现结果含 inputModalities（插件用它优先判断图像能力）', () => {
  assert.match(llmSrc, /inputModalities/, 'inputModalities 不见了')
})

check('发现结果仍含 contextWindow / maxTokens', () => {
  assert.match(llmSrc, /contextWindow/, 'contextWindow 不见了')
  assert.match(llmSrc, /maxTokens/, 'maxTokens 不见了')
})

// ── credentials 服务 ──────────────────────────────────────────────────────
const credSrc = read('dsh-credentials-local')
check('credentials.resolve(ref) 仍返回 { value }', () => {
  assert.match(credSrc, /resolve\(ref\)\s*\{/, 'resolve() 不见了')
  assert.match(credSrc, /value:\s*inherited/, 'resolve() 的返回形状变了')
})

// ── web 服务 ──────────────────────────────────────────────────────────────
const webSrc = read('dsh-host-webserver')
check('webServer.register({ kind, path, handler }) 仍存在', () => {
  assert.match(webSrc, /register\(route\)\s*\{/, 'register() 不见了')
  assert.match(webSrc, /route\.kind\s*===\s*"exact"/, 'kind 判定变了')
})
check('路由按最长前缀匹配，且 handler 被 await', () => {
  assert.match(webSrc, /Longest-prefix-wins/, '前缀匹配语义变了')
  assert.match(webSrc, /await route\.handler\(req,\s*res\)/, 'handler 的派发方式变了')
})

// ── 默认模型 ──────────────────────────────────────────────────────────────
const defSrc = read('dsh-agent-default-model')
check('agent-default-model 的 provider / model 仍是 volatile', () => {
  assert.match(defSrc, /provider:\s*z\.string\(\)\.required\(\)\.volatile\(\)/,
    'provider 不再 volatile，描述符里就读不到了')
  assert.match(defSrc, /model:\s*z\.string\(\)\.required\(\)\.volatile\(\)/,
    'model 不再 volatile')
})

// ── 客户端 ────────────────────────────────────────────────────────────────
const slotsSrc = read('dsh-client-ui-slots')
check('客户端 slots.register(options, component) 契约不变', () => {
  assert.match(slotsSrc, /register\(options,\s*component\)\s*\{/, 'register() 的签名变了')
})

const generalSrc = read('dsh-client-ui-settings-general', 'client')
check('settings.section 槽位仍被声明为 list（父条目必须声明它）', () => {
  assert.match(generalSrc, /"settings\.section":\s*\{\s*kind:\s*"list"/,
    'settings.section 槽位声明变了')
})

check('list 槽位注册必须带 id（插件已带）', () => {
  assert.match(slotsSrc, /list slot "\$\{options\.name\}" requires options\.id/,
    'list 槽位对 id 的要求变了')
})

check('平台播种表仍含 react 与 react/jsx-runtime（插件 bundle 只依赖它们）', () => {
  const frontend = readFileSync(
    path.join(PKG, 'dsh-web-frontend/dist/assets',
      // 资产文件名带内容哈希，所以按前缀找。
      readdirSync(path.join(PKG, 'dsh-web-frontend/dist/assets')).find(f => f.startsWith('index-') && f.endsWith('.js'))),
    'utf8'
  )
  for (const word of ['"react/jsx-runtime"', 'react-dom']) {
    assert.ok(frontend.includes(word), '播种表里没有 ' + word)
  }
})

// ── 汇总 ──────────────────────────────────────────────────────────────────
const failed = checks.filter(([state]) => state === 'fail')
for (const [state, title, reason] of checks) {
  console.log((state === 'ok' ? '✓ ' : '✗ ') + title + (reason === undefined ? '' : ' —— ' + reason))
}

console.log('')
console.log('DSH ' + dshVersion + ' · cordis ' + version('cordis') + ' · ' + checks.length + ' 项契约，' + failed.length + ' 项失败')

if (failed.length > 0) process.exit(1)
console.log('DSH 0.2 契约核对全部通过')
