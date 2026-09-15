/**
 * 浏览器半侧的结构测试。
 *
 * 不渲染 React，只验证 bundle 契约与注册形状：
 *   - 是否以包名调用 `window.__ModuleLoader__.load`；
 *   - factory 只依赖平台播种表里的 react / react/jsx-runtime；
 *   - 导出的 apply 是否在 `settings.section` 上注册出带 label 的区块。
 *
 * 运行：node --test test/client.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 在受控作用域里执行 bundle，返回它注册的行与 require 替身。 */
function loadBundle () {
  let row
  const window = { __ModuleLoader__: { load: registered => { row = registered } } }
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}],
    useEffect: () => {},
    useCallback: fn => fn
  }
  const requested = []
  const require = specifier => {
    requested.push(specifier)
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' }
    throw new Error('bundle 请求了平台播种表之外的模块：' + specifier)
  }
  // eslint-disable-next-line no-new-func -- bundle 就是一段脚本，按脚本执行
  new Function('window', source)(window)
  return { row, react, require, requested }
}

test('bundle 以包名注册一行，factory 形态正确', () => {
  const { row } = loadBundle()
  assert.ok(row !== undefined, 'bundle 必须调用 window.__ModuleLoader__.load')
  assert.equal(row.id, 'dsh-relay-toolkit', 'id 必须是包名，host 用它匹配启动图')
  assert.equal(typeof row.factory, 'function')
})

test('factory 只依赖平台播种表内的 react', () => {
  const { row, require, requested } = loadBundle()
  const exports = row.factory(require)
  assert.equal(typeof exports.apply, 'function')
  assert.ok(requested.every(specifier => ['react', 'react/jsx-runtime'].includes(specifier)),
    '不得请求 react 之外的模块（否则需要 dsh.client.external 声明）')
})

test('导出形态符合客户端插件契约', () => {
  const { row, require } = loadBundle()
  const exports = row.factory(require)
  assert.equal(exports.name, 'dsh-relay-toolkit')
  assert.deepEqual(exports.inject, ['slots'])
})

test('apply 在 settings.section 上注册带 label 的区块', () => {
  const { row, require } = loadBundle()
  const exports = row.factory(require)

  const captured = {}
  const ctx = {
    slots: {
      inject (name, callback) {
        captured.injectName = name
        captured.disposer = callback()
      },
      register (options, component) {
        captured.options = options
        captured.component = component
        return () => {}
      }
    }
  }

  exports.apply(ctx)

  assert.equal(captured.injectName, 'settings.section')
  assert.equal(captured.options.name, 'settings.section')
  assert.equal(captured.options.id, 'relay-toolkit')
  assert.equal(typeof captured.options.order, 'number')
  assert.equal(typeof captured.options.label, 'function')
  assert.equal(typeof captured.options.label(), 'string', 'label 必须给出可显示的字符串')
  assert.equal(typeof captured.component, 'function', '第二个参数是组件')
})

test('组件在无数据状态下也能渲染而不抛错', () => {
  const { row, require } = loadBundle()
  const exports = row.factory(require)

  let component
  const ctx = {
    slots: {
      inject: (name, callback) => callback(),
      register: (options, registered) => { component = registered; return () => {} }
    }
  }
  exports.apply(ctx)

  // 用一个最小 React 替身驱动：createElement 记录树，hooks 返回初值。
  const tree = component()
  assert.ok(tree !== undefined && tree !== null, '组件应返回元素树而不是 undefined')
})

/** 把元素树压成一段可搜索的文本（含按钮标题与提示文字）。 */
function flatten (node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join(' ')
  const props = node.props ?? {}
  const parts = []
  // 函数组件（RouteCard / ProbeResult）是 createElement 的 type，不会自动执行 ——
  // 这里手动展开它们，否则断言看不到卡片内部的按钮与结果。它们不用 hooks，直接调用是安全的。
  if (typeof node.type === 'function') parts.push(flatten(node.type(props)))
  parts.push(flatten(node.children))
  // 按钮的 title 就是「为什么能点/不能点」的说明，界面断言要能看见它。
  if (typeof props.title === 'string') parts.push(props.title)
  return parts.join(' ')
}

/** 用带数据的替身渲染一次区块，返回压平后的文本。 */
function renderWith (view, probes) {
  let component
  const window = { __ModuleLoader__: { load: registered => { component = registered } } }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: initial => [initial, () => {}],
    useEffect: () => {},
    useCallback: fn => fn
  }
  const require = specifier => {
    if (specifier === 'react') return React
    if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' }
    throw new Error('bundle 请求了平台播种表之外的模块：' + specifier)
  }
  new Function('window', source)(window)
  const exports = component.factory(require)

  let Section
  exports.apply({
    slots: {
      inject: (name, callback) => callback(),
      register: (options, registered) => { Section = registered; return () => {} }
    }
  })

  // useState 的调用顺序必须与组件里的声明一致：
  // view → busy → notice → error → probes。
  const queue = [view, '', null, null, probes ?? {}]
  React.useState = () => [queue.shift(), () => {}]
  return flatten(Section())
}

test('卡片上出现「测试连通性」按钮，并写明它会发计费请求', () => {
  const text = renderWith({
    routes: [{
      route: 'gm',
      displayName: 'gm',
      baseURL: 'https://relay.example/v1',
      modelCount: 2,
      undimensioned: 0,
      writable: true,
      models: [
        { id: 'glm-5.2', declared: true, suggested: null, unsupported: null, inputDeclared: true, declaresImage: false, vision: null },
        { id: 'kimi-k3', declared: true, suggested: null, unsupported: null, inputDeclared: true, declaresImage: false, vision: null }
      ]
    }]
  })

  // 按钮上的数字取自实际模型数组（与卡片头部的「N 个模型」同源）。
  assert.match(text, /测试连通性（2）/, '按钮要带上模型数')
  assert.match(text, /hi/, '标题要说明发的是 hi')
  assert.match(text, /计费请求/, '必须说清楚这是真实的计费请求')
})

test('不可写的路由照样能探测 —— 探测不写配置', () => {
  const text = renderWith({
    routes: [{
      route: 'base-only',
      displayName: 'base-only',
      baseURL: 'https://relay.example/v1',
      modelCount: 1,
      undimensioned: 0,
      writable: false,
      blockedReason: '该路由未在用户配置层定义',
      models: [{ id: 'glm-5.2', declared: true, suggested: null, unsupported: null, inputDeclared: true, declaresImage: false, vision: null }]
    }]
  })

  assert.match(text, /已禁用写入/, '写入类操作确实被禁')
  assert.match(text, /测试连通性（1）/, '但探测按钮仍然出现 —— 它只读')
})

test('探测结果面板：失败的排在前面，并显示耗时与原因', () => {
  const text = renderWith({
    routes: [{
      route: 'gm',
      displayName: 'gm',
      baseURL: 'https://relay.example/v1',
      modelCount: 2,
      undimensioned: 0,
      writable: true,
      models: []
    }]
  }, {
    gm: {
      route: 'gm',
      baseURL: 'https://relay.example/v1',
      prompt: 'hi',
      total: 2,
      truncated: false,
      okCount: 1,
      failedCount: 1,
      results: [
        { id: 'good-model', ok: true, ms: 812, reply: 'Hi there!', usage: { outputTokens: 10 } },
        { id: 'bad-model', ok: false, ms: 351, reason: '上游说：No available channel' }
      ]
    }
  })

  assert.match(text, /1 个可用 \/ 1 个失败/)
  assert.match(text, /bad-model/)
  assert.match(text, /No available channel/)
  assert.match(text, /good-model/)
  assert.match(text, /Hi there!/)
  // 失败必须排在前面：这个面板存在的意义就是让人一眼看到哪些不能用。
  assert.ok(text.indexOf('bad-model') < text.indexOf('good-model'),
    '失败的模型要排在可用的前面')
})
