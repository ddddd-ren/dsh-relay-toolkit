/**
 * 从本机 DSH Desktop 的 app.asar 里解出实现代码，供 test/cordis-smoke.mjs 使用。
 *
 * 用法：
 *   node scripts/unpack-dsh.mjs [asar 路径] [输出目录]
 *
 * 默认从 `D:/DSH/DSH Desktop/resources/app.asar` 解到系统临时目录下，
 * 完成后把 cordis 的路径打印出来，可直接喂给 DSH_CORDIS_PATH。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const asarPath = process.argv[2] ?? 'D:/DSH/DSH Desktop/resources/app.asar'
const dest = process.argv[3] ?? path.join(os.tmpdir(), 'dsh-dev-unpacked')

if (!fs.existsSync(asarPath)) {
  console.error('找不到 app.asar：' + asarPath)
  process.exit(1)
}

const fd = fs.openSync(asarPath, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const jsonLength = head.readUInt32LE(8)
const headerFieldLength = head.readUInt32LE(4)
const header = Buffer.alloc(jsonLength)
fs.readSync(fd, header, 0, jsonLength, 12)
const tree = JSON.parse(header.toString('utf8', header.indexOf(0x7b)))
const base = 8 + headerFieldLength

const files = []
;(function walk (node, prefix) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const filePath = prefix + '/' + name
    if (value.files) walk(value, filePath)
    else files.push({ path: filePath, size: value.size ?? 0, offset: Number(value.offset ?? 0), unpacked: value.unpacked === true })
  }
})(tree, '')

let written = 0
for (const file of files) {
  if (file.unpacked || file.size === 0 || file.size > 10_000_000) continue
  if (!/\.(js|mjs|cjs|json|ts|yml|yaml|md)$/i.test(file.path)) continue
  try {
    const data = Buffer.alloc(file.size)
    fs.readSync(fd, data, 0, file.size, base + file.offset)
    const target = path.join(dest, file.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
    written += 1
  } catch {
    // 单个文件写不出来不影响整体解包结果
  }
}

const cordis = path.join(dest, 'node_modules/@deepseek-ai/cordis/lib/index.js')
console.log('解出 ' + String(written) + ' 个文件到 ' + dest)
console.log('cordis: ' + cordis)
console.log('DSH_CORDIS_PATH=' + cordis.replace(/\\/g, '/'))
