#!/usr/bin/env node
/**
 * CI 专用：把 iOS target 改为手动签名，并写出 ExportOptions.plist。
 * 描述文件 UUID 每次会变，不要把结果提交进 Git。
 *
 * 需要环境变量：IOS_PROFILE_UUID、IOS_PROFILE_NAME、APPLE_DEVELOPMENT_TEAM
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const uuid = process.env.IOS_PROFILE_UUID?.trim()
const name = process.env.IOS_PROFILE_NAME?.trim()
const team = process.env.APPLE_DEVELOPMENT_TEAM?.trim()

if (!uuid || !name || !team) {
  console.error('需要 IOS_PROFILE_UUID、IOS_PROFILE_NAME、APPLE_DEVELOPMENT_TEAM')
  process.exit(1)
}

const pbxPath = path.join(root, 'src-tauri/gen/apple/xml2jianpu.xcodeproj/project.pbxproj')
const pbx = fs.readFileSync(pbxPath, 'utf8')
const patchedBlock = [
  'CODE_SIGN_IDENTITY = "Apple Development";',
  '\t\t\t\tCODE_SIGN_STYLE = Manual;',
  `\t\t\t\tDEVELOPMENT_TEAM = ${team};`,
  `\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "${uuid}";`,
].join('\n')

if (!/CODE_SIGN_IDENTITY = "iPhone Developer";\n\t\t\t\tDEVELOPMENT_TEAM = [A-Z0-9]+;/.test(pbx)) {
  if (!pbx.includes('CODE_SIGN_STYLE = Manual')) {
    console.error('project.pbxproj 未找到 iOS CODE_SIGN_IDENTITY，无法写入手动签名')
    process.exit(1)
  }
  console.log('configure-ios-ci-signing: pbxproj 已是手动签名，跳过')
} else {
  const next = pbx.replace(
    /CODE_SIGN_IDENTITY = "iPhone Developer";\n\t\t\t\tDEVELOPMENT_TEAM = [A-Z0-9]+;/g,
    patchedBlock,
  )
  fs.writeFileSync(pbxPath, next)
  console.log(`configure-ios-ci-signing: pbxproj specifier=${uuid} team=${team}`)
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
    <string>manual</string>
    <key>teamID</key>
    <string>${xmlEscape(team)}</string>
    <key>compileBitcode</key>
    <false/>
    <key>provisioningProfiles</key>
    <dict>
        <key>com.sunbeamhub.xml2jianpu</key>
        <string>${xmlEscape(name)}</string>
    </dict>
</dict>
</plist>
`,
)
console.log(`configure-ios-ci-signing: ExportOptions profile=${name}`)
