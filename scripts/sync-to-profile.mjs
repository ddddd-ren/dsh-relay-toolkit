/**
 * 把源码同步进 DSH profile 的已安装副本。
 *
 * 为什么需要它：`dsh plugin add file:…` 是把插件**拷贝**进
 * `~/.dsh/profiles/<profile>/node_modules/`，不是软链接。改完 `lib/` 后要么重装，
 * 要么直接同步 —— 这个脚本做后者，并且在复制前先备份旧副本。
 *
 * 用法：
 *   node scripts/sync-to-profile.mjs                    # 默认 desktop
 *   node scripts/sync-to-profile.mjs --profile web
 *   node scripts/sync-to-profile.mjs --check            # 只比对差异，不写
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, '..')

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const profileIndex = args.indexOf('--profile')
const profile = profileIndex >= 0 && args[profileIndex + 1] !== undefined
  ? args[profileIndex + 1]
  : 'desktop'

const target = path.join(os.homedir(), '.dsh', 'profiles', profile, 'node_modules', 'dsh-relay-toolkit')

if (!fs.existsSync(target)) {
  console.error('找不到已安装副本：' + target)
  console.error('先用 dsh plugin --profile ' + profile + ' add file:<本仓库路径> 安装。')
  process.exit(1)
}

/**
 * 要同步的相对路径。
 *
 * `test/` 与 `docs/` 走下面的目录扫描（它们会新增文件），这里只列固定文件。
 * `docs/MODEL_SPECS.md` 一度漏掉过 —— 它是插件核对结论的落点，必须跟着走。
 */
const FILES = [
  'lib/index.js',
  'lib/client.js',
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'scripts/fix-efforts.mjs',
  'scripts/unpack-dsh.mjs',
  'scripts/sync-to-profile.mjs',
  'scripts/coverage-report.mjs'
]

/** 整目录同步：逐个文件比对，新增的也带过去。 */
const DIRS = ['test', 'docs']

function same (a, b) {
  if (!fs.existsSync(b)) return false
  return fs.readFileSync(a).equals(fs.readFileSync(b))
}

const changed = []
for (const rel of FILES) {
  const from = path.join(source, rel)
  if (!fs.existsSync(from)) continue
  if (!same(from, path.join(target, rel))) changed.push(rel)
}

for (const dir of DIRS) {
  const from = path.join(source, dir)
  if (!fs.existsSync(from)) continue
  for (const name of fs.readdirSync(from)) {
    const rel = dir + '/' + name
    if (!same(path.join(from, name), path.join(target, rel))) changed.push(rel)
  }
}

if (changed.length === 0) {
  console.log('已安装副本与源码一致，无需同步。')
  process.exit(0)
}

console.log('有差异的 ' + String(changed.length) + ' 个文件：')
for (const rel of changed) console.log('  ' + rel)

if (checkOnly) {
  console.log('\n--check：未写入任何内容')
  process.exit(0)
}

// 备份旧副本（只保留一份，避免堆积）。
const backup = target + '.bak-before-sync'
if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true })
fs.cpSync(target, backup, { recursive: true })
console.log('\n已备份旧副本到 ' + backup)

for (const rel of changed) {
  const from = path.join(source, rel)
  const to = path.join(target, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

console.log('已同步 ' + String(changed.length) + ' 个文件到 ' + target)
console.log('重启 DSH Desktop 后生效。')
