import {
  SCORE_TITLE_EDGE_PAD,
  fitScoreTitle,
} from './fitScoreTitle.js'
import { SCORE_FONT_FAMILY } from './scoreFont.js'
import { clampScoreFontSize } from './scoreMetrics.js'
import { buildMusicXmlSchedule } from './musicXmlSchedule.js'

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

/** iOS 12 / Chrome 61 无 Element.replaceChildren */
export function clearElement(el) {
  if (!el) return
  if (typeof el.replaceChildren === 'function') {
    el.replaceChildren()
    return
  }
  while (el.firstChild) el.removeChild(el.firstChild)
}

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
/** OSMD 光标每一步的秒数（与简谱 onset 同一套变速） */
/** @type {number[]} */
let cursorSteps = []
/** OSMD 光标每一步的几何与小节信息 */
/** @type {Array<{ seconds: number, key: string, measureIndex: number, left: number, top: number, width: number, height: number }>} */
let cursorStepMeta = []
/** 五线谱每一拍的水平区间与纵向范围 */
/** @type {Array<{ measureIndex: number, startSec: number, endSec: number, x0: number, x1: number, top: number, height: number, systemIndex: number }>} */
let staffBeatSegments = []

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
    disableCursor: options.disableCursor !== false,
    followCursor: false,
    drawTitle: options.drawTitle !== false,
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
  // 播放时间线按小节顺序线性展开，光标也不能跟着反复记号/房子回跳
  rules.CursorIgnoreRepetitions = true
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
  fitOsmdSheetTitle(osmd, host)
}

function normalizeTitleText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function readFontSizePx(el) {
  const attr = parseFloat(el.getAttribute('font-size'))
  if (attr > 0) return attr
  if (typeof getComputedStyle !== 'function') return 0
  const computed = parseFloat(getComputedStyle(el).fontSize)
  return computed > 0 ? computed : 0
}

/** OSMD 曲名是左锚的单行 text；缩小后按原字宽中心放回 */
function fitOsmdTitleText(el, maxWidth) {
  const fontSize = readFontSizePx(el)
  const y = parseFloat(el.getAttribute('y'))
  const x = parseFloat(el.getAttribute('x'))
  if (!(fontSize > 0) || !Number.isFinite(y)) return
  const before = el.getComputedTextLength?.() || 0
  const fitted = fitScoreTitle(el, { fontSize, baseline: y, maxWidth })
  if (!(fitted.scale < 1)) return
  el.setAttribute('font-size', `${fitted.fontSize}px`)
  el.setAttribute('y', String(fitted.baseline))
  if (!Number.isFinite(x) || !(before > 0)) return
  const anchor = (el.getAttribute('text-anchor') || 'start').toLowerCase()
  if (anchor === 'middle') return
  const after = el.getComputedTextLength?.() || before * fitted.scale
  const center = anchor === 'end' ? x - before / 2 : x + before / 2
  const nextX = anchor === 'end' ? center + after / 2 : center - after / 2
  el.setAttribute('x', String(nextX))
}

/** 字宽和 viewBox 同一套用户单位；边距按显示宽度折回 8px */
function sheetTitleMaxWidth(svg) {
  const box = svg.viewBox && svg.viewBox.baseVal
  const userW =
    box && box.width > 0
      ? box.width
      : parseFloat(svg.getAttribute('width')) || svg.clientWidth || 0
  const cssW = parseFloat(svg.getAttribute('width')) || svg.clientWidth || userW
  if (!(userW > 0)) return 1
  const pad = cssW > 0 ? SCORE_TITLE_EDGE_PAD * (userW / cssW) : SCORE_TITLE_EDGE_PAD
  return Math.max(1, userW - 2 * pad)
}

function fitOsmdSheetTitle(osmd, host) {
  const title = normalizeTitleText(readSheetTitle(osmd))
  if (!title || !host) return
  host.querySelectorAll('svg').forEach((svg) => {
    const maxWidth = sheetTitleMaxWidth(svg)
    svg.querySelectorAll('text').forEach((el) => {
      if (normalizeTitleText(el.textContent) !== title) return
      fitOsmdTitleText(el, maxWidth)
    })
  })
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

function readXmlCreator(xml, type) {
  const re = new RegExp(
    `<creator\\b[^>]*\\btype\\s*=\\s*["']${type}["'][^>]*>([\\s\\S]*?)</creator>`,
    'i'
  )
  const match = String(xml || '').match(re)
  if (!match) return ''
  return match[1].replace(/\s+/g, ' ').trim()
}

/**
 * OSMD 把作词画在作曲同一行的左侧。没有作词时，用这一侧显示音色。
 */
function applyStaffInstrumentCredit(osmd, xmlString) {
  const sheet = osmd?.Sheet
  if (!sheet || readXmlCreator(xmlString, 'lyricist')) return
  const instrument = readXmlCreator(xmlString, 'instrument').replace(
    /^音色\s*[:：]\s*/,
    ''
  )
  if (!instrument || sheet.LyricistString === instrument) return
  sheet.LyricistString = instrument
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

/** 当前字号下最宽一行谱表的像素宽（含基础页边，不含为短谱居中而加的空白） */
export function measureStaffBodyWidth(osmd) {
  const zoom = Number(osmd?.zoom) || 1
  const pxPerUnit = zoom * OSMD_UNIT_PX_AT_ZOOM_1
  let maxSys = 0
  for (const sys of collectSystems(osmd)) {
    maxSys = Math.max(maxSys, systemWidth(sys))
  }
  if (maxSys <= 0 || pxPerUnit <= 0) return 0
  return Math.ceil((OSMD_PAGE_MARGIN * 2 + maxSys) * pxPerUnit)
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

function accentColor() {
  if (typeof document === 'undefined') return '#0a84ff'
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim()
  return value || '#0a84ff'
}

function dangerColor() {
  if (typeof document === 'undefined') return '#e03131'
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-danger')
    .trim()
  return value || '#e03131'
}

function timestampQuarters(iterator) {
  const frac = iterator?.currentTimeStamp ?? iterator?.CurrentTimeStamp
  const whole = Number(frac?.RealValue)
  return Number.isFinite(whole) ? whole * 4 : null
}

function iteratorMeasureIndex(iterator) {
  const idx = iterator?.currentMeasureIndex ?? iterator?.CurrentMeasureIndex
  return Number.isFinite(Number(idx)) ? Math.max(0, Math.trunc(Number(idx))) : 0
}

function findVisibleGraphicalMeasure(graphic, measureIndex) {
  if (!graphic) return null
  const nStaves = Number(graphic.NumberOfStaves ?? graphic.numberOfStaves) || 1
  if (typeof graphic.findGraphicalMeasure === 'function') {
    for (let s = 0; s < nStaves; s++) {
      const gm = graphic.findGraphicalMeasure(measureIndex, s)
      if (gm && (!gm.ParentStaff || gm.ParentStaff.isVisible?.() !== false)) {
        return gm
      }
    }
  }
  const row = (graphic.MeasureList || graphic.measureList)?.[measureIndex]
  if (Array.isArray(row)) {
    for (const gm of row) {
      if (gm) return gm
    }
  }
  return null
}

function systemVerticalSpanUnits(system) {
  const staffLines = system?.StaffLines || system?.staffLines || []
  const sysAbsY = Number(system?.PositionAndShape?.AbsolutePosition?.y)
  if (!staffLines.length || !Number.isFinite(sysAbsY)) return null
  const firstRelY = Number(staffLines[0]?.PositionAndShape?.RelativePosition?.y) || 0
  const topY = sysAbsY + firstRelY
  const last = staffLines[staffLines.length - 1]
  const lastRelY = Number(last?.PositionAndShape?.RelativePosition?.y) || 0
  const lastH = Number(last?.StaffHeight ?? last?.staffHeight) || 4
  const bottomY = sysAbsY + lastRelY + lastH
  return {
    topY,
    heightY: Math.max(4, bottomY - topY),
  }
}

function resolveIteratorStepGeometry(osmd, cursor, iterator, systemsList, pxPerUnit) {
  const graphic = osmd?.graphic || osmd?.GraphicSheet
  if (!graphic || !iterator) return null
  const measureIndex = iteratorMeasureIndex(iterator)
  let entries = []
  if (typeof iterator.CurrentVisibleVoiceEntries === 'function') {
    entries = iterator.CurrentVisibleVoiceEntries() || []
  } else if (Array.isArray(iterator.CurrentVoiceEntries)) {
    entries = iterator.CurrentVoiceEntries
  }
  const staffEntries = []
  for (const ve of entries) {
    if (!ve) continue
    let se = null
    if (typeof cursor?.getStaffEntryFromVoiceEntry === 'function') {
      try {
        se = cursor.getStaffEntryFromVoiceEntry(ve)
      } catch {
        se = null
      }
    }
    if (!se && typeof graphic.findGraphicalStaffEntryFromMeasureList === 'function') {
      const sse = ve.ParentSourceStaffEntry || ve.parentSourceStaffEntry
      const mListIdx = sse?.VerticalContainerParent?.ParentMeasure?.measureListIndex ?? measureIndex
      const staffId = sse?.ParentStaff?.idInMusicSheet ?? 0
      try {
        se = graphic.findGraphicalStaffEntryFromMeasureList(staffId, mListIdx, sse)
      } catch {
        se = null
      }
    }
    if (se) staffEntries.push(se)
  }

  let chosenEntry = null
  const reliable = staffEntries.filter((se) =>
    typeof graphic.isReliableCursorXAnchor === 'function'
      ? graphic.isReliableCursorXAnchor(se)
      : true
  )
  const pool = reliable.length ? reliable : staffEntries
  for (const se of pool) {
    const x = Number(se?.PositionAndShape?.AbsolutePosition?.x)
    if (!Number.isFinite(x)) continue
    if (!chosenEntry || x < Number(chosenEntry.PositionAndShape.AbsolutePosition.x)) {
      chosenEntry = se
    }
  }

  let xUnits = null
  let system = null
  if (chosenEntry) {
    xUnits = Number(chosenEntry.PositionAndShape.AbsolutePosition.x)
    system = chosenEntry.parentMeasure?.ParentMusicSystem || chosenEntry.parentMeasure?.parentMusicSystem
  } else if (
    typeof graphic.calculateXPositionFromTimestamp === 'function' &&
    (iterator.currentTimeStamp || iterator.CurrentTimeStamp)
  ) {
    try {
      const pair = graphic.calculateXPositionFromTimestamp(
        iterator.currentTimeStamp || iterator.CurrentTimeStamp
      )
      if (Array.isArray(pair) && Number.isFinite(Number(pair[0]))) {
        xUnits = Number(pair[0])
        system = pair[1] || null
      }
    } catch {
      /* fallback to measure */
    }
  }

  const gm = findVisibleGraphicalMeasure(graphic, measureIndex)
  if (!system && gm) {
    system = gm.ParentMusicSystem || gm.parentMusicSystem
  }
  if (!Number.isFinite(xUnits) && gm) {
    const mx = Number(gm.PositionAndShape?.AbsolutePosition?.x)
    const beginW = Number(gm.beginInstructionsWidth) || 0
    if (Number.isFinite(mx)) xUnits = mx + beginW
  }
  if (!Number.isFinite(xUnits) || !system) return null
  const vSpan = systemVerticalSpanUnits(system)
  if (!vSpan) return null
  const sysIdx = systemsList.indexOf(system)
  return {
    measureIndex,
    systemIndex: sysIdx >= 0 ? sysIdx : 0,
    anchorX: xUnits * pxPerUnit,
    left: (xUnits - 1.5) * pxPerUnit,
    top: vSpan.topY * pxPerUnit,
    width: 3 * pxPerUnit,
    height: vSpan.heightY * pxPerUnit,
  }
}

function iteratorMeasureStartQuarters(iterator) {
  const measure = iterator?.CurrentMeasure ?? iterator?.currentMeasure
  const ts = measure?.AbsoluteTimestamp ?? measure?.absoluteTimestamp
  const whole = Number(ts?.RealValue)
  return Number.isFinite(whole) ? whole * 4 : null
}

/**
 * 藏起光标按乐谱顺序走一遍 next()（不跟反复），提取每步所在小节、
 * 小节内偏移（四分音符数）与精确几何框。秒数由 expandCursorSteps 按演奏遍次换算。
 * @param {object} osmd
 */
function collectCursorSteps(osmd) {
  const cursor = osmd?.cursor
  const meta = []
  if (!cursor?.reset || !cursor.next) return meta
  const sheetRules = (osmd.Sheet || osmd.sheet)?.Rules
  if (sheetRules) sheetRules.CursorIgnoreRepetitions = true
  try {
    cursor.hide()
  } catch {
    return meta
  }
  cursor.reset()
  const iterator = cursor.Iterator || cursor.iterator
  if (!iterator) return meta
  const zoom = Number(osmd?.zoom) || 1
  const pxPerUnit = zoom * OSMD_UNIT_PX_AT_ZOOM_1
  const systemsList = collectSystems(osmd)
  let prevQuarter = -1
  let guard = 0
  /** 小节起点（四分音符），取不到 OSMD 的小节时间戳时用该小节第一步代替 */
  const measureStartQ = new Map()
  while (!iterator.EndReached && guard < 8000) {
    const quarters = timestampQuarters(iterator)
    if (quarters == null) break
    if (prevQuarter >= 0 && quarters < prevQuarter - 1e-4) break
    prevQuarter = quarters
    const geom = resolveIteratorStepGeometry(
      osmd,
      cursor,
      iterator,
      systemsList,
      pxPerUnit
    )
    const measureIndex = geom ? geom.measureIndex : iteratorMeasureIndex(iterator)
    if (!measureStartQ.has(measureIndex)) {
      measureStartQ.set(measureIndex, iteratorMeasureStartQuarters(iterator) ?? quarters)
    }
    meta.push({
      offsetQ: Math.max(0, quarters - measureStartQ.get(measureIndex)),
      measureIndex,
      systemIndex: geom ? geom.systemIndex : 0,
      anchorX: geom ? geom.anchorX : null,
      left: geom ? geom.left : null,
      top: geom ? geom.top : null,
      width: geom ? geom.width : 3 * pxPerUnit,
      height: geom ? geom.height : 4 * pxPerUnit,
    })
    cursor.next()
    guard++
    if (iterator.EndReached) break
    const nextQuarter = timestampQuarters(iterator)
    if (nextQuarter != null && Math.abs(nextQuarter - quarters) < 1e-6) break
  }
  cursor.reset()
  cursor.hide()
  return meta
}

/**
 * 按演奏遍次（含反复展开）把每小节的光标步换算成秒，按时间排好。
 * 每小节内速度不变，与 musicXmlSchedule 一致。
 * 秒数贴到日程里最近的音符 onset 上，key 才能和跟弹步骤对上。
 * @param {Array<{ offsetQ: number, measureIndex: number }>} rawMeta
 * @param {Array<{ measureIndex: number, startSec: number, endSec: number, bpm?: number }>} passes
 * @param {Array<{ time: number }>} [slots]
 */
function expandCursorSteps(rawMeta, passes, slots) {
  const onsets = [...new Set((slots || []).map((s) => s.time))].sort((a, b) => a - b)
  const snap = (sec) => {
    let lo = 0
    let hi = onsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (onsets[mid] < sec) lo = mid + 1
      else hi = mid
    }
    let best = sec
    for (const k of [lo - 1, lo]) {
      const t = onsets[k]
      if (t != null && Math.abs(t - sec) < 2e-3 && Math.abs(t - sec) < Math.abs(best - sec) + 1e-9) best = t
    }
    return best
  }
  const byMeasure = new Map()
  for (const item of rawMeta) {
    if (!byMeasure.has(item.measureIndex)) byMeasure.set(item.measureIndex, [])
    byMeasure.get(item.measureIndex).push(item)
  }
  const meta = []
  for (const pass of passes || []) {
    const list = byMeasure.get(pass.measureIndex)
    if (!list) continue
    const bpm = Number(pass.bpm) > 0 ? Number(pass.bpm) : 0
    for (const item of list) {
      const offsetSec = bpm ? (item.offsetQ * 60) / bpm : 0
      const sec = snap(pass.startSec + offsetSec)
      meta.push({ ...item, seconds: sec, key: sec.toFixed(4) })
    }
  }
  meta.sort((a, b) => a.seconds - b.seconds)
  return meta
}

function buildStaffBeatSegments(osmd, stepMeta, measureTimeline) {
  const segments = []
  if (!measureTimeline?.length) return segments
  let measureTotal = 0
  for (const m of measureTimeline) measureTotal = Math.max(measureTotal, m.measureIndex + 1)
  const graphic = osmd?.graphic || osmd?.GraphicSheet
  const zoom = Number(osmd?.zoom) || 1
  const pxPerUnit = zoom * OSMD_UNIT_PX_AT_ZOOM_1
  const overhangPx = Math.max(6, Math.round(9 * zoom))
  const systems = collectSystems(osmd)

  /** @type {Map<number, { systemIndex: number, leftPx: number, contentStartPx: number, rightPx: number, topPx: number, heightPx: number }>} */
  const measureBoxes = new Map()
  for (let j = 0; j < measureTotal; j++) {
    const gm = findVisibleGraphicalMeasure(graphic, j)
    if (!gm) continue
    const ps = gm.PositionAndShape || gm.positionAndShape
    const abs = ps?.AbsolutePosition || ps?.absolutePosition
    const size = ps?.Size || ps?.size
    const sys = gm.ParentMusicSystem || gm.parentMusicSystem
    const vSpan = systemVerticalSpanUnits(sys)
    const x = Number(abs?.x ?? abs?.X)
    const w =
      Number(size?.width ?? size?.Width) ||
      Number(ps?.BorderRight) - Number(ps?.BorderLeft) ||
      0
    if (!Number.isFinite(x) || !(w > 0) || !vSpan) continue
    const beginW = Math.max(0, Number(gm.beginInstructionsWidth) || 0)
    const endW = Math.max(0, Number(gm.endInstructionsWidth) || 0)
    const sysIdx = systems.indexOf(sys)
    measureBoxes.set(j, {
      systemIndex: sysIdx >= 0 ? sysIdx : 0,
      leftPx: x * pxPerUnit,
      contentStartPx: (x + beginW) * pxPerUnit,
      rightPx: Math.max(x + beginW, x + w - endW) * pxPerUnit,
      topPx: vSpan.topY * pxPerUnit,
      heightPx: vSpan.heightY * pxPerUnit,
    })
  }

  const stepsByMeasure = new Map()
  for (const item of stepMeta || []) {
    if (!Number.isFinite(item?.anchorX)) continue
    if (!stepsByMeasure.has(item.measureIndex)) {
      stepsByMeasure.set(item.measureIndex, [])
    }
    stepsByMeasure.get(item.measureIndex).push(item)
  }

  /** 每小节的几何只算一次，反复的各遍共用 */
  const geomCache = new Map()
  const measureGeom = (j) => {
    if (geomCache.has(j)) return geomCache.get(j)
    const geom = computeMeasureGeom(j)
    geomCache.set(j, geom)
    return geom
  }
  const computeMeasureGeom = (j) => {
    const mSteps = stepsByMeasure.get(j) || []
    const mBox = measureBoxes.get(j)
    const firstStep = mSteps[0]
    const lastStep = mSteps[mSteps.length - 1]
    if (!mBox && !firstStep) return null

    const baseTop = mBox ? mBox.topPx : firstStep.top
    const baseHeight = mBox ? mBox.heightPx : firstStep.height
    const top = baseTop - overhangPx
    const height = baseHeight + overhangPx * 2
    const systemIndex = mBox ? mBox.systemIndex : firstStep.systemIndex

    const startX = firstStep
      ? firstStep.anchorX
      : mBox.contentStartPx
    let endX = mBox ? mBox.rightPx : startX + 80 * zoom
    const nextBox = measureBoxes.get(j + 1)
    const nextFirstStep = (stepsByMeasure.get(j + 1) || [])[0]
    if (
      nextBox &&
      nextBox.systemIndex === systemIndex &&
      nextFirstStep &&
      nextFirstStep.anchorX > startX &&
      nextBox.contentStartPx - nextBox.leftPx <= 2 * pxPerUnit
    ) {
      endX = nextFirstStep.anchorX
    } else if (lastStep && lastStep.anchorX + 1.5 * pxPerUnit > endX) {
      endX = lastStep.anchorX + 1.5 * pxPerUnit
    }
    return { mSteps, startX, endX, top, height, systemIndex }
  }

  for (const mTime of measureTimeline) {
    if (!mTime || !(mTime.endSec > mTime.startSec)) continue
    const j = mTime.measureIndex
    const geom = measureGeom(j)
    if (!geom) continue
    const { mSteps, startX, endX, top, height, systemIndex } = geom
    const bpm = Number(mTime.bpm) > 0 ? Number(mTime.bpm) : 0
    const beatsCount = Math.max(1, Math.round(Number(mTime.beats) || 1))
    const beatSec = (mTime.endSec - mTime.startSec) / beatsCount
    const anchors = [[mTime.startSec, startX]]
    for (const s of mSteps) {
      const sx = s.anchorX
      const sec = mTime.startSec + (bpm ? (s.offsetQ * 60) / bpm : 0)
      if (sec > anchors[anchors.length - 1][0] + 1e-4) {
        anchors.push([sec, sx])
      } else {
        anchors[anchors.length - 1][1] = sx
      }
    }
    anchors.push([mTime.endSec, Math.max(anchors[anchors.length - 1][1], endX)])

    const interpX = (sec) => {
      if (sec <= anchors[0][0]) return anchors[0][1]
      for (let k = 0; k < anchors.length - 1; k++) {
        const [t0, x0] = anchors[k]
        const [t1, x1] = anchors[k + 1]
        if (sec <= t1 + 1e-6) {
          if (t1 <= t0 + 1e-6) return x0
          const r = Math.max(0, Math.min(1, (sec - t0) / (t1 - t0)))
          return x0 + (x1 - x0) * r
        }
      }
      return anchors[anchors.length - 1][1]
    }

    for (let b = 0; b < beatsCount; b++) {
      const bStart = mTime.startSec + b * beatSec
      const bEnd = b === beatsCount - 1 ? mTime.endSec : mTime.startSec + (b + 1) * beatSec
      const x0 = interpX(bStart)
      const x1 = interpX(bEnd)
      segments.push({
        measureIndex: j,
        startSec: bStart,
        endSec: bEnd,
        x0,
        x1: Math.max(x0, x1),
        top,
        height,
        systemIndex,
      })
    }
  }
  return segments
}

function applyCursorStyle(osmd, isDanger = false) {
  const cursor = osmd?.cursor
  if (!cursor) return
  const color = isDanger ? dangerColor() : accentColor()
  const prev = cursor.CursorOptions
  if (
    prev &&
    prev.type === 0 &&
    prev.color === color &&
    prev.alpha === 0.35 &&
    prev.follow === false
  ) {
    return
  }
  cursor.CursorOptions = {
    type: 0,
    color,
    alpha: 0.35,
    follow: false,
  }
  if (osmd.FollowCursor) osmd.FollowCursor = false
  const el = cursor.cursorElement
  if (el) el.style.pointerEvents = 'none'
}

function ensureStaffOverlays(container) {
  if (!container) return
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative'
  }
  let errLayer = container.querySelector('.staff-error-layer')
  if (!errLayer) {
    errLayer = document.createElement('div')
    errLayer.className = 'staff-error-layer'
    // iOS 12 不支持 inset；只贴四边时高度不成立，再写宽高
    Object.assign(errLayer.style, {
      position: 'absolute',
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '1',
    })
    container.appendChild(errLayer)
  }
  let beatLine = container.querySelector('.staff-beat-line')
  if (!beatLine) {
    beatLine = document.createElement('div')
    beatLine.className = 'staff-beat-line'
    Object.assign(beatLine.style, {
      position: 'absolute',
      width: '2px',
      marginLeft: '-1px',
      borderRadius: '1px',
      background: 'var(--color-accent)',
      pointerEvents: 'none',
      zIndex: '2',
      display: 'none',
    })
    container.appendChild(beatLine)
  }
}

function prepareStaffCursor(osmd, xmlString) {
  cursorSteps = []
  cursorStepMeta = []
  staffBeatSegments = []
  if (!osmd?.cursor) return
  applyCursorStyle(osmd, false)
  let schedule = null
  try {
    schedule = buildMusicXmlSchedule(xmlString)
  } catch {
    schedule = null
  }
  const passes = schedule?.measures || []
  const rawMeta = collectCursorSteps(osmd)
  cursorStepMeta = expandCursorSteps(rawMeta, passes, schedule?.slots)
  cursorSteps = cursorStepMeta.map((m) => m.seconds)
  staffBeatSegments = buildStaffBeatSegments(osmd, rawMeta, passes)
  ensureStaffOverlays(previewContainer)
}

function appendStaffPlayhead(layer, meta, active, failed) {
  if (!meta || !Number.isFinite(meta.left) || !Number.isFinite(meta.top)) return
  const box = document.createElement('div')
  box.className = active ? 'staff-playhead' : 'staff-error-playhead'
  if (active) box.setAttribute('data-active', 'true')
  Object.assign(box.style, {
    position: 'absolute',
    left: `${meta.left.toFixed(2)}px`,
    top: `${meta.top.toFixed(2)}px`,
    width: `${Math.max(4, meta.width).toFixed(2)}px`,
    height: `${Math.max(8, meta.height).toFixed(2)}px`,
    background: failed ? 'var(--color-danger)' : 'var(--color-accent)',
    opacity: '0.35',
    borderRadius: '2px',
    pointerEvents: 'none',
  })
  layer.appendChild(box)
}

function syncStaffErrorMarkers(visible, failedKeys, currentTargetIndex) {
  const container = previewContainer
  if (!container) return
  ensureStaffOverlays(container)
  const layer = container.querySelector('.staff-error-layer')
  if (!layer) return
  clearElement(layer)
  if (!visible) return
  const failed = failedKeys instanceof Set ? failedKeys : null
  if (failed) {
    for (let i = 0; i < cursorStepMeta.length; i++) {
      if (i === currentTargetIndex) continue
      const meta = cursorStepMeta[i]
      if (!meta || !failed.has(meta.key)) continue
      appendStaffPlayhead(layer, meta, false, true)
    }
  }
  if (currentTargetIndex >= 0) {
    const current = cursorStepMeta[currentTargetIndex]
    const currentFailed = !!(failed && current && failed.has(current.key))
    appendStaffPlayhead(layer, current, true, currentFailed)
  }
}

/**
 * 按秒数点亮当前步。高亮是色块，OSMD 光标图片保持隐藏。
 * @param {number} seconds
 * @param {boolean} visible
 * @param {Set<string> | null | undefined} [failedKeys]
 */
export function syncStaffCursor(seconds, visible, failedKeys) {
  const cursor = previewOsmd?.cursor
  if (cursor && !cursor.Hidden) cursor.hide()
  const failed = failedKeys instanceof Set ? failedKeys : null
  if (!visible || !cursorSteps.length) {
    syncStaffErrorMarkers(false, null, -1)
    return
  }
  let target = -1
  const now = Number(seconds) || 0
  for (let i = 0; i < cursorSteps.length; i++) {
    if (cursorSteps[i] <= now + 1e-3) target = i
    else break
  }
  if (target < 0) {
    syncStaffErrorMarkers(false, null, -1)
    return
  }
  syncStaffErrorMarkers(visible, failed, target)
}

/**
 * 同步五线谱竖直指示线：在每一拍起止时间内匀速滑过该拍宽度，换行时跳到下一系统起点。
 * @param {number} seconds
 * @param {boolean} visible
 */
export function syncStaffBeatLine(seconds, visible) {
  const container = previewContainer
  if (!container) return
  const line = container.querySelector('.staff-beat-line')
  if (!line) return
  if (!visible || !staffBeatSegments.length) {
    if (line.style.display !== 'none') line.style.display = 'none'
    line.removeAttribute('data-active')
    return
  }
  const now = Math.max(0, Number(seconds) || 0)
  let seg = staffBeatSegments[staffBeatSegments.length - 1]
  for (let i = 0; i < staffBeatSegments.length; i++) {
    const item = staffBeatSegments[i]
    if (now < item.endSec - 1e-6 || i === staffBeatSegments.length - 1) {
      seg = item
      break
    }
  }
  const dur = Math.max(1e-6, seg.endSec - seg.startSec)
  const ratio = Math.max(0, Math.min(1, (now - seg.startSec) / dur))
  const x = seg.x0 + (seg.x1 - seg.x0) * ratio
  line.style.left = `${x.toFixed(2)}px`
  line.style.top = `${seg.top.toFixed(2)}px`
  line.style.height = `${Math.max(12, seg.height).toFixed(2)}px`
  if (line.style.display !== 'block') line.style.display = 'block'
  line.setAttribute('data-active', 'true')
}

/**
 * 屏幕预览：复用同一 OSMD 实例。
 * @param {HTMLElement} container
 * @param {string} xmlString
 * @param {object} options
 */
export async function renderStaffPreview(container, xmlString, options = {}) {
  const api = await loadOsmdApi()
  const previewOptions = { ...options, disableCursor: false, followCursor: false }
  if (previewOsmd && previewContainer !== container) {
    destroyOsmd(previewOsmd)
    previewOsmd = null
    previewXml = ''
    cursorSteps = []
    cursorStepMeta = []
    staffBeatSegments = []
  }
  if (!previewOsmd) {
    clearElement(container)
    previewOsmd = createOsmd(api, container, previewOptions)
    previewContainer = container
    previewXml = ''
  }
  if (previewXml !== xmlString || !previewOsmd.Sheet) {
    await previewOsmd.load(xmlString)
    previewXml = xmlString
  }
  applyOsmdOptions(previewOsmd, previewOptions)
  applyStaffInstrumentCredit(previewOsmd, xmlString)
  applyTranspose(previewOsmd, previewOptions.transposeSemitones)
  renderOsmdCentered(previewOsmd, container)
  prepareStaffCursor(previewOsmd, xmlString)
  const size = measureOsmdSize(container)
  return {
    xmlString,
    title: readSheetTitle(previewOsmd),
    size,
    bodyWidth: measureStaffBodyWidth(previewOsmd) || size.width,
  }
}

export function destroyStaffPreview() {
  if (previewOsmd) destroyOsmd(previewOsmd)
  previewOsmd = null
  previewContainer = null
  previewXml = ''
  cursorSteps = []
  cursorStepMeta = []
  staffBeatSegments = []
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
    applyStaffInstrumentCredit(osmd, xmlString)
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
