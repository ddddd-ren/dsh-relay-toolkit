/**
 * 覆盖度自查：把插件三张规则表的实际覆盖情况打印出来。
 *
 * 用途：核对「主流厂商是否都在表里」。插件只对表里认得出的模型写字段，
 * 认不出的一律不写 —— 所以这张清单就是插件的实际能力边界。
 *
 * 运行：node scripts/coverage-report.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'lib', 'index.js'), 'utf8')

/** 从源码里抠出一张数组表的字面量文本（按括号配平）。 */
function grabTable (name) {
  const at = src.indexOf('const ' + name + ' = [')
  if (at < 0) return undefined
  const start = src.indexOf('[', at)
  let depth = 0
  for (let k = start; k < src.length; k += 1) {
    if (src[k] === '[') depth += 1
    else if (src[k] === ']') {
      depth -= 1
      if (depth === 0) return src.slice(start, k + 1)
    }
  }
  return undefined
}

/** 抽出一张表里的所有 match 数组。 */
function matchesOf (text) {
  return [...text.matchAll(/match:\s*\[([^\]]*)\]/g)]
    .map(m => m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean))
}

const plugin = await import(new URL('../lib/index.js', import.meta.url).href)

// ── 三张表的静态覆盖 ──────────────────────────────────────────────────────
for (const name of ['EFFORT_RULES', 'SPECS', 'VISION_FAMILIES']) {
  const text = grabTable(name)
  if (text === undefined) {
    console.log('=== ' + name + '：未找到 ===\n')
    continue
  }
  const rows = matchesOf(text)
  console.log('=== ' + name + '：' + String(rows.length) + ' 条规则 ===')
  for (const row of rows) console.log('  ' + row.join(' | '))
  console.log('')
}

// ── 用一批代表性 id 实测判定 ─────────────────────────────────────────────
/** 主流厂商 × 当前在售型号的代表性样本。 */
const SAMPLES = {
  DeepSeek: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash', 'deepseek-v4-flash'],
  智谱: ['glm-5.1', 'glm-5.2', 'glm-5.3', 'glm-5.3-flash', 'glm-ocr', 'glm-image'],
  月之暗面: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'k3', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
  阿里Qwen: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.7-flash'],
  腾讯混元: ['hy3', 'hy4-preview', 'hy-mt2-pro', 'hy-role'],
  MiniMax: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  小米MiMo: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.5', 'mimo-v2.5-pro'],
  xAI: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3', 'grok-4', 'grok-3'],
  OpenAI: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.1', 'gpt-5-pro', 'gpt-5'],
  Anthropic: ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'],
  Google: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro'],
  Meta: ['llama-4-scout', 'llama-4-maverick', 'llama-3.3-70b', 'meta/llama-4-scout'],
  Mistral: ['mistral-large-3', 'mistral-medium-3-5', 'magistral-medium', 'devstral-2'],
  百度: ['ernie-5.0', 'ernie-5.1', 'ernie-5.0-thinking-preview'],
  字节豆包: ['doubao-seed-2-1-pro-260915', 'doubao-seed-evolving', 'doubao-pro'],
  阶跃: ['step-5-preview', 'step-3.7-flash', 'step-3.5-flash', 'step-3'],
  其他: ['o3', 'o4-mini', 'command-a', 'phi-4']
}

console.log('=== 实测判定（★ = 认不出，界面会列为「需要你决定」）===')
let unknown = 0
let total = 0
for (const [vendor, ids] of Object.entries(SAMPLES)) {
  console.log('\n[' + vendor + ']')
  for (const id of ids) {
    total += 1
    const effort = plugin.suggestEfforts(id)
    const noEffort = plugin.noEffortReason(id)
    const vision = plugin.visionSupport(id)
    let verdict
    if (effort !== undefined) verdict = '档位 ' + Object.keys(effort).join('/')
    else if (noEffort !== undefined) verdict = '刻意不写（' + noEffort + '）'
    else {
      verdict = '★ 认不出'
      unknown += 1
    }
    console.log('  ' + id.padEnd(28) + verdict + (vision === undefined ? '' : '  [可收图]'))
  }
}

console.log('\n合计 ' + String(total) + ' 个样本，其中 ' + String(unknown) + ' 个认不出')
