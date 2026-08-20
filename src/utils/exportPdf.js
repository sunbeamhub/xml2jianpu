import initApp from '../components/MusicXMLViewer.js'
import { getPageLayout, isExportPaperSize } from './pageLayout.js'
import {
  SCORE_FONT_FAMILY,
  SCORE_FONT_FILE,
  SCORE_FONT_CDN,
  scoreFontPublicUrl,
  ensureScoreFont,
} from './scoreFont.js'

/** 顶/底留白；顶部几乎不留，避免导出首屏顶空 */
const CONTENT_PAD_TOP = 4
const CONTENT_PAD_BOTTOM = 28

let cachedFontBinary = null

function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
  return cleaned || 'jianpu'
}

/** iPhone / iPad 的 iOS 主版本；桌面 Safari 与 iPadOS 13+ 桌面模式为 0 */
function iosMajorVersion() {
  if (typeof navigator === 'undefined') return 0
  const ua = navigator.userAgent || ''
  if (!/iP(ad|hone|od)/.test(ua)) return 0
  const matched = ua.match(/OS (\d+)_/)
  return matched ? Number(matched[1]) : 0
}

function clickAnchor(href, filename, newTab) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  if (newTab) a.target = '_blank'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function isLegacyIosPdf() {
  const ios = iosMajorVersion()
  return ios > 0 && ios < 13
}

export { isLegacyIosPdf }

function readBlobAsArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () =>
      reject(reader.error || new Error('读取 PDF 失败'))
    reader.readAsArrayBuffer(blob)
  })
}

function legacyPdfDownloadUrl(filename) {
  let base = process.env.BASE_URL || '/'
  if (base.charAt(base.length - 1) !== '/') base += '/'
  return `${base}legacy-pdf/${encodeURIComponent(filename)}`
}

function resolveServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return Promise.reject(new Error('no service worker'))
  }
  if (navigator.serviceWorker.controller) {
    return Promise.resolve(navigator.serviceWorker.controller)
  }
  return navigator.serviceWorker.ready.then((reg) => {
    const worker =
      navigator.serviceWorker.controller || (reg && reg.active)
    if (!worker) throw new Error('no service worker')
    return worker
  })
}

function storeLegacyPdfInServiceWorker(filename, buffer) {
  return resolveServiceWorker().then(
    (worker) =>
      new Promise((resolve, reject) => {
        const channel = new MessageChannel()
        const timer = setTimeout(() => {
          reject(new Error('service worker timeout'))
        }, 4000)
        channel.port1.onmessage = (event) => {
          clearTimeout(timer)
          if (event.data && event.data.ok) resolve()
          else reject(new Error('service worker rejected'))
        }
        worker.postMessage(
          { type: 'STORE_LEGACY_PDF', filename, buffer },
          [channel.port2]
        )
      })
  )
}

/**
 * iOS 12 没有可用的 a[download]。必须在用户点击的同步栈里 window.open，
 * 生成结束后再把 PDF 写进这个窗口，否则会被当成弹窗拦截，表现为「下不了」。
 */
export function openLegacyPdfWindow() {
  if (typeof window === 'undefined' || !isLegacyIosPdf()) return null
  const popup = window.open('about:blank', '_blank')
  if (!popup) return null
  try {
    popup.document.open()
    popup.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在导出 PDF…</title></head><body style="margin:0;padding:24px;font-family:sans-serif;color:#1c1c1e;line-height:1.5"><p style="margin:0 0 12px;color:#8e8e93">正在导出 PDF…</p><p style="margin:0 0 8px;font-weight:600">打开后请这样保存：</p><ol style="margin:0;padding-left:1.3em"><li>点屏幕底部的分享按钮（方框加向上箭头）</li><li>选择「存储到文件」</li><li>选好位置后点「存储」</li></ol></body></html>'
    )
    popup.document.close()
  } catch (err) {
    /* about:blank 偶发写不进去，后面仍可用 location 跳转 */
  }
  return popup
}

async function saveLegacyIosPdf(blob, filename, previewWindow) {
  const target =
    previewWindow && !previewWindow.closed ? previewWindow : window
  try {
    const buffer = await readBlobAsArrayBuffer(blob)
    await storeLegacyPdfInServiceWorker(filename, buffer)
    target.location.href = legacyPdfDownloadUrl(filename)
    return
  } catch (err) {
    const url = URL.createObjectURL(blob)
    target.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

/**
 * iOS 13+ / 其它浏览器：blob + a[download]。
 * iOS 12：经 SW 用带文件名的地址打开，避免存成 unknown。
 */
async function savePdfBlob(blob, filename, previewWindow) {
  if (isLegacyIosPdf()) {
    await saveLegacyIosPdf(blob, filename, previewWindow)
    return
  }
  const url = URL.createObjectURL(blob)
  clickAnchor(url, filename, false)
  setTimeout(() => URL.revokeObjectURL(url), 2500)
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
  for (const url of [scoreFontPublicUrl(), SCORE_FONT_CDN]) {
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
  doc.addFileToVFS(SCORE_FONT_FILE, binary)
  doc.addFont(SCORE_FONT_FILE, SCORE_FONT_FAMILY, 'normal')
  doc.addFont(SCORE_FONT_FILE, SCORE_FONT_FAMILY, 'bold')
  doc.setFont(SCORE_FONT_FAMILY)
}

/**
 * svg2pdf 按 SVG 的 font-family + font-weight 匹配已注册字体。
 * 数值字重（如歌词的 600）不会落到 bold，会回退到无中文的标准字体 → 正文乱码。
 */
function applySvgFontFamily(svgEl) {
  svgEl.querySelectorAll('text, tspan').forEach((el) => {
    el.setAttribute('font-family', SCORE_FONT_FAMILY)
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
 * 垂直范围用 bbox；水平固定纸张内容宽，窄谱居中不放大。
 */
function measureContentBox(svgEl, svgWidth) {
  const bbox = svgEl.getBBox()
  const attrH = Number(svgEl.getAttribute('height')) || 0

  const minY = Math.min(0, bbox.y)
  const maxY = Math.max(attrH, bbox.y + bbox.height)

  return {
    x: 0,
    y: minY - CONTENT_PAD_TOP,
    width: svgWidth,
    height: Math.max(1, maxY - minY + CONTENT_PAD_TOP + CONTENT_PAD_BOTTOM),
  }
}

/**
 * 唱名在行基线上。优先用渲染结果 layout.lineAscentPad（含多层八度点 / 延音线弧顶 / 三连音）。
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
function buildLineAwarePages(box, layout, pageLayout) {
  const maxPageH =
    pageLayout.svgWidth * (pageLayout.contentHMm / pageLayout.contentWMm)
  const contentEnd = box.y + box.height
  const marginTop = layout?.marginTop ?? 130
  const eachHeight = layout?.eachHeight ?? 100
  const lineCount = Math.max(0, layout?.lineCount ?? 0)
  const ascentPad =
    layout?.lineAscentPad != null
      ? Number(layout.lineAscentPad) * (layout?.bodyScale ?? 1)
      : LINE_ASCENT_PAD * (layout?.bodyScale ?? 1)

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
 * 按所选纸张宽度离屏重绘简谱，并导出多页矢量 PDF。
 * @param {string} xmlString - MusicXML 字符串
 * @param {{ title?: string, lineBreak?: 'auto' | 'musicxml' | number | string, paperSize?: string, fontSize?: number, fixedDo?: boolean, transposeSemitones?: number, previewWindow?: Window | null }} [opts]
 */
export async function exportPdf(xmlString, opts = {}) {
  if (!xmlString || !String(xmlString).trim()) {
    throw new Error('没有可导出的谱面内容')
  }

  if (!isExportPaperSize(opts.paperSize)) {
    throw new Error('导出 PDF 请选择 A3 或 A4 纸张')
  }

  const pageLayout = getPageLayout(opts.paperSize)
  const { svgWidth, contentWMm, contentHMm, marginMm, format } = pageLayout

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${svgWidth}px`,
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
    const [{ jsPDF }, fontBinary] = await Promise.all([
      import('jspdf').then(async (mod) => {
        await import('svg2pdf.js')
        return mod
      }),
      loadChineseFontBinary(),
    ])
    await ensureScoreFont()

    const result = await initApp(svg, xmlString, {
      width: svgWidth,
      lineBreak: opts.lineBreak,
      fontSize: opts.fontSize,
      forceLight: true,
      fixedDo: !!opts.fixedDo,
      transposeSemitones: Number(opts.transposeSemitones) || 0,
    })
    if (!result) {
      throw new Error('谱面渲染失败，无法导出 PDF')
    }

    applySvgFontFamily(svg)

    const box = measureContentBox(svg, svgWidth)
    const pages = buildLineAwarePages(box, result.layout, pageLayout)
    if (!pages.length) {
      throw new Error('谱面高度无效，无法导出 PDF')
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format,
    })
    registerChineseFont(doc, fontBinary)

    // 固定纸张内容宽 1:1 映射，窄谱已在画布内居中，不再横向拉满
    const scale = contentWMm / svgWidth
    svg.setAttribute('width', String(svgWidth))
    svg.setAttribute('overflow', 'hidden')

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const slice = pages[pageIndex]
      if (pageIndex > 0) doc.addPage()

      svg.setAttribute('height', String(slice.height))
      svg.setAttribute(
        'viewBox',
        `${box.x} ${slice.y} ${svgWidth} ${slice.height}`
      )

      const drawH = Math.min(contentHMm, slice.height * scale)
      await doc.svg(svg, {
        x: marginMm,
        y: marginMm,
        width: contentWMm,
        height: drawH,
      })
    }

    const title = opts.title || result.title || ''
    const filename = `${sanitizeFilename(title)}.pdf`
    doc.setProperties({ title: sanitizeFilename(title) })
    await savePdfBlob(doc.output('blob'), filename, opts.previewWindow || null)
  } finally {
    host.remove()
  }
}
