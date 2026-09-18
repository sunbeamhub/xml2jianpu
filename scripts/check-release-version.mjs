#!/usr/bin/env node
/**
 * 校验发版 tag：必须是 vMAJOR.MINOR.PATCH，与工程版本一致，且严格高于已有 tag。
 *
 *   node scripts/check-release-version.mjs v0.0.2
 *   node scripts/check-release-version.mjs v0.0.2 --commit <sha>
 *
 * CI 中可省略参数，改读 GITHUB_REF_NAME。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/
export const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/

export function parseSemver(version) {
  const m = String(version).match(VERSION_RE)
  if (!m) {
    throw new Error(`版本号必须是 MAJOR.MINOR.PATCH，收到：${version}`)
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    text: `${m[1]}.${m[2]}.${m[3]}`,
  }
}

export function cmpSemver(a, b) {
  const x = typeof a === 'string' ? parseSemver(a) : a
  const y = typeof b === 'string' ? parseSemver(b) : b
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch
}

export function tagToVersion(tag) {
  const m = String(tag).match(TAG_RE)
  if (!m) {
    throw new Error(`标签必须是 vMAJOR.MINOR.PATCH，收到：${tag}`)
  }
  return `${m[1]}.${m[2]}.${m[3]}`
}

function gitShow(commit, relPath) {
  return execFileSync('git', ['show', `${commit}:${relPath}`], {
    cwd: root,
    encoding: 'utf8',
  })
}

function readRepoFile(relPath, commit) {
  if (commit) return gitShow(commit, relPath)
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function cargoPackageVersion(text) {
  return text.match(/^version = "([^"]+)"/m)?.[1]
}

export function readProjectVersions({ commit } = {}) {
  const pkg = JSON.parse(readRepoFile('package.json', commit)).version
  const tauri = JSON.parse(readRepoFile('src-tauri/tauri.conf.json', commit)).version
  const cargo = cargoPackageVersion(readRepoFile('src-tauri/Cargo.toml', commit))
  return { pkg, tauri, cargo }
}

function uniqueTags(tags) {
  return [...new Set(tags)]
}

function listLocalReleaseTags() {
  try {
    return execFileSync('git', ['tag', '-l', 'v*.*.*'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function listRemoteReleaseTags() {
  try {
    return execFileSync('git', ['ls-remote', '--tags', 'origin'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/)?.[1])
      .filter(Boolean)
  } catch {
    return []
  }
}

export function listReleaseTags({ exclude } = {}) {
  return uniqueTags([...listLocalReleaseTags(), ...listRemoteReleaseTags()]).filter(
    (t) => TAG_RE.test(t) && t !== exclude,
  )
}

export function maxReleaseTag(tags) {
  if (!tags.length) return null
  return tags
    .map((tag) => ({ tag, version: tagToVersion(tag) }))
    .sort((a, b) => cmpSemver(a.version, b.version))
    .at(-1)
}

export function assertFilesMatch(version, { commit } = {}) {
  const { pkg, tauri, cargo } = readProjectVersions({ commit })
  const mismatch = []
  if (pkg !== version) mismatch.push(`package.json=${pkg}`)
  if (tauri !== version) mismatch.push(`tauri.conf.json=${tauri}`)
  if (cargo !== version) mismatch.push(`Cargo.toml=${cargo}`)
  if (mismatch.length) {
    throw new Error(`工程版本必须与 ${version} 一致，实际：${mismatch.join(', ')}`)
  }
}

export function assertIncreasing(version, { excludeTag } = {}) {
  const max = maxReleaseTag(listReleaseTags({ exclude: excludeTag }))
  if (max && cmpSemver(version, max.version) <= 0) {
    throw new Error(`禁止推送相同或更低版本：${version} 未高于已有 ${max.tag}`)
  }
}

export function checkReleaseTag(tag, { commit } = {}) {
  const version = tagToVersion(tag)
  assertFilesMatch(version, { commit })
  assertIncreasing(version, { excludeTag: tag })
  return version
}

export function parseCheckArgs(argv) {
  const args = argv.slice(2)
  let tag
  let commit
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--commit') {
      commit = args[i + 1]
      i += 1
    } else if (!args[i].startsWith('-')) {
      tag = args[i]
    }
  }
  return { tag, commit }
}

function isMain() {
  const entry = process.argv[1]
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url)
}

if (isMain()) {
  try {
    const parsed = parseCheckArgs(process.argv)
    const tag = parsed.tag || process.env.GITHUB_REF_NAME
    if (!tag) {
      console.error('用法：node scripts/check-release-version.mjs vX.Y.Z [--commit <sha>]')
      process.exit(1)
    }
    checkReleaseTag(tag, { commit: parsed.commit })
    console.log(`版本校验通过：${tag}`)
  } catch (err) {
    console.error(err.message || err)
    process.exit(1)
  }
}
