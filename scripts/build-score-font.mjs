#!/usr/bin/env node
/**
 * 把 public/fonts/NotoSansSC-Regular.ttf 压成 WOFF2（屏幕用）。
 * TTF 留给 jsPDF 嵌入，不要删。
 *
 *   npm run font:woff2
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ttf = path.join(root, 'public/fonts/NotoSansSC-Regular.ttf')
const woff2 = path.join(root, 'public/fonts/NotoSansSC-Regular.woff2')

if (!fs.existsSync(ttf)) {
  console.error(`缺少 ${ttf}`)
  process.exit(1)
}

const result = spawnSync('npx', ['--yes', 'ttf2woff2'], {
  cwd: root,
  input: fs.readFileSync(ttf),
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'inherit'],
})

if (result.status !== 0) {
  console.error('ttf2woff2 失败')
  process.exit(result.status || 1)
}

fs.writeFileSync(woff2, result.stdout)
const ttfKb = Math.round(fs.statSync(ttf).size / 1024)
const woffKb = Math.round(fs.statSync(woff2).size / 1024)
console.log(`WOFF2 ${woffKb}KB（TTF ${ttfKb}KB）→ ${path.relative(root, woff2)}`)
