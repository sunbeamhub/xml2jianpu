import { isTauri } from './platform.js'
import { savePdfFile } from './savePdf.js'

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
 * @param {Blob} blob
 * @param {string} filename
 * @param {{ popup?: Window | null }} [opts]
 */
export async function savePdfUnified(blob, filename, opts = {}) {
  if (!isTauri()) {
    return savePdfFile(blob, filename, opts)
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')

  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!path) return

  const buffer = await blob.arrayBuffer()
  await writeFile(path, new Uint8Array(buffer))
}
