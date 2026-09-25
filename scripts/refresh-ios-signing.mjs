#!/usr/bin/env node
/**
 * macOS：检查本机 iOS 描述文件。
 * 已过期则抛错，调用方不应再改版本文件。
 * 未过期则把单行 Base64 拷入剪贴板，供粘贴到 IOS_MOBILE_PROVISION。
 * 不处理证书，不调用 gh。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { root } from './check-release-version.mjs'

const PBXPROJ = 'src-tauri/gen/apple/xml2jianpu.xcodeproj/project.pbxproj'
const PROFILE_DIR = path.join(
  os.homedir(),
  'Library/Developer/Xcode/UserData/Provisioning Profiles',
)

function uniqueSettings(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1].trim()))]
}

function readSigningIds() {
  const text = fs.readFileSync(path.join(root, PBXPROJ), 'utf8')
  const teams = uniqueSettings(text, /DEVELOPMENT_TEAM = ([^;]+);/g)
  const bundles = uniqueSettings(text, /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)
  if (teams.length !== 1 || bundles.length !== 1) {
    throw new Error('pbxproj 中 DEVELOPMENT_TEAM 或 PRODUCT_BUNDLE_IDENTIFIER 不唯一')
  }
  return { team: teams[0], bundleId: bundles[0] }
}

function plistExtract(plist, keyPath) {
  return execFileSync('plutil', ['-extract', keyPath, 'raw', '-'], {
    input: plist,
    encoding: 'utf8',
  }).trim()
}

function readProfile(file) {
  let plist
  try {
    plist = execFileSync('security', ['cms', '-D', '-i', file], { encoding: 'utf8' })
  } catch {
    return null
  }
  try {
    const appId = plistExtract(plist, 'Entitlements.application-identifier')
    const expiresAt = new Date(plistExtract(plist, 'ExpirationDate'))
    if (!appId || Number.isNaN(expiresAt.getTime())) return null
    return { file, appId, expiresAt }
  } catch {
    return null
  }
}

function findLatestProfile(appId) {
  if (!fs.existsSync(PROFILE_DIR)) return null
  const matches = fs
    .readdirSync(PROFILE_DIR)
    .filter((name) => name.endsWith('.mobileprovision'))
    .map((name) => readProfile(path.join(PROFILE_DIR, name)))
    .filter((profile) => profile && profile.appId === appId)
  matches.sort((a, b) => b.expiresAt - a.expiresAt)
  return matches[0] ?? null
}

function xcodeHint() {
  return '请用 Xcode 打开 src-tauri/gen/apple/xml2jianpu.xcodeproj，连接真机对 xml2jianpu_iOS 再 Run 一次，然后重新执行同一条 version:bump。不要去 Apple Developer 网站新建 Profile。'
}

export function refreshIosProvisioningProfile() {
  if (process.platform !== 'darwin') return

  const { team, bundleId } = readSigningIds()
  const appId = `${team}.${bundleId}`
  const latest = findLatestProfile(appId)
  if (!latest) {
    throw new Error(`没有找到 application-identifier 为 ${appId} 的描述文件。${xcodeHint()}`)
  }
  if (latest.expiresAt.getTime() <= Date.now()) {
    throw new Error(
      `iOS 描述文件已于 ${latest.expiresAt.toISOString()} 过期：${latest.file}\n${xcodeHint()}`,
    )
  }

  const encoded = execFileSync('base64', ['-b', '0', '-i', latest.file], {
    encoding: 'utf8',
  }).trim()
  execFileSync('pbcopy', { input: encoded })
  console.log(
    `iOS 描述文件未过期（${latest.expiresAt.toISOString()}），Base64 已复制到剪贴板。`,
  )
  console.log('请粘贴覆盖仓库 Secret IOS_MOBILE_PROVISION。证书 Secret 无需在此更新。')
}
