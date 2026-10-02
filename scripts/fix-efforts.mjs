/**
 * 按官方规格表修正 profile 补丁层里的 `reasoningEfforts`。
 *
 * 规则与插件**完全一致**（直接 import 插件的 `suggestEfforts`，不另抄一份表）：
 *
 *   - 官方确认支持 `reasoning_effort` 的模型 → 写成官方档位集合；
 *   - 官方确认不支持、或官方未公布档位枚举的模型 → **删除**声明。留着是有害的：
 *     DSH 会把无效档位显示给用户，选中就真发 `reasoning_effort`，上游会报错或静默忽略；
 *   - 插件认不出家族的模型 → **原样不动**（那可能是你自己知道、而官方表里没有的模型，
 *     删掉等于替你做了决定）。判定用插件的 `noEffortReason()`，与插件同一套规则。
 *
 * **DSH 0.2 起配置不再放在 `~/.dsh/settings.yaml`**：旧文件会被一次性导入后改名成
 * `.imported`，真实配置落在 profile 的补丁层
 * `~/.dsh/profiles/<profile>/cordis.patch.yml` 里 `llm-pi-ai` 条目的 `config.providers`。
 * 本脚本因此改读那个文件，并且**用能保留注释的 yaml 库**重写 —— 补丁层是给人看的，
 * 用 js-yaml 那种丢注释的库会把你的注释一并抹掉。
 *
 * 用法（默认目标是 ~/.dsh/profiles/desktop/cordis.patch.yml）：
 *   node scripts/fix-efforts.mjs --dry-run           # 只看会改什么，不写文件
 *   node scripts/fix-efforts.mjs                     # 真正写入
 *   node scripts/fix-efforts.mjs <cordis.patch.yml>  # 指定文件
 *
 * 写入前请自行备份。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 默认 profile 名；可用 --profile <名> 覆盖。 */
const DEFAULT_PROFILE = 'desktop'

/**
 * 找一个**保留注释**的 yaml 库 —— 补丁层是手写文件，注释必须活下来。
 * 本仓库不带依赖，所以向 DSH 的 profile 借；不写死用户名，扫每个 profile。
 */
function yamlCandidates () {
  const profiles = path.join(os.homedir(), '.dsh', 'profiles')
  const found = []
  if (fs.existsSync(profiles)) {
    for (const name of fs.readdirSync(profiles)) {
      // `yaml`（eemeli/yaml）是 DSH 自己的依赖，支持 document 级编辑。
      found.push(path.join(profiles, name, 'node_modules', 'yaml', 'dist', 'index.js'))
    }
  }
  return [process.env.DSH_YAML, ...found]
}

/** 按 profile 名解析补丁层路径。 */
function patchPathFor (profile) {
  return path.join(os.homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml')
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

/**
 * 解析 `--profile <名>` 与位置参数（目标文件）。
 *
 * 这里刻意手写解析而不是「filter 掉所有 -- 开头的」：后者有个致命坑 ——
 * 当 `--profile` 不存在时 `indexOf` 返回 -1，`index !== profileIndex + 1`
 * 就变成 `index !== 0`，**恰好把第一个位置参数丢掉**，目标于是静默落回默认
 * 路径（真实配置）。本脚本的第一版就这么踩过一次，所以参数解析必须显式。
 */
function parseArgs (list) {
  let profile
  let file
  let printTarget = false
  for (let index = 0; index < list.length; index += 1) {
    const arg = list[index]
    if (arg === '--dry-run') continue
    if (arg === '--print-target') {
      printTarget = true
      continue
    }
    if (arg === '--profile') {
      profile = list[index + 1]
      if (profile === undefined) throw new Error('--profile 后面要跟 profile 名')
      index += 1
      continue
    }
    if (arg.startsWith('--')) throw new Error('未知参数：' + arg)
    if (file === undefined) file = arg
    else throw new Error('只接受一个目标文件，多给了：' + arg)
  }
  return { profile, file, printTarget }
}

let parsed
try {
  parsed = parseArgs(args)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

const profile = parsed.profile ?? DEFAULT_PROFILE
const target = parsed.file ?? patchPathFor(profile)

if (parsed.printTarget) {
  console.log(target)
  process.exit(0)
}

// 目标路径永远先亮出来：这个脚本改的是真实配置，操作者必须一眼看到改的是哪个文件。
console.log('目标：' + target)

const yamlPath = yamlCandidates().find(candidate =>
  typeof candidate === 'string' && candidate !== '' && fs.existsSync(candidate))

if (yamlPath === undefined) {
  console.error('找不到保留注释的 yaml 库。用 DSH_YAML 指路，例如：')
  console.error('  set DSH_YAML=%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules\\yaml\\dist\\index.js')
  process.exit(1)
}

const yamlModule = await import(pathToFileURL(yamlPath).href)
const YAML = yamlModule.default ?? yamlModule

const { suggestEfforts, noEffortReason } = await import('../lib/index.js')

if (!fs.existsSync(target)) {
  console.error('找不到补丁层文件：' + target)
  console.error('DSH 0.2 起配置在这里；若你的 profile 名不是 desktop，用 --profile <名> 指定。')
  process.exit(1)
}

const document = YAML.parseDocument(fs.readFileSync(target, 'utf8'))
if (document.errors.length > 0) {
  console.error('补丁层不是合法 YAML：' + String(document.errors[0]))
  process.exit(1)
}

// 补丁层是 YAML 序列，条目形如 `- id: llm-pi-ai` + `config: {...}`。
const entries = document.contents?.items ?? []

/**
 * 安全阀：目标文件必须真的是一份补丁层。
 *
 * 起因是实战教训 —— 本脚本第一版参数解析有 bug（`--profile` 不存在时
 * `indexOf` 返回 -1，`index !== profileIndex + 1` 恰好丢掉第一个位置参数），
 * 于是目标静默落回默认路径，**差点改写真实配置**。参数解析已修，这里再加一道：
 * 目标文件必须同时具备「顶层是序列」「含 llm-pi-ai 条目」「该条目有 config.providers」，
 * 否则拒绝写入。
 */
if (entries.length === 0) {
  console.error('目标不是补丁层（顶层不是非空 YAML 序列），拒绝写入：' + target)
  process.exit(1)
}

const entry = entries.find(item =>
  item !== null && typeof item.get === 'function' && item.get('id') === 'llm-pi-ai')

if (entry === undefined) {
  console.error('补丁层里没有 id 为 llm-pi-ai 的条目，什么都没做：' + target)
  process.exit(1)
}

const config = entry.get('config')
const providers = config?.get?.('providers')
if (providers === undefined || typeof providers.get !== 'function') {
  console.error('llm-pi-ai 条目里没有 config.providers，什么都没做：' + target)
  process.exit(1)
}

const updated = []
const removed = []
const kept = []
const untouched = []

for (const routeItem of providers.items) {
  const route = String(routeItem.key)
  const profileNode = routeItem.value
  const models = profileNode?.get?.('models')
  if (models === undefined || !Array.isArray(models.items)) continue

  for (const modelNode of models.items) {
    if (modelNode === null || typeof modelNode.get !== 'function') continue
    const id = modelNode.get('id')
    if (typeof id !== 'string') continue

    const current = modelNode.get('reasoningEfforts')
    const currentPlain = current === undefined ? undefined : current?.toJSON?.() ?? current
    const suggested = suggestEfforts(id)

    if (suggested === undefined) {
      // 只有官方明确「不支持档位」的才删；认不出家族的原样不动。
      if (noEffortReason(id) === undefined) {
        if (current !== undefined) untouched.push({ route, id })
        continue
      }
      if (current !== undefined) {
        modelNode.delete('reasoningEfforts')
        removed.push({ route, id, before: currentPlain })
      }
      continue
    }
    if (JSON.stringify(currentPlain) === JSON.stringify(suggested)) {
      kept.push({ route, id })
      continue
    }
    modelNode.set('reasoningEfforts', suggested)
    updated.push({ route, id, before: currentPlain, after: suggested })
  }
}

console.log('改 ' + String(updated.length) + ' 个、删 ' + String(removed.length)
  + ' 个、已符合官方 ' + String(kept.length) + ' 个'
  + (untouched.length > 0 ? '、认不出家族保持不动 ' + String(untouched.length) + ' 个' : ''))

for (const item of updated) {
  console.log('  [改] ' + item.route + '/' + item.id)
  console.log('        ' + JSON.stringify(item.before) + '  →  ' + JSON.stringify(item.after))
}
for (const item of removed) {
  console.log('  [删] ' + item.route + '/' + item.id + '   （官方不支持 reasoning_effort，或未公布档位）')
}
for (const item of untouched) {
  console.log('  [留] ' + item.route + '/' + item.id + '   （官方表里认不出这个家族，原样不动）')
}

if (dryRun) {
  console.log('\n--dry-run：未写入任何内容')
} else {
  // 用 document 序列化：注释、缩进风格、键顺序都保留。
  fs.writeFileSync(target, String(document), 'utf8')
  console.log('\n已写入 ' + target)
  console.log('重启 DSH Desktop 后生效。')
}
