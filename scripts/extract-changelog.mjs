#!/usr/bin/env node
/**
 * 把 CHANGELOG.md 中某一版整节输出到 stdout，供 GitHub Release body_path 使用。
 *
 *   node scripts/extract-changelog.mjs v0.0.1
 */
import { extractChangelogNotes } from './changelog.mjs'
import { parseCheckArgs, tagToVersion } from './check-release-version.mjs'

try {
  const parsed = parseCheckArgs(process.argv)
  const tag = parsed.tag || process.env.GITHUB_REF_NAME
  if (!tag) {
    console.error('用法：node scripts/extract-changelog.mjs vX.Y.Z')
    process.exit(1)
  }
  process.stdout.write(extractChangelogNotes(tagToVersion(tag), { commit: parsed.commit }))
} catch (err) {
  console.error(err.message || err)
  process.exit(1)
}
