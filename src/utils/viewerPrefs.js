import { NOTATION_JIANPU, NOTATION_MODES } from "./osmdRenderer.js";
import {
  SCORE_FONT_SIZE_DEFAULT,
  clampScoreFontSize,
} from "./scoreMetrics.js";
import {
  DEFAULT_PAPER_SIZE,
  DEFAULT_EXPORT_PAPER_SIZE,
  DISPLAY_SIZES,
  isExportPaperSize,
} from "./pageLayout.js";
import { examples, defaultExampleId } from "./scoreCatalog.js";
import { isTauri } from "./platform.js";

const SELECTED_EXAMPLE_KEY = 'xml2jianpu:selectedExample'
const UPLOAD_DIR_KEY = 'xml2jianpu:uploadDir'
const LINE_BREAK_KEY = 'xml2jianpu:lineBreak'
export const LINE_BREAK_VALUES = ['auto', 'musicxml', '2', '3', '4', '5', '6']
const PAPER_SIZE_KEY = 'xml2jianpu:paperSize'
const EXPORT_PAPER_SIZE_KEY = 'xml2jianpu:exportPaperSize'
export const PAPER_SIZE_VALUES = Object.keys(DISPLAY_SIZES)
const SCORE_FONT_SIZE_KEY = 'xml2jianpu:scoreFontSize'
const NOTATION_MODE_KEY = 'xml2jianpu:notationMode'

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

export function readStoredExportPaperSize() {
  try {
    const value = localStorage.getItem(EXPORT_PAPER_SIZE_KEY)
    if (value && isExportPaperSize(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return DEFAULT_EXPORT_PAPER_SIZE
}

export function persistExportPaperSize(value) {
  if (!isExportPaperSize(value)) return
  try {
    localStorage.setItem(EXPORT_PAPER_SIZE_KEY, value)
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

export function persistNotationMode(value) {
  if (!NOTATION_MODES.includes(value)) return
  try {
    localStorage.setItem(NOTATION_MODE_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}
