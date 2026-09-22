import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

const STEP2NUM = [
  { step: 'C', num: 0 },
  { step: 'D', num: 2 },
  { step: 'E', num: 4 },
  { step: 'F', num: 5 },
  { step: 'G', num: 7 },
  { step: 'A', num: 9 },
  { step: 'B', num: 11 },
]
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
const DEFAULT_BPM = 100

function asArray(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).trim()
  }
  if (typeof node === 'object' && node['#text'] != null) {
    return String(node['#text']).trim()
  }
  return ''
}

function mergeAttributes(prev, next) {
  const src = Array.isArray(next) ? next[0] : next
  if (!src) return prev
  return {
    ...(prev || {}),
    ...src,
    key: src.key != null ? src.key : prev?.key,
    time: src.time != null ? src.time : prev?.time,
    divisions: src.divisions != null ? src.divisions : prev?.divisions,
    clef: src.clef != null ? src.clef : prev?.clef,
    staves: src.staves != null ? src.staves : prev?.staves,
  }
}

function stepNatural(step) {
  for (let i = 0; i < STEP2NUM.length; i++) {
    if (STEP2NUM[i].step === step) return STEP2NUM[i].num
  }
  return 0
}

function keySigAlter(fifths) {
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 }
  const n = Number(fifths) || 0
  if (n > 0) {
    for (let i = 0; i < n && i < 7; i++) map[SHARP_ORDER[i]] = 1
  } else if (n < 0) {
    for (let i = 0; i < -n && i < 7; i++) map[FLAT_ORDER[i]] = -1
  }
  return map
}

function isChordNote(note) {
  return note != null && note.chord != null && note.chord !== false
}

function isGraceNote(note) {
  return note != null && note.grace != null && note.grace !== false
}

function voiceOf(note) {
  const v = Number(note?.voice)
  return Number.isFinite(v) && v >= 1 ? Math.trunc(v) : 1
}

function noteMidi(note, partAttr, transposeSemitones) {
  if (!note?.pitch) return null
  const step = textOf(note.pitch.step) || note.pitch.step
  if (!step) return null
  const naturalSemitone = stepNatural(step)
  const originalFifths = Number(partAttr?.key?.fifths) || 0
  const sig = keySigAlter(originalFifths)
  let pitchAlter = 0
  if (note.pitch.alter != null && note.pitch.alter !== '') {
    pitchAlter = Number(note.pitch.alter)
  } else {
    pitchAlter = sig[step] || 0
  }
  const soundingSemitone = ((naturalSemitone + pitchAlter) % 12 + 12) % 12
  const pitchOctave = Number(note.pitch.octave)
  if (!Number.isFinite(pitchOctave)) return null
  return (pitchOctave + 1) * 12 + soundingSemitone + (Number(transposeSemitones) || 0)
}

function readTempoValue(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function findInitialTempo(measures) {
  for (const measure of measures) {
    for (const direction of asArray(measure.direction)) {
      const sound = direction.sound
      if (sound != null) {
        const tempo = readTempoValue(sound['@_tempo'] ?? sound.tempo)
        if (tempo != null) return tempo
      }
      for (const t of asArray(direction['direction-type'])) {
        const tempo = readTempoValue(t?.metronome?.['per-minute'])
        if (tempo != null) return tempo
      }
    }
  }
  return DEFAULT_BPM
}

function findMeasureTempo(measure) {
  for (const direction of asArray(measure?.direction)) {
    for (const t of asArray(direction['direction-type'])) {
      const tempo = readTempoValue(t?.metronome?.['per-minute'])
      if (tempo != null) return tempo
    }
    const sound = direction.sound
    if (sound != null) {
      const tempo = readTempoValue(sound['@_tempo'] ?? sound.tempo)
      if (tempo != null) return tempo
    }
  }
  return null
}

function quartersToSeconds(quarters, bpm) {
  const q = Number(quarters) || 0
  const b = Math.max(1, Number(bpm) || DEFAULT_BPM)
  return (q * 60) / b
}

/**
 * 把从曲首起的四分音符数换成秒。spans 为按时间排序的变速段。
 * @param {Array<{ startQuarter: number, bpm: number }>} spans
 * @param {number} quarter
 */
export function secondsAtQuarter(spans, quarter) {
  const q = Math.max(0, Number(quarter) || 0)
  if (!spans?.length) return quartersToSeconds(q, DEFAULT_BPM)
  let sec = 0
  for (let i = 0; i < spans.length; i++) {
    const start = Number(spans[i].startQuarter) || 0
    if (q <= start) break
    const next = i + 1 < spans.length ? Number(spans[i + 1].startQuarter) || 0 : q
    const slice = Math.min(q, next) - start
    if (slice > 0) sec += quartersToSeconds(slice, spans[i].bpm)
  }
  return sec
}

function normalizeMeasures(parsed) {
  const score = parsed?.['score-partwise']
  if (!score) {
    throw new Error('不是 score-partwise 格式的 MusicXML，或文件不完整')
  }
  const part = asArray(score.part)[0]
  if (!part) throw new Error('MusicXML 中没有 part')
  const measures = asArray(part.measure)
  if (!measures.length) throw new Error('MusicXML 中没有小节')

  let lastAttr = null
  for (const measure of measures) {
    if (measure.attributes) {
      lastAttr = mergeAttributes(lastAttr, measure.attributes)
      measure.attributes = lastAttr
    } else if (lastAttr) {
      measure.attributes = lastAttr
    }
    measure.note = asArray(measure.note)
  }
  return { measures, partAttr: measures[0].attributes }
}

/**
 * 第一 part 的线性时间轴（忽略反复、跳房子、装饰音）。
 * slots 含休止，供简谱高亮；events 只含发声，供 Tone。
 * @param {object[]} measures
 * @param {object | null | undefined} firstAttr
 * @param {number} transposeSemitones
 */
function walkTimeline(measures, firstAttr, transposeSemitones) {
  let bpm = findInitialTempo(measures)
  let quarterAt = 0
  let cursorSec = 0
  /** @type {Array<{ startQuarter: number, bpm: number }>} */
  const spans = [{ startQuarter: 0, bpm }]
  /** @type {Array<{ measureIndex: number, noteIndex: number, time: number }>} */
  const slots = []
  /** @type {Array<{ time: number, duration: number, midi: number }>} */
  const events = []

  for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
    const measure = measures[measureIndex]
    const measureTempo = findMeasureTempo(measure)
    if (measureTempo != null && measureTempo !== bpm) {
      bpm = measureTempo
      spans.push({ startQuarter: quarterAt, bpm })
    }

    const partAttr = measure.attributes || firstAttr
    const divisions = Math.max(1, Number(partAttr?.divisions) || 1)
    const notes = measure.note || []

    /** @type {Map<number, Array<{ note: object, noteIndex: number }>>} */
    const byVoice = new Map()
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      const note = notes[noteIndex]
      if (isGraceNote(note)) continue
      const voice = voiceOf(note)
      if (!byVoice.has(voice)) byVoice.set(voice, [])
      byVoice.get(voice).push({ note, noteIndex })
    }

    let measureQuarters = 0
    for (const voiceNotes of byVoice.values()) {
      let onset = 0
      let lastOnset = 0
      let voiceEnd = 0
      for (const { note, noteIndex } of voiceNotes) {
        const dur = Math.max(0, Number(note.duration) || 0)
        const noteOnset = isChordNote(note) ? lastOnset : onset
        if (!isChordNote(note)) {
          lastOnset = onset
          onset += dur
        }
        voiceEnd = Math.max(voiceEnd, noteOnset + dur)

        const time = cursorSec + quartersToSeconds(noteOnset / divisions, bpm)
        slots.push({ measureIndex, noteIndex, time })
        if (note.rest != null) continue
        const midi = noteMidi(note, partAttr, transposeSemitones)
        if (midi == null) continue
        const duration = quartersToSeconds(dur / divisions, bpm)
        if (duration <= 0) continue
        events.push({ time, duration, midi })
      }
      measureQuarters = Math.max(measureQuarters, voiceEnd / divisions)
    }

    // 无音符小节仍按拍号推进；缺拍号时用已推算出的声部长度
    if (measureQuarters <= 0) {
      const beats = Number(partAttr?.time?.beats) || 4
      const beatType = Number(partAttr?.time?.['beat-type']) || 4
      measureQuarters = (beats * 4) / beatType
    }
    quarterAt += measureQuarters
    cursorSec += quartersToSeconds(measureQuarters, bpm)
  }

  events.sort((a, b) => a.time - b.time || a.midi - b.midi)
  slots.sort(
    (a, b) =>
      a.time - b.time ||
      a.measureIndex - b.measureIndex ||
      a.noteIndex - b.noteIndex
  )

  let durationSec = cursorSec
  for (const ev of events) {
    durationSec = Math.max(durationSec, ev.time + ev.duration)
  }

  return {
    events,
    slots,
    spans,
    durationSec: Math.max(0.01, durationSec),
    bpm: spans[0]?.bpm || bpm,
  }
}

/**
 * 简谱音符 onset（秒），含休止、不含装饰音。measures 需已展开 attributes。
 * @param {object[]} measures
 * @returns {Array<{ measureIndex: number, noteIndex: number, time: number }>}
 */
export function buildNoteOnsets(measures) {
  const list = measures || []
  if (!list.length) return []
  return walkTimeline(list, list[0]?.attributes, 0).slots
}

/**
 * @param {string} xmlString
 * @returns {Array<{ startQuarter: number, bpm: number }>}
 */
export function buildTempoSpans(xmlString) {
  const raw = String(xmlString || '')
  if (!raw.trim()) return [{ startQuarter: 0, bpm: DEFAULT_BPM }]
  const parsed = xmlParser.parse(raw)
  const { measures, partAttr } = normalizeMeasures(parsed)
  return walkTimeline(measures, partAttr, 0).spans
}

/**
 * MusicXML → Tone 可播日程（秒）。
 * 首版：第一 part 全部声部叠奏；忽略反复/跳房子/装饰音。
 *
 * @param {string} xmlString
 * @param {{ transposeSemitones?: number }} [options]
 * @returns {{ events: Array<{ time: number, duration: number, midi: number }>, durationSec: number, bpm: number, spans: Array<{ startQuarter: number, bpm: number }> }}
 */
export function buildMusicXmlSchedule(xmlString, options = {}) {
  const raw = String(xmlString || '')
  if (!raw.trim()) throw new Error('MusicXML 内容为空')

  const parsed = xmlParser.parse(raw)
  const { measures, partAttr } = normalizeMeasures(parsed)
  const transposeSemitones = Number(options.transposeSemitones) || 0
  return walkTimeline(measures, partAttr, transposeSemitones)
}
