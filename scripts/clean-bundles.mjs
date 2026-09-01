#!/usr/bin/env node
/**
 * 删除上次 tauri build 留下的安装包目录，避免新旧 .deb 混在一起。
 *
 *   node scripts/clean-bundles.mjs
 *
 * 由 npm run tauri:build 的 pre 脚本自动调用。只清 bundle 产物，不动 Rust 编译缓存。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targetRoot = path.join(root, 'src-tauri/target')
const BUNDLE_DIRS = new Set(['dmg', 'nsis', 'msi', 'deb', 'rpm', 'appimage'])

function walkDirs(dir, visit) {
  if (!fs.existsSync(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      visit(full, ent.name)
      walkDirs(full, visit)
    }
  }
}

if (!fs.existsSync(targetRoot)) {
  console.log('clean-bundles: 无 target，跳过')
  process.exit(0)
}

let removed = 0
walkDirs(targetRoot, (full, name) => {
  if (!BUNDLE_DIRS.has(name)) return
  fs.rmSync(full, { recursive: true, force: true })
  console.log(`clean-bundles: ${path.relative(root, full)}`)
  removed += 1
})

console.log(removed ? `clean-bundles: 已清除 ${removed} 个目录` : 'clean-bundles: 无需清除')
