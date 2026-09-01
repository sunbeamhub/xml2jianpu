#!/usr/bin/env node
/**
 * 把 Tauri 安装包改名为 yipu_{version}_{os}_{arch}{ext}
 *
 *   node scripts/rename-bundles.mjs
 *
 * 由 npm run tauri:build 的 post 脚本自动调用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const targetRoot = path.join(root, 'src-tauri/target')

const BUNDLE_DIRS = new Set(['dmg', 'nsis', 'msi', 'deb', 'rpm', 'appimage'])

const EXT_OS = [
  ['.AppImage', 'linux'],
  ['.deb', 'linux'],
  ['.rpm', 'linux'],
  ['.dmg', 'macos'],
  ['.msi', 'windows'],
  ['.exe', 'windows'],
]

const ARCHES = ['aarch64', 'x86_64', 'amd64', 'arm64', 'armhf', 'i686', 'i386', 'x64']

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

function parseExt(name) {
  for (const [ext] of EXT_OS) {
    if (name.endsWith(`${ext}.sig`)) return `${ext}.sig`
    if (name.endsWith(ext)) return ext
  }
  return null
}

function osForExt(ext) {
  const base = ext.replace(/\.sig$/, '')
  return EXT_OS.find(([e]) => e === base)?.[1] ?? null
}

function findArch(name) {
  for (const arch of ARCHES) {
    if (name.includes(arch)) return arch
  }
  return null
}

function desiredName(fileName) {
  const ext = parseExt(fileName)
  if (!ext) return null
  const os = osForExt(ext)
  const arch = findArch(fileName)
  if (!os || !arch) return null
  return `yipu_${version}_${os}_${arch}${ext}`
}

const files = []
walkDirs(targetRoot, (full, name) => {
  if (!BUNDLE_DIRS.has(name)) return
  for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
    const item = path.join(full, ent.name)
    if (ent.name.startsWith('易谱')) {
      fs.rmSync(item, { recursive: true, force: true })
      console.log(`rename-bundles: 删除旧产物 ${path.relative(root, item)}`)
      continue
    }
    if (!ent.isFile()) continue
    files.push(item)
  }
})

if (files.length === 0) {
  console.log('rename-bundles: 未找到安装包')
  process.exit(0)
}

let renamed = 0
for (const src of files) {
  const destName = desiredName(path.basename(src))
  if (!destName) continue
  const dest = path.join(path.dirname(src), destName)
  if (src === dest) continue
  if (fs.existsSync(dest)) fs.rmSync(dest)
  fs.renameSync(src, dest)
  console.log(`${path.relative(root, src)} → ${destName}`)
  renamed += 1
}

console.log(`rename-bundles: ${renamed} 个文件`)
