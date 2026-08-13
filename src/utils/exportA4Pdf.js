import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import initApp from '../components/MusicXMLViewer.js'
import {
  A4_SVG_WIDTH,
  CONTENT_H_MM,
  CONTENT_W_MM,
  MARGIN_MM,
} from './a4Layout.js'

export { A4_SVG_WIDTH } from './a4Layout.js'

/** 顶/底留白；顶部几乎不留，避免导出首屏顶空 */
const CONTENT_PAD_TOP = 4
const CONTENT_PAD_BOTTOM = 28

/** 与 jsPDF addFont 注册名、SVG font-family 保持一致 */
const FONT_NAME = 'NotoSansSC'
const FONT_FILE = 'NotoSansSC-Regular.ttf'
const FONT_CDN =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.5/chinese-simplified-400-normal.ttf'

let cachedFontBinary = null

function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
  return cleaned || 'jianpu-a4'
}

function arrayBufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let result = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return result
}

function publicFontUrl() {
  // Vue CLI 会在构建时把 process.env.BASE_URL 替换为 publicPath（如 /xml2jianpu/）。
  // 不要用 typeof process 判断：浏览器里 process 未定义，会错误回退成 "/" 导致 404。
  const base = process.env.BASE_URL || '/'
  return `${base}fonts/${FONT_FILE}`
}

async function fetchFontBinary(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`字体下载失败 (${res.status}): ${url}`)
  }
  return arrayBufferToBinaryString(await res.arrayBuffer())
}

/**
 * 加载并缓存中文字体（优先本地 public/fonts，失败则 CDN）。
 * jsPDF 标准字体不含中文，必须嵌入 TTF，否则会乱码。
 */
async function loadChineseFontBinary() {
  if (cachedFontBinary) return cachedFontBinary

  const errors = []
  for (const url of [publicFontUrl(), FONT_CDN]) {
    try {
      cachedFontBinary = await fetchFontBinary(url)
      return cachedFontBinary
    } catch (err) {
      errors.push(err?.message || String(err))
    }
  }
  throw new Error(`无法加载中文字体：${errors.join('；')}`)
}

function registerChineseFont(doc, binary) {
  doc.addFileToVFS(FONT_FILE, binary)
  doc.addFont(FONT_FILE, FONT_NAME, 'normal')
  doc.addFont(FONT_FILE, FONT_NAME, 'bold')
  doc.setFont(FONT_NAME)
}

/**
 * svg2pdf 按 SVG 的 font-family + font-weight 匹配已注册字体。
 * 数值字重（如歌词的 600）不会落到 bold，会回退到无中文的标准字体 → 正文乱码。
 */
function applySvgFontFamily(svgEl) {
  svgEl.querySelectorAll('text, tspan').forEach((el) => {
    el.setAttribute('font-family', FONT_NAME)
    const raw = (el.getAttribute('font-weight') || 'normal').toLowerCase()
    const numeric = Number(raw)
    const bold =
      raw === 'bold' ||
      raw === 'bolder' ||
      (!Number.isNaN(numeric) && numeric >= 600)
    el.setAttribute('font-weight', bold ? 'bold' : 'normal')
  })
}

/**
 * 垂直范围用 bbox；水平固定 A4 内容宽，窄谱居中不放大。
 */
function measureContentBox(svgEl) {
  const bbox = svgEl.getBBox()
  const attrH = Number(svgEl.getAttribute('height')) || 0

  const minY = Math.min(0, bbox.y)
  const maxY = Math.max(attrH, bbox.y + bbox.height)

  return {
    x: 0,
    y: minY - CONTENT_PAD_TOP,
    width: A4_SVG_WIDTH,
    height: Math.max(1, maxY - minY + CONTENT_PAD_TOP + CONTENT_PAD_BOTTOM),
  }
}

/**
 * 唱名在行基线上，字形上升部约需 LINE_ASCENT_PAD。
 * 行组取非重叠区间 [基线 - pad, 下一基线 - pad)，唱名+歌词整组同页，页间不重复。
 */
const LINE_ASCENT_PAD = 24

function lineGroupTop(lineIndex, marginTop, eachHeight, contentTop, ascentPad) {
  if (lineIndex <= 0) return contentTop
  return marginTop + lineIndex * eachHeight - ascentPad
}

function lineGroupBottom(
  lineIndex,
  marginTop,
  eachHeight,
  lineCount,
  contentEnd,
  ascentPad
) {
  const nominal = marginTop + (lineIndex + 1) * eachHeight - ascentPad
  if (lineIndex >= lineCount - 1) return Math.max(nominal, contentEnd)
  return nominal
}

/**
 * 按完整「唱名+歌词」行组装箱分页：一组在本页放不下则整组移到下一页，页间不重叠。
 */
function buildLineAwarePages(box, layout) {
  const maxPageH = A4_SVG_WIDTH * (CONTENT_H_MM / CONTENT_W_MM)
  const contentEnd = box.y + box.height
  const marginTop = layout?.marginTop ?? 130
  const eachHeight = layout?.eachHeight ?? 100
  const lineCount = Math.max(0, layout?.lineCount ?? 0)
  const ascentPad = LINE_ASCENT_PAD * (layout?.bodyScale ?? 1)

  if (lineCount === 0) {
    return [{ y: box.y, height: Math.max(1, box.height) }]
  }

  const pages = []
  let lineStart = 0

  while (lineStart < lineCount) {
    const pageTop = lineGroupTop(
      lineStart,
      marginTop,
      eachHeight,
      box.y,
      ascentPad
    )
    let lineEnd = lineStart

    while (lineEnd < lineCount) {
      const bottom = lineGroupBottom(
        lineEnd,
        marginTop,
        eachHeight,
        lineCount,
        contentEnd,
        ascentPad
      )
      if (bottom - pageTop <= maxPageH + 0.5) {
        lineEnd += 1
      } else {
        break
      }
    }

    // 一组本身超高时仍整组独占一页，绝不拆开唱名/歌词
    if (lineEnd === lineStart) {
      lineEnd = lineStart + 1
    }

    const pageBottom = lineGroupBottom(
      lineEnd - 1,
      marginTop,
      eachHeight,
      lineCount,
      contentEnd,
      ascentPad
    )
    pages.push({
      y: pageTop,
      height: Math.max(1, pageBottom - pageTop),
    })
    lineStart = lineEnd
  }

  return pages
}

/**
 * 按 A4 宽度离屏重绘简谱，并导出多页矢量 PDF。
 * @param {string} xmlString - MusicXML 字符串
 * @param {{ title?: string, lineBreak?: 'auto' | 'musicxml' | number | string }} [opts]
 */
export async function exportA4Pdf(xmlString, opts = {}) {
  if (!xmlString || !String(xmlString).trim()) {
    throw new Error('没有可导出的谱面内容')
  }

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${A4_SVG_WIDTH}px`,
    height: 'auto',
    overflow: 'visible',
    pointerEvents: 'none',
    opacity: '0',
  })

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  host.appendChild(svg)
  document.body.appendChild(host)

  try {
    const fontBinary = await loadChineseFontBinary()

    const result = await initApp(svg, xmlString, {
      width: A4_SVG_WIDTH,
      lineBreak: opts.lineBreak,
    })
    if (!result) {
      throw new Error('谱面渲染失败，无法导出 PDF')
    }

    applySvgFontFamily(svg)

    const box = measureContentBox(svg)
    const pages = buildLineAwarePages(box, result.layout)
    if (!pages.length) {
      throw new Error('谱面高度无效，无法导出 PDF')
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })
    registerChineseFont(doc, fontBinary)

    // 固定 A4 内容宽 1:1 映射，窄谱已在画布内居中，不再横向拉满
    const scale = CONTENT_W_MM / A4_SVG_WIDTH
    svg.setAttribute('width', String(A4_SVG_WIDTH))
    svg.setAttribute('overflow', 'hidden')

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex]
      if (pageIndex > 0) doc.addPage()

      svg.setAttribute('height', String(page.height))
      svg.setAttribute(
        'viewBox',
        `${box.x} ${page.y} ${A4_SVG_WIDTH} ${page.height}`
      )

      const drawH = Math.min(CONTENT_H_MM, page.height * scale)
      await doc.svg(svg, {
        x: MARGIN_MM,
        y: MARGIN_MM,
        width: CONTENT_W_MM,
        height: drawH,
      })
    }

    const title = opts.title || result.title || ''
    doc.save(`${sanitizeFilename(title)}.pdf`)
  } finally {
    host.remove()
  }
}
