#!/usr/bin/env node
/**
 * CHANGELOG.md：按 Keep a Changelog 解析、校验、抽取、提升 Unreleased。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CHANGELOG = 'CHANGELOG.md'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIST_ITEM = /^\s*[-*]\s+\S/m

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

export function splitChangelog(text) {
  const parts = text.split(/^(?=## )/m)
  const preamble = parts[0]?.startsWith('## ') ? '' : (parts.shift() ?? '')
  const sections = parts.filter((p) => p.startsWith('## '))
  return { preamble, sections }
}

export function sectionVersion(headingBlock) {
  const first = headingBlock.split('\n')[0] ?? ''
  const m = first.match(/^## \[([^\]]+)\]/)
  return m?.[1] ?? null
}

export function sectionHasItems(headingBlock) {
  return LIST_ITEM.test(headingBlock)
}

export function findVersionSection(text, version) {
  const { sections } = splitChangelog(text)
  return sections.find((s) => sectionVersion(s) === version) ?? null
}

export function readChangelog({ commit } = {}) {
  try {
    return readRepoFile(CHANGELOG, commit)
  } catch {
    throw new Error(`缺少 ${CHANGELOG}`)
  }
}

export function assertChangelogHasVersion(version, { commit } = {}) {
  const text = readChangelog({ commit })
  const section = findVersionSection(text, version)
  if (!section) {
    throw new Error(`${CHANGELOG} 没有 ## [${version}] 章节`)
  }
  if (!sectionHasItems(section)) {
    throw new Error(`${CHANGELOG} 的 ## [${version}] 没有条目，请先写下本版本改动`)
  }
}

const RELEASE_FOOTER = `---
安装包含桌面 / Android / iOS。Web 版见 GitHub Pages。iOS 为免费个人账号 Development IPA，仅已注册设备可装，描述文件约 7 天过期。
`

export function extractChangelogNotes(version, { commit } = {}) {
  assertChangelogHasVersion(version, { commit })
  const section = findVersionSection(readChangelog({ commit }), version).trimEnd()
  return `${section}\n\n${RELEASE_FOOTER}`
}

export function localDateISO() {
  const d = new Date()
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tz).toISOString().slice(0, 10)
}

export function promoteUnreleased(text, version, date = localDateISO()) {
  if (findVersionSection(text, version)) return text
  const { preamble, sections } = splitChangelog(text)
  const unreleasedIdx = sections.findIndex((s) => sectionVersion(s) === 'Unreleased')
  if (unreleasedIdx < 0) {
    throw new Error(`${CHANGELOG} 缺少 ## [Unreleased]`)
  }
  const unreleased = sections[unreleasedIdx]
  const body = unreleased.replace(/^## \[Unreleased\]\s*/, '').trim()
  if (!sectionHasItems(unreleased)) {
    throw new Error(`${CHANGELOG} 的 [Unreleased] 为空，请先写下本版本改动再 version:bump`)
  }
  sections[unreleasedIdx] = `## [Unreleased]\n\n`
  sections.splice(unreleasedIdx + 1, 0, `## [${version}] - ${date}\n\n${body}\n\n`)
  return `${preamble}${sections.join('')}`
}

export function writePromotedChangelog(version) {
  const full = path.join(root, CHANGELOG)
  const next = promoteUnreleased(fs.readFileSync(full, 'utf8'), version)
  fs.writeFileSync(full, next)
}
