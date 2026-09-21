import { SCORE_FONT_FAMILY } from './scoreFont.js'
import { clampScoreFontSize } from './scoreMetrics.js'

/** OSMD：1 单位 = 五线间距 = zoom 1 时 10px */
const OSMD_UNIT_PX_AT_ZOOM_1 = 10
/** EngravingRules.LyricsHeight 默认 2.0 */
const OSMD_LYRICS_HEIGHT = 2
/** EngravingRules.PageLeftMargin / PageRightMargin 默认 5.0 */
const OSMD_PAGE_MARGIN = 5
/** 短于版心超过该值（OSMD 单位）才补边距居中，避免满宽谱被微调 */
const OSMD_CENTER_EPS = 4

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
  const px = clampScoreFontSize(fontSize)
  return px / (OSMD_LYRICS_HEIGHT * OSMD_UNIT_PX_AT_ZOOM_1)
}

export function osmdPageFormat(paperSize) {
  return paperSize === 'a3' ? 'A3_P' : 'A4_P'
}

function measuresPerLine(lineBreak) {
  if (lineBreak === 'auto' || lineBreak === 'musicxml' || !lineBreak) return 0
  const n = Number(lineBreak)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 与简谱 scoreInk 相同：--color-text-primary */
function scoreInk(fallback = '#1C1C1E') {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-text-primary')
    .trim()
  return value || fallback
}

function baseOptions(options) {
  const ink = options.inkColor || scoreInk()
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
    // 不用 OSMD darkMode（纯白符+纯黑纸）；墨色对齐简谱 token
    darkMode: false,
    defaultColorMusic: ink,
    defaultColorLabel: ink,
    defaultColorTitle: ink,
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
  rules.PageBackgroundColor = undefined
  if ('InstantaneousTempoTextHeight' in rules) {
    rules.InstantaneousTempoTextHeight = OSMD_LYRICS_HEIGHT
  }
  rules.PageLeftMargin = OSMD_PAGE_MARGIN
  rules.PageRightMargin = OSMD_PAGE_MARGIN
  if ('pageLeftMargin' in rules) rules.pageLeftMargin = OSMD_PAGE_MARGIN
  if ('pageRightMargin' in rules) rules.pageRightMargin = OSMD_PAGE_MARGIN
  osmd.zoom = fontSizeToOsmdZoom(options.fontSize)
}

function graphicPages(osmd) {
  const sheet = osmd?.graphic || osmd?.GraphicSheet
  return sheet?.MusicPages || sheet?.musicPages || []
}

function pageSystems(page) {
  return page?.MusicSystems || page?.musicSystems || []
}

function systemWidth(system) {
  const ps = system?.PositionAndShape || system?.positionAndShape
  if (!ps) return 0
  const size = ps.Size || ps.size
  const w = Number(size?.width) || Number(size?.Width) || 0
  if (w > 0) return w
  const borderLeft = Number(ps.BorderLeft) || 0
  const borderRight = Number(ps.BorderRight) || 0
  return Math.max(0, borderRight - borderLeft)
}

function systemMeasureCount(system) {
  const gm = system?.GraphicalMeasures || system?.graphicalMeasures || []
  return gm.length
}

function collectSystems(osmd) {
  const list = []
  for (const page of graphicPages(osmd)) {
    for (const sys of pageSystems(page)) list.push(sys)
  }
  return list
}

/**
 * 短谱：用末行自然宽估算正文宽并左右补边距。
 * 末行明显更短则视为长谱余行，保持满宽、末行左对齐。
 */
function readRule(rules, ...names) {
  for (const name of names) {
    const value = rules?.[name]
    if (value != null && value !== '') return value
  }
  return undefined
}

function writeRule(rules, value, ...names) {
  for (const name of names) {
    if (name in rules || rules[name] != null) rules[name] = value
  }
  if (!(names[0] in rules) && rules[names[0]] == null) {
    rules[names[0]] = value
  }
}

function readPageWidthUnits(osmd, rules, host) {
  const fromRules = Number(readRule(rules, 'PageWidth', 'pageWidth'))
  if (Number.isFinite(fromRules) && fromRules > 0) return fromRules
  const root = host || osmd?.container
  const svg = root?.querySelector?.('svg')
  if (svg) {
    const vb = String(svg.getAttribute('viewBox') || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (vb.length === 4 && vb[2] > 0) return vb[2] / OSMD_UNIT_PX_AT_ZOOM_1
    const w = Number(svg.getAttribute('width'))
    const zoom = Number(osmd.zoom) || 1
    if (w > 0 && zoom > 0) return w / (zoom * OSMD_UNIT_PX_AT_ZOOM_1)
  }
  const hostW = Number(root?.clientWidth) || 0
  const zoom = Number(osmd.zoom) || 1
  if (hostW > 0 && zoom > 0) return hostW / (zoom * OSMD_UNIT_PX_AT_ZOOM_1)
  return 0
}

function centerShortStaffSystems(osmd, host) {
  const rules = osmd?.EngravingRules
  if (!rules) return false
  const pageWidth = readPageWidthUnits(osmd, rules, host)
  const left = Number(readRule(rules, 'PageLeftMargin', 'pageLeftMargin'))
  const right = Number(readRule(rules, 'PageRightMargin', 'pageRightMargin'))
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return false
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  const innerW = pageWidth - left - right
  if (innerW <= 0) return false

  const systems = collectSystems(osmd)
  if (!systems.length) return false

  let maxN = 0
  for (const sys of systems) {
    maxN = Math.max(maxN, systemMeasureCount(sys))
  }
  const last = systems[systems.length - 1]
  const lastW = systemWidth(last)
  const lastN = Math.max(1, systemMeasureCount(last))
  const firstN = Math.max(1, systemMeasureCount(systems[0]))
  if (lastW <= 0) return false
  if (systems.length > 1 && lastN < firstN * 0.75) return false

  const naturalLineW = lastW * (maxN / lastN)
  const leftover = innerW - naturalLineW
  if (leftover < OSMD_CENTER_EPS) return false
  const shift = leftover / 2
  writeRule(rules, left + shift, 'PageLeftMargin', 'pageLeftMargin')
  writeRule(rules, right + shift, 'PageRightMargin', 'pageRightMargin')
  return true
}

function renderOsmdCentered(osmd, host) {
  osmd.render()
  if (centerShortStaffSystems(osmd, host)) osmd.render()
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
  renderOsmdCentered(previewOsmd, container)
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
    renderOsmdCentered(osmd, host)
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
