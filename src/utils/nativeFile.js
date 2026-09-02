import { isTauri, isAndroidTauri } from './platform.js'
import { savePdfFile } from './savePdf.js'

function blobToUint8ArrayViaFileReader(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () =>
      reject(reader.error || new Error('读取 PDF 数据失败'))
    reader.readAsArrayBuffer(blob)
  })
}

async function toUint8Array(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data && typeof data.arrayBuffer === 'function') {
    const buffer = await data.arrayBuffer()
    return new Uint8Array(buffer)
  }
  return blobToUint8ArrayViaFileReader(data)
}

function assertPdfMagic(bytes) {
  if (!bytes || bytes.length < 5) {
    throw new Error('PDF 生成失败')
  }
  const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4])
  if (header !== '%PDF-') {
    throw new Error('PDF 生成失败')
  }
}

function uint8ArrayToBase64(bytes) {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function isContentUri(path) {
  return typeof path === 'string' && path.startsWith('content://')
}

function normalizePdfBaseName(base) {
  const dupAfterExt = base.match(/^(.+)\.pdf([(（])(\d+)[)）]$/i)
  if (dupAfterExt) {
    const open = dupAfterExt[2]
    const close = open === '（' ? '）' : ')'
    return `${dupAfterExt[1]}${open}${dupAfterExt[3]}${close}.pdf`
  }
  if (/\.pdf$/i.test(base)) return base
  return `${base}.pdf`
}

function ensurePdfPath(path) {
  if (!path || isContentUri(path)) return path
  const sep = path.includes('\\') ? '\\' : '/'
  const i = path.lastIndexOf(sep)
  const dir = i >= 0 ? path.slice(0, i + 1) : ''
  const base = i >= 0 ? path.slice(i + 1) : path
  const normalized = normalizePdfBaseName(base)
  if (normalized === base) return path
  return `${dir}${normalized}`
}

function supportsBlobArrayBuffer() {
  try {
    return (
      typeof Blob !== 'undefined' &&
      typeof new Blob([new Uint8Array([0])]).arrayBuffer === 'function'
    )
  } catch {
    return false
  }
}

function writePdfViaAndroidBridge(path, bytes) {
  const bridge = typeof window !== 'undefined' ? window.AndroidChrome : null
  if (!bridge || typeof bridge.writeContentUri !== 'function') {
    throw new Error('当前 Android 版本不支持保存到所选位置')
  }
  bridge.writeContentUri(path, uint8ArrayToBase64(bytes))
}

/**
 * Tauri 下打开 MusicXML 文件；Web 返回 null（由 input[type=file] 处理）。
 * @returns {Promise<{ text: string, name: string } | null>}
 */
export async function openMusicXmlFile() {
  if (!isTauri()) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')

  const selected = await open({
    multiple: false,
    filters: [{ name: 'MusicXML', extensions: ['musicxml', 'xml'] }],
  })
  if (!selected || Array.isArray(selected)) return null

  const text = await readTextFile(selected)
  const name = String(selected).split(/[/\\]/).pop() || 'upload'
  return { text, name }
}

/**
 * 保存 PDF：Tauri 用原生对话框 + 文件系统；Web 走浏览器下载 / 分享。
 * @param {Blob | ArrayBuffer | Uint8Array} data
 * @param {string} filename
 * @param {{ popup?: Window | null }} [opts]
 * @returns {Promise<{ saved: boolean, path?: string }>}
 */
export async function savePdfUnified(data, filename, opts = {}) {
  if (!isTauri()) {
    await savePdfFile(data, filename, opts)
    return { saved: true }
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')

  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!path) return { saved: false }

  const bytes = await toUint8Array(data)
  assertPdfMagic(bytes)

  if (isAndroidTauri() && isContentUri(path) && !supportsBlobArrayBuffer()) {
    writePdfViaAndroidBridge(path, bytes)
    return { saved: true, path }
  }

  const targetPath = isContentUri(path) ? path : ensurePdfPath(path)
  await writeFile(targetPath, bytes)
  return { saved: true, path: targetPath }
}
