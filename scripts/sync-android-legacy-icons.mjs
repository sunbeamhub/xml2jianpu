#!/usr/bin/env node
/**
 * 将 ic_launcher_foreground.png 同步到 legacy 位图，供 HyperOS 安装器等
 * 不走 adaptive 合成的场景使用。
 *
 * 由 icon:all 在 tauri icon 之后调用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  path.join(root, 'src-tauri/icons/android'),
  path.join(root, 'src-tauri/gen/android/app/src/main/res'),
]

const densityDirs = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']
const legacyNames = ['ic_launcher.png', 'ic_launcher_round.png']

let synced = 0

for (const base of roots) {
  for (const dir of densityDirs) {
    const folder = path.join(base, dir)
    const foreground = path.join(folder, 'ic_launcher_foreground.png')
    if (!fs.existsSync(foreground)) {
      console.warn(`跳过（无前景图）: ${foreground}`)
      continue
    }
    for (const name of legacyNames) {
      const target = path.join(folder, name)
      fs.copyFileSync(foreground, target)
      synced += 1
    }
  }
}

console.log(`已同步 ${synced} 个 legacy 图标文件`)
