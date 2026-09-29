import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { examples, defaultExampleId } from './scoreCatalog.js'

/** 文档目录下的乐谱根目录，三端都用这个相对路径 */
export const SCORE_LIBRARY_DIR = '易谱'

const FS_OPTS = { baseDir: BaseDirectory.Document }
const SCORE_FILE = /\.(musicxml|xml)$/i

function libraryPath(relative = '') {
  const rel = String(relative || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (!rel) return SCORE_LIBRARY_DIR
  if (rel.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('无效的乐谱路径')
  }
  return `${SCORE_LIBRARY_DIR}/${rel}`
}

function byZh(a, b) {
  return a.localeCompare(b, 'zh-CN')
}

export function scoreFileLabel(relativePath) {
  const base = String(relativePath || '').split('/').pop() || ''
  return base.replace(SCORE_FILE, '') || '选择曲谱'
}

export function sanitizeDirName(raw) {
  const name = String(raw || '')
    .replace(/[\\/]/g, '')
    .replace(/^\.+/, '')
    .trim()
  if (!name || name === '.' || name === '..') return ''
  return name
}

export function sanitizeFileName(raw) {
  const base = String(raw || '')
    .split(/[/\\]/)
    .pop()
    .replace(/^\.+/, '')
    .trim()
  if (!base) return '曲谱.musicxml'
  if (!SCORE_FILE.test(base)) return `${base}.musicxml`
  return base
}

/**
 * 由相对路径建成下拉树。空目录不出现；分组 value 用 dir: 前缀，避免和文件路径冲突。
 * @param {string[]} files
 */
export function buildScoreTree(files) {
  const root = { dirs: new Map(), files: [] }
  for (const rel of files) {
    const parts = String(rel || '').split('/').filter(Boolean)
    const fileName = parts.pop()
    if (!fileName) continue
    let node = root
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
      node = node.dirs.get(part)
    }
    node.files.push({ rel, name: scoreFileLabel(fileName) })
  }

  const options = []
  function walk(node, prefix, depth) {
    const entries = [
      ...[...node.dirs.keys()].map((name) => ({ kind: 'dir', name })),
      ...node.files.map((file) => ({ kind: 'file', name: file.name, rel: file.rel })),
    ].sort((a, b) => byZh(a.name, b.name))
    for (const entry of entries) {
      if (entry.kind === 'dir') {
        const dirRel = prefix ? `${prefix}/${entry.name}` : entry.name
        options.push({
          value: `dir:${dirRel}`,
          label: entry.name,
          group: true,
          depth,
        })
        walk(node.dirs.get(entry.name), dirRel, depth + 1)
      } else {
        options.push({
          value: entry.rel,
          label: entry.name,
          depth,
        })
      }
    }
  }
  walk(root, '', 0)
  return options
}

export function defaultLibraryScoreId(files) {
  const preferred = defaultExampleId ? `${defaultExampleId}.musicxml` : ''
  if (preferred && files.includes(preferred)) return preferred
  const first = buildScoreTree(files).find((item) => !item.group)
  return first?.value || ''
}

export async function prepareScoreLibrary() {
  const existed = await exists(SCORE_LIBRARY_DIR, FS_OPTS)
  await mkdir(SCORE_LIBRARY_DIR, { ...FS_OPTS, recursive: true })
  if (existed) return
  for (const item of examples) {
    const relative = `${item.id}.musicxml`
    const path = libraryPath(relative)
    if (await exists(path, FS_OPTS)) continue
    const response = await fetch(item.url)
    if (!response.ok) throw new Error(`读取内置曲谱失败：${item.name}`)
    const text = await response.text()
    const slash = relative.lastIndexOf('/')
    const parent = slash >= 0 ? libraryPath(relative.slice(0, slash)) : SCORE_LIBRARY_DIR
    await mkdir(parent, { ...FS_OPTS, recursive: true })
    await writeTextFile(path, text, FS_OPTS)
  }
}

export async function scanScoreTree() {
  const files = []
  const dirs = ['']
  async function walk(relDir) {
    const entries = await readDir(libraryPath(relDir), FS_OPTS)
    const sorted = entries.slice().sort((a, b) => byZh(a.name, b.name))
    for (const entry of sorted) {
      if (!entry?.name || entry.name.startsWith('.')) continue
      if (entry.isSymlink) continue
      const child = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        dirs.push(child)
        await walk(child)
      } else if (entry.isFile && SCORE_FILE.test(entry.name)) {
        files.push(child)
      }
    }
  }
  await walk('')
  return { files, dirs }
}

export function readScoreText(relativePath) {
  return readTextFile(libraryPath(relativePath), FS_OPTS)
}

export async function writeScoreInto(dirRelative, fileName, text) {
  const dir = libraryPath(dirRelative || '')
  await mkdir(dir, { ...FS_OPTS, recursive: true })
  const finalName = sanitizeFileName(fileName)
  const relative = dirRelative ? `${dirRelative}/${finalName}` : finalName
  await writeTextFile(libraryPath(relative), text, { ...FS_OPTS, create: true })
  return relative
}

export async function removeScoreDir(relative) {
  const rel = String(relative || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('不能删除根目录')
  await remove(libraryPath(rel), { ...FS_OPTS, recursive: true })
}

export async function clearScoreRoot() {
  const { files, dirs } = await scanScoreTree()
  for (const dir of dirs) {
    if (!dir || dir.includes('/')) continue
    await remove(libraryPath(dir), { ...FS_OPTS, recursive: true })
  }
  for (const file of files) {
    if (file.includes('/')) continue
    await remove(libraryPath(file), FS_OPTS)
  }
}

export async function mkdirScoreDir(parentRelative, rawName) {
  const name = sanitizeDirName(rawName)
  if (!name) throw new Error('请输入目录名')
  const relative = parentRelative ? `${parentRelative}/${name}` : name
  await mkdir(libraryPath(relative), { ...FS_OPTS, recursive: true })
  return relative
}
