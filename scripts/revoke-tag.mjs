#!/usr/bin/env node
/**
 * 删除本地和 origin 上的发版标签，便于同一版本重新打标签再推送。
 *
 *   npm run tag:revoke -- 0.0.27
 *
 * 等价于：
 *   git push origin :refs/tags/v0.0.27
 *   git tag -d v0.0.27
 */
import { execFileSync } from 'node:child_process'
import { parseSemver, root } from './check-release-version.mjs'

function git(args, encoding) {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    stdio: encoding ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
}

function localTagExists(tag) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
      cwd: root,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function remoteTagExists(tag) {
  const out = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], 'utf8')
  return Boolean(out.trim())
}

try {
  const raw = process.argv[2]
  if (!raw) {
    console.error('用法：npm run tag:revoke -- 0.0.27')
    process.exit(1)
  }
  const tag = `v${parseSemver(raw.replace(/^v/, '')).text}`
  const hasLocal = localTagExists(tag)
  const hasRemote = remoteTagExists(tag)
  if (!hasLocal && !hasRemote) {
    throw new Error(`本地和远程都没有标签 ${tag}`)
  }
  if (hasRemote) {
    git(['push', 'origin', `:refs/tags/${tag}`])
    console.log(`已删除远程标签 ${tag}`)
  }
  if (hasLocal) {
    git(['tag', '-d', tag])
    console.log(`已删除本地标签 ${tag}`)
  }
} catch (err) {
  if (err.status) process.exit(err.status)
  console.error(err.message || err)
  process.exit(1)
}
