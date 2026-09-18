#!/usr/bin/env node
/**
 * 把工程版本升到指定的 MAJOR.MINOR.PATCH（必须高于当前版本和已有 tag）。
 *
 *   npm run version:bump -- 0.0.2
 *
 * 只改文件，不 commit、不打 tag。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  assertIncreasing,
  cmpSemver,
  parseSemver,
  readProjectVersions,
  root,
} from './check-release-version.mjs'

function replaceOnce(relPath, pattern, replacement) {
  const full = path.join(root, relPath)
  const text = fs.readFileSync(full, 'utf8')
  const next = text.replace(pattern, replacement)
  if (next === text) {
    throw new Error(`未能更新 ${relPath} 中的版本号`)
  }
  fs.writeFileSync(full, next)
}

function writeVersions(version) {
  replaceOnce('package.json', /^(\s*"version": ")[^"]+/m, `$1${version}`)
  replaceOnce(
    'package-lock.json',
    /("name": "xml2jianpu-vue",\n\s*"version": ")[^"]+/g,
    `$1${version}`,
  )
  replaceOnce('src-tauri/tauri.conf.json', /^(\s*"version": ")[^"]+/m, `$1${version}`)

  replaceOnce(
    'src-tauri/Cargo.toml',
    /^version = "[^"]+"/m,
    `version = "${version}"`,
  )
  replaceOnce(
    'src-tauri/Cargo.lock',
    /(\[\[package\]\]\nname = "xml2jianpu"\n)version = "[^"]+"/,
    `$1version = "${version}"`,
  )
  replaceOnce(
    'src-tauri/gen/apple/project.yml',
    /CFBundleShortVersionString:\s*[^\n]+/,
    `CFBundleShortVersionString: ${version}`,
  )
  replaceOnce(
    'src-tauri/gen/apple/project.yml',
    /CFBundleVersion:\s*[^\n]+/,
    `CFBundleVersion: "${version}"`,
  )
  replaceOnce(
    'src-tauri/gen/apple/xml2jianpu_iOS/Info.plist',
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+/,
    `$1${version}`,
  )
  replaceOnce(
    'src-tauri/gen/apple/xml2jianpu_iOS/Info.plist',
    /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+/,
    `$1${version}`,
  )
}

try {
  const raw = process.argv[2]
  if (!raw) {
    console.error('用法：npm run version:bump -- 0.0.2')
    process.exit(1)
  }
  const version = parseSemver(raw.replace(/^v/, '')).text
  const current = parseSemver(readProjectVersions().pkg)
  if (cmpSemver(version, current) <= 0) {
    throw new Error(`新版本 ${version} 必须高于当前工程版本 ${current.text}`)
  }
  assertIncreasing(version)
  writeVersions(version)
  console.log(`已把工程版本从 ${current.text} 升到 ${version}`)
  console.log(`提交后执行：git tag v${version} && git push origin tauri v${version}`)
} catch (err) {
  console.error(err.message || err)
  process.exit(1)
}
