/**
 * `scripts/fix-efforts.mjs` 的参数解析与安全阀测试。
 *
 * 为什么值得单独测：这个脚本改的是**真实配置**。它的第一版参数解析有 bug ——
 * `--profile` 不存在时 `indexOf` 返回 -1，`index !== profileIndex + 1` 恰好把
 * 第一个位置参数丢掉，于是「指定了测试文件」的那次调用把目标静默落回默认路径
 * （真实配置），差点造成改写。这里把当时的每个输入组合钉死。
 *
 * 测试只跑 `--print-target`（它什么都不写就退出），因此**绝不触碰真实配置**。
 *
 * 运行：node --test test/scripts.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'scripts', 'fix-efforts.mjs')

/** 跑一次脚本，返回 stdout（失败时把 stderr 一并带出，便于定位）。 */
function run (args) {
  try {
    return execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' }).trim()
  } catch (error) {
    const stderr = error.stderr === undefined ? '' : String(error.stderr).trim()
    throw new Error('脚本执行失败：' + stderr)
  }
}

/** 默认目标（desktop profile 的补丁层）。 */
const DEFAULT_TARGET = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')

test('--print-target 默认指向 desktop profile 的补丁层', () => {
  assert.equal(run(['--print-target']), DEFAULT_TARGET)
})

test('--profile 能切换 profile', () => {
  const expected = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')
  assert.equal(run(['--print-target', '--profile', 'web']), expected)
})

test('位置参数被真正采用 —— 这正是当年丢参数的那个 bug', () => {
  const target = path.join(os.tmpdir(), 'some-other-patch.yml')
  assert.equal(run(['--print-target', target]), target,
    '位置参数被丢掉了；目标会静默落回真实配置')
})

test('位置参数与 --profile 同时给时，位置参数优先', () => {
  const target = path.join(os.tmpdir(), 'explicit.yml')
  assert.equal(run(['--print-target', '--profile', 'web', target]), target)
})

test('--dry-run 不影响目标解析', () => {
  const target = path.join(os.tmpdir(), 'dry.yml')
  assert.equal(run(['--print-target', '--dry-run', target]), target)
})

test('未知参数被拒绝，而不是被当成文件名', () => {
  assert.throws(() => run(['--nope']), /未知参数/)
})

test('多给一个位置参数被拒绝', () => {
  assert.throws(() => run(['--print-target', 'a.yml', 'b.yml']), /只接受一个目标文件/)
})

test('--profile 后面缺名字被拒绝', () => {
  assert.throws(() => run(['--print-target', '--profile']), /要跟 profile 名/)
})

test('安全阀：目标不是补丁层时拒绝写入（顶层不是序列）', () => {
  // 拿本仓库的 package.json 当"不是补丁层"的样本；加 --dry-run 保证即使判定
  // 出错也不会真的写入。
  const notAPatch = path.join(here, '..', 'package.json')
  assert.throws(() => run(['--dry-run', notAPatch]), /没有 id 为 llm-pi-ai 的条目/)
})

test('安全阀：目标文件不存在时报可读错误', () => {
  const missing = path.join(os.tmpdir(), 'definitely-not-here-' + String(Date.now()) + '.yml')
  assert.equal(existsSync(missing), false)
  assert.throws(() => run(['--dry-run', missing]), /找不到补丁层文件/)
})
