#!/usr/bin/env node
/**
 * 把 iOS IPA 改名为 yipu_{version}_ios_aarch64.ipa
 *
 *   node scripts/rename-ios-bundles.mjs
 *
 * 由 npm run tauri:ios:build 的 post 脚本自动调用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const ipaRoot = path.join(root, 'src-tauri/gen/apple/build')
const destName = `yipu_${version}_ios_aarch64.ipa`

function walkIpas(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walkIpas(full, out)
    } else if (ent.isFile() && ent.name.endsWith('.ipa')) {
      out.push(full)
    }
  }
  return out
}

const files = walkIpas(ipaRoot)
if (files.length === 0) {
  console.log('rename-ios-bundles: 未找到 IPA')
  process.exit(0)
}

let renamed = 0
for (const src of files) {
  if (path.basename(src) === destName) continue
  const dest = path.join(path.dirname(src), destName)
  if (fs.existsSync(dest)) fs.rmSync(dest)
  fs.renameSync(src, dest)
  console.log(`${path.relative(root, src)} → ${destName}`)
  renamed += 1
}

console.log(`rename-ios-bundles: ${renamed} 个文件`)
