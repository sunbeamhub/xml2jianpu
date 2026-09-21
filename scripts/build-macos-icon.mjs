#!/usr/bin/env node
/**
 * 生成桌面图标（不改 iOS / Android 方图）：
 * - Win/Linux：icon.png 铺满画布，clip 成圆角矩形（rx ≈ 18%）
 * - macOS：macos-icon.svg（1024 画布 + 824 squircle 留边）→ icon.icns
 *
 *   npm run icon:macos
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = path.join(root, 'src-tauri/icons')
const svgPath = path.join(iconsDir, 'macos-icon.svg')
const squarePngPath = path.join(iconsDir, 'icon.png')
const icnsPath = path.join(iconsDir, 'icon.icns')
const icoPath = path.join(iconsDir, 'icon.ico')

const CANVAS = 1024
const ROUND_RX = CANVAS * 0.18

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

const DESKTOP_PNG = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
]

const ICO_SIZES = [16, 32, 48, 256]

if (!fs.existsSync(svgPath)) {
  console.error(`缺少 ${svgPath}`)
  process.exit(1)
}

if (!fs.existsSync(squarePngPath)) {
  console.error(`缺少 ${squarePngPath}`)
  process.exit(1)
}

const macosSvg = fs.readFileSync(svgPath, 'utf8')
const squareB64 = fs.readFileSync(squarePngPath).toString('base64')
const roundedSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <clipPath id="r">
      <rect width="${CANVAS}" height="${CANVAS}" rx="${ROUND_RX}"/>
    </clipPath>
  </defs>
  <image width="${CANVAS}" height="${CANVAS}" clip-path="url(#r)" href="data:image/png;base64,${squareB64}" xlink:href="data:image/png;base64,${squareB64}"/>
</svg>`

const pngCache = new Map()

function renderSvg(svg, size) {
  const key = `${size}:${svg === macosSvg ? 'macos' : 'rounded'}`
  let png = pngCache.get(key)
  if (png) return png
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  })
  png = resvg.render().asPng()
  pngCache.set(key, png)
  return png
}

function renderRounded(size) {
  return renderSvg(roundedSvg, size)
}

function renderMacos(size) {
  return renderSvg(macosSvg, size)
}

function encodeIco(images) {
  const count = images.length
  const headerSize = 6
  const entrySize = 16
  let offset = headerSize + entrySize * count
  const entries = images.map((img) => {
    const entry = { ...img, offset, bytes: img.png.length }
    offset += img.png.length
    return entry
  })
  const buf = Buffer.alloc(offset)
  buf.writeUInt16LE(0, 0)
  buf.writeUInt16LE(1, 2)
  buf.writeUInt16LE(count, 4)
  let entryOff = 6
  for (const entry of entries) {
    buf.writeUInt8(entry.size >= 256 ? 0 : entry.size, entryOff)
    buf.writeUInt8(entry.size >= 256 ? 0 : entry.size, entryOff + 1)
    buf.writeUInt8(0, entryOff + 2)
    buf.writeUInt8(0, entryOff + 3)
    buf.writeUInt16LE(1, entryOff + 4)
    buf.writeUInt16LE(32, entryOff + 6)
    buf.writeUInt32LE(entry.bytes, entryOff + 8)
    buf.writeUInt32LE(entry.offset, entryOff + 12)
    Buffer.from(entry.png).copy(buf, entry.offset)
    entryOff += 16
  }
  return buf
}

for (const [name, size] of DESKTOP_PNG) {
  const dest = path.join(iconsDir, name)
  fs.writeFileSync(dest, renderRounded(size))
  console.log(`${path.relative(root, dest)}`)
}

const ico = encodeIco(ICO_SIZES.map((size) => ({ size, png: renderRounded(size) })))
fs.writeFileSync(icoPath, ico)
console.log(`${path.relative(root, icoPath)} ${Math.round(ico.length / 1024)}KB`)

if (process.platform !== 'darwin') {
  console.warn('非 macOS，跳过 icon.icns（需要 iconutil）')
  process.exit(0)
}

const iconset = path.join(iconsDir, 'macos.iconset')
fs.rmSync(iconset, { recursive: true, force: true })
fs.mkdirSync(iconset)

try {
  for (const [name, size] of ICONSET) {
    fs.writeFileSync(path.join(iconset, name), renderMacos(size))
  }

  const result = spawnSync('iconutil', ['-c', 'icns', '--output', icnsPath, iconset], {
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error('iconutil 失败')
    process.exit(result.status || 1)
  }
} finally {
  fs.rmSync(iconset, { recursive: true, force: true })
}

const kb = Math.round(fs.statSync(icnsPath).size / 1024)
console.log(`${path.relative(root, icnsPath)} ${kb}KB ← ${path.relative(root, svgPath)}`)
