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

function freezeScoreNode(node) {
  const dirs = [...node.dirs.values()]
    .map(freezeScoreNode)
    .sort((a, b) => byZh(a.name, b.name))
  const files = node.files.slice().sort((a, b) => byZh(a.name, b.name))
  return { name: node.name, rel: node.rel, dirs, files }
}

/**
 * 由 `{ id, name }` 建成目录树。空目录不出现。`id` 按 `/` 切段，最后一段是曲谱。
 * @param {{ id: string, name: string }[]} items
 */
export function buildScoreNodes(items) {
  const root = { name: '', rel: '', dirs: new Map(), files: [] }
  for (const item of items || []) {
    const id = String(item?.id || '')
    const parts = id.split('/').filter(Boolean)
    const fileName = parts.pop()
    if (!fileName) continue
    let node = root
    let rel = ''
    for (const part of parts) {
      rel = rel ? `${rel}/${part}` : part
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { name: part, rel, dirs: new Map(), files: [] })
      }
      node = node.dirs.get(part)
    }
    node.files.push({ id, name: item.name || scoreFileLabel(fileName) })
  }
  return freezeScoreNode(root)
}

/** 由相对路径建成目录树。空目录不出现。 */
export function buildScoreTree(files) {
  return buildScoreNodes(
    (files || []).map((rel) => ({ id: rel, name: scoreFileLabel(rel) }))
  )
}

function firstScoreId(node) {
  const entries = [
    ...node.dirs.map((dir) => ({ kind: 'dir', name: dir.name, dir })),
    ...node.files.map((file) => ({ kind: 'file', name: file.name, file })),
  ].sort((a, b) => byZh(a.name, b.name))
  for (const entry of entries) {
    if (entry.kind === 'file') return entry.file.id
    const nested = firstScoreId(entry.dir)
    if (nested) return nested
  }
  return ''
}

export function defaultLibraryScoreId(files) {
  const preferred = defaultExampleId ? `${defaultExampleId}.musicxml` : ''
  if (preferred && files.includes(preferred)) return preferred
  return firstScoreId(buildScoreTree(files))
}

export async function prepareScoreLibrary() {
  await mkdir(SCORE_LIBRARY_DIR, { ...FS_OPTS, recursive: true })
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
