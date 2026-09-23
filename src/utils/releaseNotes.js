const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const VERSION_HEADING = /^##\s+\[[^\]]+\](?:\s+[-\u2013\u2014]\s+(\d{4}-\d{2}-\d{2}))?\s*$/
const HEADING = /^#{2,3}\s+(.+)$/
const LIST_ITEM = /^[-*]\s+(.+)$/
const RULE = /^---\s*$/
const MAX_IMAGE_URL = 2048

/**
 * 发版说明只用到 Keep a Changelog 的一小段：版本标题、分组标题、列表、
 * 分隔线，以及单独一行的 https 图片。
 *
 * @param {string} markdown
 * @returns {Array<
 *   | { type: 'date', text: string }
 *   | { type: 'heading', text: string }
 *   | { type: 'list', items: string[] }
 *   | { type: 'paragraph', text: string }
 *   | { type: 'note', text: string }
 *   | { type: 'image', alt: string, src: string }
 * > | null}
 */
export function parseReleaseNotes(markdown) {
  try {
    return parseReleaseNoteBlocks(markdown)
  } catch {
    return null
  }
}

/**
 * 成对反引号拆成代码片段。未闭合的反引号保持原文。
 * @param {string} text
 * @returns {Array<{ code: boolean, text: string }>}
 */
export function splitInlineCode(text) {
  const input = String(text ?? '')
  /** @type {Array<{ code: boolean, text: string }>} */
  const parts = []
  let rest = input
  while (rest) {
    const start = rest.indexOf('`')
    if (start < 0) {
      parts.push({ code: false, text: rest })
      break
    }
    const end = rest.indexOf('`', start + 1)
    if (end < 0) {
      parts.push({ code: false, text: rest })
      break
    }
    if (start > 0) parts.push({ code: false, text: rest.slice(0, start) })
    const code = rest.slice(start + 1, end)
    if (code) parts.push({ code: true, text: code })
    else parts.push({ code: false, text: '``' })
    rest = rest.slice(end + 1)
  }
  return parts
}

/** @param {string} src */
function isHttpsImageUrl(src) {
  if (typeof src !== 'string' || !src || src.length > MAX_IMAGE_URL) return false
  if (!/^https:\/\/[^/\s]+/i.test(src)) return false
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

function parseReleaseNoteBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  /** @type {ReturnType<typeof parseReleaseNotes>} */
  const blocks = []
  /** @type {{ type: 'list', items: string[] } | null} */
  let list = null
  /** @type {{ type: 'paragraph' | 'note', text: string } | null} */
  let paragraph = null
  let inNote = false

  function flushList() {
    if (!list) return
    blocks.push(list)
    list = null
  }

  function flushParagraph() {
    if (!paragraph) return
    blocks.push(paragraph)
    paragraph = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushList()
      flushParagraph()
      continue
    }
    if (RULE.test(line)) {
      flushList()
      flushParagraph()
      inNote = true
      continue
    }

    const image = line.match(IMAGE_LINE)
    if (image) {
      flushList()
      flushParagraph()
      const alt = image[1]
      const src = image[2]
      if (isHttpsImageUrl(src)) {
        blocks.push({ type: 'image', alt, src })
      } else if (alt) {
        blocks.push({ type: inNote ? 'note' : 'paragraph', text: alt })
      }
      continue
    }

    if (!inNote && VERSION_HEADING.test(line)) {
      flushList()
      flushParagraph()
      const date = line.match(VERSION_HEADING)?.[1]
      if (date) blocks.push({ type: 'date', text: date })
      continue
    }

    const heading = !inNote && line.match(HEADING)
    if (heading) {
      flushList()
      flushParagraph()
      blocks.push({ type: 'heading', text: heading[1].trim() })
      continue
    }

    const item = !inNote && line.match(LIST_ITEM)
    if (item) {
      flushParagraph()
      if (!list) list = { type: 'list', items: [] }
      list.items.push(item[1])
      continue
    }

    flushList()
    const type = inNote ? 'note' : 'paragraph'
    if (paragraph && paragraph.type === type) {
      paragraph.text = `${paragraph.text}\n${line}`
    } else {
      flushParagraph()
      paragraph = { type, text: line }
    }
  }

  flushList()
  flushParagraph()
  return blocks
}
