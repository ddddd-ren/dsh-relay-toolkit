/**
 * 按官方规格表修正 settings.yaml 里的 `reasoningEfforts`。
 *
 * 规则与插件**完全一致**（直接 import 插件的 `suggestEfforts`，不另抄一份表）：
 *
 *   - 官方确认支持 `reasoning_effort` 的模型 → 写成官方档位集合；
 *   - 官方确认不支持、或官方未公布档位枚举的模型 → **删除**声明。留着是有害的：
 *     DSH 会把无效档位显示给用户，选中就真发 `reasoning_effort`，上游会报错或静默忽略；
 *   - 插件认不出家族的模型 → **原样不动**（那可能是你自己知道、而官方表里没有的模型，
 *     删掉等于替你做了决定）。判定用插件的 `noEffortReason()`，与插件同一套规则。
 *
 * 用法（默认目标是 ~/.dsh/settings.yaml）：
 *   node scripts/fix-efforts.mjs --dry-run          # 只看会改什么，不写文件
 *   node scripts/fix-efforts.mjs                    # 真正写入
 *   node scripts/fix-efforts.mjs <settings.yaml>    # 指定文件
 *
 * 写入前请自行备份；本脚本假设 RSH 的 settings.yaml 是程序生成的纯数据
 * （它没有注释，用 js-yaml 重写不会丢东西）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * js-yaml 向 DSH 的 profile 借 —— 本仓库不带依赖，所以位置得自己找。
 * 不再写死某个用户名：先看 DSH_JS_YAML，再扫 ~/.dsh/profiles 下每个 profile 的 node_modules。
 */
const YAML_CANDIDATES = [
  process.env.DSH_JS_YAML,
  ...profileJsYamlPaths()
]

/** 各 profile 下 js-yaml 的默认位置。 */
function profileJsYamlPaths () {
  const profiles = path.join(os.homedir(), '.dsh', 'profiles')
  if (!fs.existsSync(profiles)) return []
  return fs.readdirSync(profiles)
    .map(name => path.join(profiles, name, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs'))
}

const yamlPath = YAML_CANDIDATES.find(candidate =>
  typeof candidate === 'string' && candidate !== '' && fs.existsSync(candidate))

if (yamlPath === undefined) {
  console.error('找不到 js-yaml。用 DSH_JS_YAML 指路，例如：')
  console.error('  set DSH_JS_YAML=%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules\\js-yaml\\dist\\js-yaml.mjs')
  process.exit(1)
}

const yamlModule = await import(pathToFileURL(yamlPath).href)
const yaml = yamlModule.default ?? yamlModule

const { suggestEfforts, noEffortReason } = await import('../lib/index.js')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find(arg => !arg.startsWith('--')) ?? path.join(os.homedir(), '.dsh', 'settings.yaml')

const doc = yaml.load(fs.readFileSync(target, 'utf8'))
const providers = doc?.['llm-pi-ai']?.providers
if (providers === undefined) {
  console.error('没找到 llm-pi-ai.providers，什么都没做：' + target)
  process.exit(1)
}

const updated = []
const removed = []
const kept = []
const untouched = []

for (const [route, profile] of Object.entries(providers)) {
  if (!Array.isArray(profile?.models)) continue
  for (const model of profile.models) {
    if (typeof model?.id !== 'string') continue
    const current = model.reasoningEfforts
    const suggested = suggestEfforts(model.id)

    if (suggested === undefined) {
      // 只有官方明确「不支持档位」的才删；认不出家族的原样不动。
      if (noEffortReason(model.id) === undefined) {
        if (current !== undefined) untouched.push({ route, id: model.id })
        continue
      }
      if (current !== undefined) {
        delete model.reasoningEfforts
        removed.push({ route, id: model.id, before: current })
      }
      continue
    }
    if (JSON.stringify(current) === JSON.stringify(suggested)) {
      kept.push({ route, id: model.id })
      continue
    }
    model.reasoningEfforts = suggested
    updated.push({ route, id: model.id, before: current, after: suggested })
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
  fs.writeFileSync(target, yaml.dump(doc, { lineWidth: 200, noRefs: true }), 'utf8')
  console.log('\n已写入 ' + target)
}
