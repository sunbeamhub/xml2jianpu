import { SCORE_FONT_FAMILY } from './scoreFont.js'
import { SCORE_FONT_SIZE_DEFAULT, clampScoreFontSize } from './scoreMetrics.js'

export const NOTATION_JIANPU = 'jianpu'
export const NOTATION_STAFF = 'staff'
export const NOTATION_MODES = [NOTATION_JIANPU, NOTATION_STAFF]

/** @type {null | { OpenSheetMusicDisplay: Function, TransposeCalculator?: Function }} */
let osmdApi = null
/** @type {null | object} */
let previewOsmd = null
/** @type {null | HTMLElement} */
let previewContainer = null
/** @type {string} */
let previewXml = ''
/** @type {Promise<void> | null} */
let osmdScriptPromise = null

function readWindowOsmd() {
  if (typeof window === 'undefined') return null
  const lib = window.opensheetmusicdisplay
  if (!lib || typeof lib.OpenSheetMusicDisplay !== 'function') return null
  return {
    OpenSheetMusicDisplay: lib.OpenSheetMusicDisplay,
    TransposeCalculator: lib.TransposeCalculator,
  }
}

function loadOsmdScript(url) {
  if (osmdScriptPromise) return osmdScriptPromise
  osmdScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-osmd="true"]')
    if (existing) {
      if (window.opensheetmusicdisplay?.OpenSheetMusicDisplay) {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () =>
        reject(new Error('无法加载 OpenSheetMusicDisplay'))
      )
      return
    }
    const el = document.createElement('script')
    el.src = url
    el.async = true
    el.dataset.osmd = 'true'
    el.onload = () => resolve()
    el.onerror = () => {
      osmdScriptPromise = null
      reject(new Error('无法加载 OpenSheetMusicDisplay'))
    }
    document.head.appendChild(el)
  })
  return osmdScriptPromise
}

async function loadOsmdApi() {
  if (osmdApi) return osmdApi
  const fromWindow = readWindowOsmd()
  if (fromWindow) {
    osmdApi = fromWindow
    return osmdApi
  }
  // webpack UMD 在 ESM import 里 this 为 undefined；按经典脚本挂到 window
  const urlMod = await import(
    'opensheetmusicdisplay/build/opensheetmusicdisplay.min.js?url'
  )
  await loadOsmdScript(urlMod.default)
  const loaded = readWindowOsmd()
  if (!loaded) {
    throw new Error('无法加载 OpenSheetMusicDisplay')
  }
  osmdApi = loaded
  return osmdApi
}

export function fontSizeToOsmdZoom(fontSize) {
  return clampScoreFontSize(fontSize) / SCORE_FONT_SIZE_DEFAULT
}

export function osmdPageFormat(paperSize) {
  return paperSize === 'a3' ? 'A3_P' : 'A4_P'
}

function measuresPerLine(lineBreak) {
  if (lineBreak === 'auto' || lineBreak === 'musicxml' || !lineBreak) return 0
  const n = Number(lineBreak)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function baseOptions(options) {
  return {
    autoResize: false,
    backend: 'svg',
    disableCursor: true,
    drawTitle: options.drawTitle === true,
    drawSubtitle: false,
    drawComposer: options.drawComposer !== false,
    drawLyricist: options.drawLyricist !== false,
    drawPartNames: false,
    drawPartAbbreviations: false,
    darkMode: !!options.darkMode,
    newSystemFromXML: options.lineBreak === 'musicxml',
    pageFormat: options.pageFormat || 'Endless',
    defaultFontFamily: SCORE_FONT_FAMILY,
  }
}

function applyEngraving(osmd, options) {
  const rules = osmd.EngravingRules
  if (!rules) return
  rules.RenderXMeasuresPerLineAkaSystem = measuresPerLine(options.lineBreak)
  if ('DisableWebGLInSafariAndIOS' in rules) {
    rules.DisableWebGLInSafariAndIOS = true
  }
  osmd.zoom = fontSizeToOsmdZoom(options.fontSize)
}

function applyOsmdOptions(osmd, options) {
  osmd.setOptions(baseOptions(options))
  applyEngraving(osmd, options)
}

function applyTranspose(osmd, semitones) {
  const n = Number(semitones) || 0
  if (!osmd.Sheet) return
  osmd.Sheet.Transpose = n
  if (osmd.graphic && typeof osmd.updateGraphic === 'function') {
    try {
      osmd.updateGraphic()
    } catch {
      /* 首次绘制尚无 graphic */
    }
  }
}

function createOsmd(api, container, options) {
  const osmd = new api.OpenSheetMusicDisplay(container, baseOptions(options))
  if (api.TransposeCalculator) {
    osmd.TransposeCalculator = new api.TransposeCalculator()
  }
  applyEngraving(osmd, options)
  return osmd
}

function readSheetTitle(osmd) {
  const sheet = osmd?.Sheet
  if (!sheet) return ''
  if (typeof sheet.TitleString === 'string' && sheet.TitleString.trim()) {
    return sheet.TitleString.trim()
  }
  const title = sheet.Title
  if (typeof title === 'string' && title.trim()) return title.trim()
  if (title && typeof title.text === 'string' && title.text.trim()) {
    return title.text.trim()
  }
  return ''
}

export function measureOsmdSize(container) {
  if (!container) return { width: 1, height: 1 }
  const svgs = container.querySelectorAll('svg')
  let width = Number(container.style.width) || container.clientWidth || 1
  let height = 0
  svgs.forEach((svg) => {
    const sw = Number(svg.getAttribute('width')) || svg.clientWidth || 0
    const sh = Number(svg.getAttribute('height')) || svg.clientHeight || 0
    if (sw > width) width = sw
    height += sh
  })
  if (height < 1) {
    height = Math.max(container.scrollHeight, container.offsetHeight, 1)
  }
  return {
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
  }
}

/**
 * MusicXML 字符串或以 < 开头以外的内容视为可 fetch 的 URL。
 * @param {string} source
 * @returns {Promise<string>}
 */
export async function resolveMusicXml(source) {
  const raw = String(source || '')
  const s = raw.trim()
  if (!s) throw new Error('MusicXML 内容为空')
  if (s.startsWith('<') || s.startsWith('<?')) return raw
  const res = await fetch(source)
  if (!res.ok) {
    throw new Error(`无法加载 MusicXML (${res.status})`)
  }
  return res.text()
}

/**
 * 屏幕预览：复用同一 OSMD 实例。
 * @param {HTMLElement} container
 * @param {string} xmlString
 * @param {object} options
 */
export async function renderStaffPreview(container, xmlString, options = {}) {
  const api = await loadOsmdApi()
  if (previewOsmd && previewContainer !== container) {
    destroyOsmd(previewOsmd)
    previewOsmd = null
    previewXml = ''
  }
  if (!previewOsmd) {
    container.replaceChildren()
    previewOsmd = createOsmd(api, container, options)
    previewContainer = container
    previewXml = ''
  }
  if (previewXml !== xmlString || !previewOsmd.Sheet) {
    await previewOsmd.load(xmlString)
    previewXml = xmlString
  }
  applyOsmdOptions(previewOsmd, options)
  applyTranspose(previewOsmd, options.transposeSemitones)
  previewOsmd.render()
  return {
    xmlString,
    title: readSheetTitle(previewOsmd),
    size: measureOsmdSize(container),
  }
}

export function destroyStaffPreview() {
  if (previewOsmd) destroyOsmd(previewOsmd)
  previewOsmd = null
  previewContainer = null
  previewXml = ''
}

function destroyOsmd(osmd) {
  try {
    if (typeof osmd.clear === 'function') osmd.clear()
  } catch {
    /* ignore */
  }
}

/**
 * 离屏分页渲染（导出 PDF）。用完后移除 host。
 * @param {string} xmlString
 * @param {object} options
 * @param {(svgs: SVGSVGElement[]) => Promise<T>} callback
 * @returns {Promise<T>}
 * @template T
 */
export async function withStaffExport(xmlString, options, callback) {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  const widthPx = Math.max(1, Number(options.width) || 800)
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${widthPx}px`,
    height: 'auto',
    overflow: 'visible',
    pointerEvents: 'none',
    opacity: '0',
  })
  document.body.appendChild(host)
  const api = await loadOsmdApi()
  const osmd = createOsmd(api, host, options)
  try {
    await osmd.load(xmlString)
    applyTranspose(osmd, options.transposeSemitones)
    osmd.render()
    const svgs = [...host.querySelectorAll('svg')]
    if (!svgs.length) {
      throw new Error('五线谱渲染失败，无法导出 PDF')
    }
    return await callback(svgs)
  } finally {
    destroyOsmd(osmd)
    host.remove()
  }
}
