#!/usr/bin/env node
/**
 * 从 src-tauri/icons/macos-icon.svg 生成 macOS icon.icns
 *（1024 画布 + 824 squircle，带透明边距）。
 *
 *   npm run icon:macos
 *
 * 不改 iOS / Android / Windows 图标。需要本机 iconutil。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(root, 'src-tauri/icons/macos-icon.svg')
const icnsPath = path.join(root, 'src-tauri/icons/icon.icns')

const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

if (process.platform !== 'darwin') {
  console.error('iconutil 只在 macOS 上可用')
  process.exit(1)
}

if (!fs.existsSync(svgPath)) {
  console.error(`缺少 ${svgPath}`)
  process.exit(1)
}

const svg = fs.readFileSync(svgPath, 'utf8')

function renderPng(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  })
  return resvg.render().asPng()
}

const iconset = path.join(root, 'src-tauri/icons/macos.iconset')
fs.rmSync(iconset, { recursive: true, force: true })
fs.mkdirSync(iconset)

for (const [name, size] of ICONSET) {
  fs.writeFileSync(path.join(iconset, name), renderPng(size))
}

const result = spawnSync('iconutil', ['-c', 'icns', '--output', icnsPath, iconset], {
  stdio: 'inherit',
})

if (result.status !== 0) {
  console.error('iconutil 失败')
  process.exit(result.status || 1)
}

fs.rmSync(iconset, { recursive: true, force: true })

const kb = Math.round(fs.statSync(icnsPath).size / 1024)
console.log(`icon.icns ${kb}KB ← ${path.relative(root, svgPath)}`)
