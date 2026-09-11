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
