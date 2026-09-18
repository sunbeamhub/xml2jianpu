#!/usr/bin/env node
/**
 * CI 专用：写出 automatic 的 ExportOptions.plist，匹配 Xcode Team Profile。
 * 不要改 pbxproj（免费个人账号的描述文件不能用于 Manual）。
 *
 * 需要环境变量：APPLE_DEVELOPMENT_TEAM
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const team = process.env.APPLE_DEVELOPMENT_TEAM?.trim()

if (!team) {
  console.error('需要 APPLE_DEVELOPMENT_TEAM')
  process.exit(1)
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const exportPath = path.join(root, 'src-tauri/gen/apple/ExportOptions.plist')
fs.writeFileSync(
  exportPath,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>debugging</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>teamID</key>
    <string>${xmlEscape(team)}</string>
    <key>compileBitcode</key>
    <false/>
</dict>
</plist>
`,
)
console.log(`configure-ios-ci-signing: ExportOptions team=${team} signingStyle=automatic`)
