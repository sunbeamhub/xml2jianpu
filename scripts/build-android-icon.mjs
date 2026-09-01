#!/usr/bin/env node
/**
 * 生成 Android 自适应图标前景层：绿底 + 安全区内 123 字样。
 * 安装提示可能只读前景层；字形须在 Adaptive Icon 安全区内，避免遮罩裁切。
 *
 *   npm run icon:android
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(root, 'src-tauri/icons/android-icon.svg')
const outPath = path.join(root, 'src-tauri/icons/android-fg.png')

if (!fs.existsSync(svgPath)) {
  console.error(`缺少 ${svgPath}`)
  process.exit(1)
}

const svg = fs.readFileSync(svgPath, 'utf8')
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
  background: '#1B3D32',
})
const png = resvg.render().asPng()
fs.writeFileSync(outPath, png)
console.log(`已写入 ${outPath}`)
