import { NOTATION_JIANPU, NOTATION_MODES } from "./osmdRenderer.js";
import {
  SCORE_FONT_SIZE_DEFAULT,
  clampScoreFontSize,
} from "./scoreMetrics.js";
import {
  DEFAULT_PAPER_SIZE,
  DISPLAY_SIZES,
} from "./pageLayout.js";
import { examples, defaultExampleId } from "./scoreCatalog.js";
import { isTauri } from "./platform.js";

const SELECTED_EXAMPLE_KEY = 'xml2jianpu:selectedExample'
const UPLOAD_DIR_KEY = 'xml2jianpu:uploadDir'
const LINE_BREAK_KEY = 'xml2jianpu:lineBreak'
export const LINE_BREAK_VALUES = ['auto', 'musicxml', '2', '3', '4', '5', '6']
const PAPER_SIZE_KEY = 'xml2jianpu:paperSize'
export const PAPER_SIZE_VALUES = Object.keys(DISPLAY_SIZES)
const SCORE_FONT_SIZE_KEY = 'xml2jianpu:scoreFontSize'
const NOTATION_MODE_KEY = 'xml2jianpu:notationMode'
const MIDI_OUTPUT_NAME_KEY = 'xml2jianpu:midiOutputName'
const FOLLOW_RHYTHM_KEY = 'xml2jianpu:followRhythm'
const FOLLOW_RHYTHM_TOLERANCE_KEY = 'xml2jianpu:followRhythmTolerance'
const DURATION_HUD_POS_KEY = 'xml2jianpu:durationHudPos'
const DURATION_HUD_STYLE_KEY = 'xml2jianpu:durationHudStyle'

export const DURATION_HUD_STYLES = [
  { value: 'line', label: '线段' },
  { value: 'arc', label: '半圆' },
]
const DURATION_HUD_STYLE_VALUES = DURATION_HUD_STYLES.map((item) => item.value)

export const FOLLOW_RHYTHM_TOLERANCES = [
  { value: 'loose', label: '宽松', percent: 30 },
  { value: 'standard', label: '标准', percent: 16 },
  { value: 'strict', label: '严格', percent: 8 },
]
const FOLLOW_RHYTHM_TOLERANCE_VALUES = FOLLOW_RHYTHM_TOLERANCES.map((item) => item.value)

function isLibraryScoreId(id) {
  if (typeof id !== 'string' || !id) return false
  if (id.includes('\\') || id.startsWith('/')) return false
  const parts = id.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return false
  return /\.(musicxml|xml)$/i.test(id)
}

export function readStoredExampleId() {
  try {
    const id = localStorage.getItem(SELECTED_EXAMPLE_KEY)
    if (isTauri()) {
      if (id && isLibraryScoreId(id)) return id
      if (id && examples.some((e) => e.id === id)) return `${id}.musicxml`
      return ''
    }
    if (id && examples.some((e) => e.id === id)) return id
  } catch {
    /* private mode / unavailable */
  }
  return defaultExampleId
}

export function persistSelectedExample(id) {
  try {
    if (!id) localStorage.removeItem(SELECTED_EXAMPLE_KEY)
    else localStorage.setItem(SELECTED_EXAMPLE_KEY, id)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredLineBreak() {
  try {
    const value = localStorage.getItem(LINE_BREAK_KEY)
    if (value && LINE_BREAK_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return 'auto'
}

export function persistLineBreak(value) {
  if (!LINE_BREAK_VALUES.includes(value)) return
  try {
    localStorage.setItem(LINE_BREAK_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredPaperSize() {
  try {
    const value = localStorage.getItem(PAPER_SIZE_KEY)
    if (value && PAPER_SIZE_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return DEFAULT_PAPER_SIZE
}

export function persistPaperSize(value) {
  if (!PAPER_SIZE_VALUES.includes(value)) return
  try {
    localStorage.setItem(PAPER_SIZE_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredScoreFontSize() {
  try {
    const raw = localStorage.getItem(SCORE_FONT_SIZE_KEY)
    if (raw == null || raw === '') return SCORE_FONT_SIZE_DEFAULT
    return clampScoreFontSize(raw)
  } catch {
    /* private mode / unavailable */
  }
  return SCORE_FONT_SIZE_DEFAULT
}

export function persistScoreFontSize(value) {
  try {
    localStorage.setItem(SCORE_FONT_SIZE_KEY, String(clampScoreFontSize(value)))
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredNotationMode() {
  try {
    const value = localStorage.getItem(NOTATION_MODE_KEY)
    if (value && NOTATION_MODES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return NOTATION_JIANPU
}

function isSafeUploadDir(id) {
  if (typeof id !== 'string') return false
  if (!id) return true
  if (id.includes('\\') || id.startsWith('/')) return false
  return id.split('/').every((part) => part && part !== '.' && part !== '..')
}

export function readStoredUploadDir() {
  try {
    const id = localStorage.getItem(UPLOAD_DIR_KEY)
    if (id != null && isSafeUploadDir(id)) return id
  } catch {
    /* private mode / unavailable */
  }
  return ''
}

export function persistUploadDir(value) {
  const dir = value || ''
  if (!isSafeUploadDir(dir)) return
  try {
    localStorage.setItem(UPLOAD_DIR_KEY, dir)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredMidiOutputName() {
  try {
    const name = localStorage.getItem(MIDI_OUTPUT_NAME_KEY)
    if (typeof name === 'string' && name && name.length <= 200) return name
  } catch {
    /* private mode / unavailable */
  }
  return ''
}

export function persistMidiOutputName(name) {
  try {
    if (!name) localStorage.removeItem(MIDI_OUTPUT_NAME_KEY)
    else localStorage.setItem(MIDI_OUTPUT_NAME_KEY, String(name).slice(0, 200))
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredFollowRhythm() {
  try {
    return localStorage.getItem(FOLLOW_RHYTHM_KEY) === '1'
  } catch {
    /* private mode / unavailable */
  }
  return false
}

export function persistFollowRhythm(on) {
  try {
    localStorage.setItem(FOLLOW_RHYTHM_KEY, on ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredFollowRhythmTolerance() {
  try {
    const value = localStorage.getItem(FOLLOW_RHYTHM_TOLERANCE_KEY)
    if (value && FOLLOW_RHYTHM_TOLERANCE_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return 'standard'
}

export function persistFollowRhythmTolerance(value) {
  if (!FOLLOW_RHYTHM_TOLERANCE_VALUES.includes(value)) return
  try {
    localStorage.setItem(FOLLOW_RHYTHM_TOLERANCE_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredDurationHudStyle() {
  try {
    const value = localStorage.getItem(DURATION_HUD_STYLE_KEY)
    if (value && DURATION_HUD_STYLE_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return 'arc'
}

export function persistDurationHudStyle(value) {
  if (!DURATION_HUD_STYLE_VALUES.includes(value)) return
  try {
    localStorage.setItem(DURATION_HUD_STYLE_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredDurationHudPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(DURATION_HUD_POS_KEY) || 'null')
    const x = Number(raw?.x)
    const y = Number(raw?.y)
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
  } catch {
    /* private mode / unavailable */
  }
  return null
}

export function persistDurationHudPos(pos) {
  try {
    if (!pos) localStorage.removeItem(DURATION_HUD_POS_KEY)
    else localStorage.setItem(DURATION_HUD_POS_KEY, JSON.stringify({
      x: Math.round(pos.x),
      y: Math.round(pos.y),
    }))
  } catch {
    /* ignore quota / private mode */
  }
}

export function persistNotationMode(value) {
  if (!NOTATION_MODES.includes(value)) return
  try {
    localStorage.setItem(NOTATION_MODE_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}
