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

export const PLAYBACK_BPM_MIN = 20
export const PLAYBACK_BPM_MAX = 200

export function clampPlaybackBpm(bpm) {
  const n = Math.round(Number(bpm))
  if (!Number.isFinite(n)) return DEFAULT_BPM
  return Math.max(PLAYBACK_BPM_MIN, Math.min(PLAYBACK_BPM_MAX, n))
}

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

/** `<tie type="start|stop">`。stop 且前面已有同音时不再另起一次按下。 */
function tieFlags(note) {
  let stop = false
  let start = false
  for (const tie of asArray(note?.tie)) {
    const kind = tie?.['@_type'] || tie?.type
    if (kind === 'stop') stop = true
    if (kind === 'start') start = true
  }
  return { stop, start }
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

/** 拍号分母对应的一拍，谱面秒。4/4 为四分音符，6/8 为八分音符。 */
function beatSeconds(partAttr, bpm) {
  const beatType = Math.max(1, Number(partAttr?.time?.['beat-type']) || 4)
  return quartersToSeconds(4 / beatType, bpm)
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

function attrOf(node, name) {
  if (node == null || typeof node !== 'object') return undefined
  return node[`@_${name}`] ?? node[name]
}

/** 小节内所有 `<sound>`（小节级与 direction 里的）属性 */
function measureSounds(measure) {
  const list = [...asArray(measure?.sound)]
  for (const direction of asArray(measure?.direction)) {
    list.push(...asArray(direction?.sound))
  }
  return list
}

function hasDirectionSymbol(measure, name) {
  for (const direction of asArray(measure?.direction)) {
    for (const t of asArray(direction?.['direction-type'])) {
      if (t?.[name] != null) return true
    }
  }
  return false
}

function parseEndingNumbers(raw) {
  return String(raw ?? '')
    .split(/[\s,]+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

/** 反复、房子、D.C./D.S./Fine/Coda 等跳转信息 */
function readJumpInfo(measures) {
  const info = measures.map(() => ({
    forward: false,
    backwardTimes: 0,
    endingNums: null,
    endingGroupMax: 0,
    endingClose: false,
    segno: false,
    coda: false,
    tocoda: false,
    fine: false,
    dacapo: false,
    dalsegno: false,
  }))
  let openEnding = null
  measures.forEach((measure, i) => {
    const cur = info[i]
    for (const bar of asArray(measure?.barline)) {
      const repeat = bar?.repeat
      const direction = attrOf(repeat, 'direction')
      if (direction === 'forward') cur.forward = true
      if (direction === 'backward') {
        const times = Number(attrOf(repeat, 'times'))
        cur.backwardTimes = Number.isFinite(times) && times >= 2 ? Math.trunc(times) : 2
      }
      const ending = bar?.ending
      const type = attrOf(ending, 'type')
      if (type === 'start') {
        openEnding = { start: i, nums: parseEndingNumbers(attrOf(ending, 'number')) }
      }
      if (openEnding && (type === 'start' || type === 'stop' || type === 'discontinue')) {
        cur.endingNums = openEnding.nums
      }
      if (openEnding && (type === 'stop' || type === 'discontinue')) {
        cur.endingClose = true
        openEnding = null
      }
    }
    if (openEnding && !cur.endingNums) cur.endingNums = openEnding.nums
    for (const sound of measureSounds(measure)) {
      if (attrOf(sound, 'segno') != null) cur.segno = true
      if (attrOf(sound, 'coda') != null) cur.coda = true
      if (attrOf(sound, 'tocoda') != null) cur.tocoda = true
      if (attrOf(sound, 'fine') != null) cur.fine = true
      if (String(attrOf(sound, 'dacapo') ?? '') === 'yes') cur.dacapo = true
      if (attrOf(sound, 'dalsegno') != null) cur.dalsegno = true
    }
    if (hasDirectionSymbol(measure, 'segno')) cur.segno = true
    if (hasDirectionSymbol(measure, 'coda')) cur.coda = true
  })
  // 首尾相接的房子算一组；D.C./D.S. 之后只走组内最后一个房子
  let groupStart = -1
  for (let i = 0; i <= info.length; i++) {
    const inEnding = i < info.length && info[i].endingNums
    if (inEnding && groupStart < 0) groupStart = i
    if (!inEnding && groupStart >= 0) {
      let max = 0
      for (let k = groupStart; k < i; k++) {
        for (const n of info[k].endingNums) max = Math.max(max, n)
      }
      for (let k = groupStart; k < i; k++) info[k].endingGroupMax = max
      groupStart = -1
    }
  }
  return info
}

/**
 * 按反复记号展开的演奏顺序（小节下标）。与 MuseScore 等一致：
 * - 反复段默认奏两遍（`times` 可改），无前反复记号时从曲首或上一反复段之后开始；
 * - 房子按遍数选择，`number="1, 2"` 可多遍共用；
 * - D.C./D.S. 之后不再反复，房子取最后一个，遇 Fine 结束、遇 To Coda 跳到 Coda。
 * @param {object[]} measures
 * @returns {number[]}
 */
export function buildPlayOrder(measures) {
  const n = measures?.length || 0
  if (!n) return []
  const info = readJumpInfo(measures)
  const segnoIdx = info.findIndex((m) => m.segno)
  const order = []
  const backCount = new Map()
  let i = 0
  let repeatStart = 0
  let pass = 1
  let jumped = false
  const limit = n * 50
  while (i < n && order.length < limit) {
    const m = info[i]
    if (m.forward && repeatStart !== i) {
      repeatStart = i
      pass = 1
    }
    if (m.endingNums) {
      const take = jumped
        ? m.endingNums.includes(m.endingGroupMax)
        : m.endingNums.includes(pass)
      if (!take) {
        let k = i
        while (k < n - 1 && !info[k].endingClose) k++
        i = k + 1
        continue
      }
    }
    order.push(i)
    if (jumped && m.fine) break
    if (jumped && m.tocoda) {
      const codaIdx = info.findIndex((x, k) => k > i && x.coda)
      if (codaIdx >= 0) {
        i = codaIdx
        continue
      }
    }
    if (m.backwardTimes) {
      const done = backCount.get(i) || 0
      if (!jumped && done < m.backwardTimes - 1) {
        backCount.set(i, done + 1)
        pass = done + 2
        i = repeatStart
        continue
      }
      backCount.delete(i)
      repeatStart = i + 1
      pass = 1
    } else if (m.endingNums && m.endingClose) {
      // 最后一个房子奏完，后面开始新的反复段
      repeatStart = i + 1
      pass = 1
    }
    if (!jumped && (m.dacapo || (m.dalsegno && segnoIdx >= 0))) {
      jumped = true
      i = m.dacapo ? 0 : segnoIdx
      repeatStart = i
      pass = 1
      continue
    }
    i++
  }
  return order
}

/**
 * 第一 part 按演奏顺序（展开反复/房子/D.C. 等）的时间轴，忽略装饰音。
 * 同一小节反复时每遍各有一份 slots/events/measures，用 pass 区分。
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
  /** @type {Array<{ measureIndex: number, noteIndex: number, pass: number, time: number, onset: number, duration: number }>} */
  const slots = []
  /** @type {Array<{ time: number, duration: number, midi: number, measureIndex: number, pass: number, firstPass: boolean, measurePos: number, measureSpan: number, beatSec: number }>} */
  const events = []
  /** @type {Array<{ measureIndex: number, pass: number, firstPass: boolean, startSec: number, endSec: number, bpm: number, beatSec: number, beats: number, divisions: number, measureQuarters: number }>} */
  const measureTimeline = []
  /** 延音线未结束的音，按声部 + MIDI 音高接上时值 */
  const openTies = new Map()
  const order = buildPlayOrder(measures)
  const seenMeasures = new Set()

  for (let pass = 0; pass < order.length; pass++) {
    const measureIndex = order[pass]
    const measure = measures[measureIndex]
    const firstPass = !seenMeasures.has(measureIndex)
    seenMeasures.add(measureIndex)
    // 反复/房子跳转处前后不相邻，延音线不跨过去接
    if (pass > 0 && order[pass - 1] !== measureIndex - 1) openTies.clear()
    const measureTempo = findMeasureTempo(measure)
    if (measureTempo != null && measureTempo !== bpm) {
      bpm = measureTempo
      spans.push({ startQuarter: quarterAt, bpm })
    }

    const partAttr = measure.attributes || firstAttr
    const divisions = Math.max(1, Number(partAttr?.divisions) || 1)
    const notes = measure.note || []
    const measureStartSec = cursorSec
    const curBeatSec = beatSeconds(partAttr, bpm)
    const measureEvents = []

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
    for (const [voice, voiceNotes] of byVoice) {
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
        const durationSec = quartersToSeconds(dur / divisions, bpm)
        slots.push({
          measureIndex,
          noteIndex,
          pass,
          time,
          onset: noteOnset,
          duration: durationSec,
        })
        if (note.rest != null) continue
        const midi = noteMidi(note, partAttr, transposeSemitones)
        if (midi == null) continue
        const duration = durationSec
        if (duration <= 0) continue
        const { stop, start } = tieFlags(note)
        const tieKey = `${voice}:${midi}`
        if (stop) {
          const prev = openTies.get(tieKey)
          if (prev) {
            const end = time + duration
            prev.duration = Math.max(prev.duration, end - prev.time)
            if (start) openTies.set(tieKey, prev)
            else openTies.delete(tieKey)
            continue
          }
        }
        const ev = {
          time,
          duration,
          midi,
          measureIndex,
          pass,
          firstPass,
          measurePos: 0,
          measureSpan: 0,
          beatSec: curBeatSec,
        }
        events.push(ev)
        measureEvents.push(ev)
        if (start) openTies.set(tieKey, ev)
        else openTies.delete(tieKey)
      }
      measureQuarters = Math.max(measureQuarters, voiceEnd / divisions)
    }

    // 无音符小节仍按拍号推进；缺拍号时用已推算出的声部长度
    if (measureQuarters <= 0) {
      const beats = Number(partAttr?.time?.beats) || 4
      const beatType = Number(partAttr?.time?.['beat-type']) || 4
      measureQuarters = (beats * 4) / beatType
    }
    const beatType = Math.max(1, Number(partAttr?.time?.['beat-type']) || 4)
    const unitQuarters = 4 / beatType
    const rawBeats =
      unitQuarters > 0 ? measureQuarters / unitQuarters : Number(partAttr?.time?.beats) || 4
    const beatsCount = Math.max(1, Math.round(rawBeats * 1000) / 1000)
    quarterAt += measureQuarters
    cursorSec += quartersToSeconds(measureQuarters, bpm)
    // 按乐谱小节位置（与反复无关）记录，供按小节轴绘制的音高轮廓
    const measureSec = Math.max(1e-6, cursorSec - measureStartSec)
    for (const ev of measureEvents) {
      ev.measurePos = measureIndex + (ev.time - measureStartSec) / measureSec
      ev.measureSpan = ev.duration / measureSec
    }
    measureTimeline.push({
      measureIndex,
      pass,
      firstPass,
      startSec: measureStartSec,
      endSec: cursorSec,
      bpm,
      beatSec: curBeatSec,
      beats: beatsCount,
      divisions,
      measureQuarters,
    })
  }

  events.sort((a, b) => a.time - b.time || a.midi - b.midi)
  slots.sort(
    (a, b) =>
      a.time - b.time ||
      a.pass - b.pass ||
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
    measures: measureTimeline,
    measureCount: measures.length,
    order,
    durationSec: Math.max(0.01, durationSec),
    bpm: spans[0]?.bpm || bpm,
  }
}

/**
 * 乐谱小节号区间 → 演奏时间区间。从起始小节第一次出现的那一遍开始，
 * 到其后第一次奏到结束小节的那一遍为止；中间经过的反复照常展开。
 * @param {Array<{ measureIndex: number, startSec: number, endSec: number }>} passes 按时间排序的小节遍次
 * @param {number} startMeasure 1-based
 * @param {number} endMeasure 1-based
 * @returns {{ startSec: number, endSec: number } | null}
 */
export function resolveMeasureRange(passes, startMeasure, endMeasure) {
  const list = passes || []
  if (!list.length) return null
  const s = Math.max(0, Math.trunc(Number(startMeasure) || 1) - 1)
  const e = Math.max(s, Math.trunc(Number(endMeasure) || Infinity) - 1)
  let startIdx = list.findIndex((p) => p.measureIndex === s)
  if (startIdx < 0) startIdx = list.findIndex((p) => p.measureIndex >= s)
  if (startIdx < 0) startIdx = 0
  let endIdx = -1
  for (let k = startIdx; k < list.length; k++) {
    if (list[k].measureIndex === e) {
      endIdx = k
      break
    }
  }
  if (endIdx < 0) {
    for (let k = list.length - 1; k >= startIdx; k--) {
      if (list[k].measureIndex <= e) {
        endIdx = k
        break
      }
    }
  }
  if (endIdx < 0) endIdx = list.length - 1
  return {
    startSec: Number(list[startIdx].startSec) || 0,
    endSec: Number(list[endIdx].endSec) || 0,
  }
}

/**
 * 简谱音符 onset（秒），含休止、不含装饰音。measures 需已展开 attributes。
 * @param {object[]} measures
 * @returns {Array<{ measureIndex: number, noteIndex: number, time: number, onset: number, duration: number }>}
 */
export function buildNoteOnsets(measures) {
  const list = measures || []
  if (!list.length) return []
  return walkTimeline(list, list[0]?.attributes, 0).slots
}

/**
 * 简谱时间轴（含音符 slots 与小节遍次 measures，均按演奏顺序展开反复）。
 * measures 需已展开 attributes。
 * @param {object[]} measures
 */
export function buildMeasureTimeline(measures) {
  const list = measures || []
  if (!list.length) return { slots: [], measures: [], spans: [] }
  const res = walkTimeline(list, list[0]?.attributes, 0)
  return {
    slots: res.slots,
    measures: res.measures,
    spans: res.spans,
  }
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
 * MusicXML → 试听日程（秒）。
 * 第一 part 全部声部叠奏；按反复/房子/D.C./D.S. 展开演奏顺序，忽略装饰音。
 * 延音线的后续音并进前一个音的时值，不再单独击键。
 * measures 是按时间排序的小节遍次，measureCount 是乐谱小节数。
 *
 * @param {string} xmlString
 * @param {{ transposeSemitones?: number }} [options]
 */
export function buildMusicXmlSchedule(xmlString, options = {}) {
  const raw = String(xmlString || '')
  if (!raw.trim()) throw new Error('MusicXML 内容为空')

  const parsed = xmlParser.parse(raw)
  const { measures, partAttr } = normalizeMeasures(parsed)
  const transposeSemitones = Number(options.transposeSemitones) || 0
  return walkTimeline(measures, partAttr, transposeSemitones)
}

/**
 * 跟弹步骤：同一时刻的音合成一步（和弦可先后按）。
 * 每音带上秒数时值。events 需已去掉延音线的后续音。
 * @param {Array<{ time: number, duration: number, midi: number, measureIndex?: number, beatSec?: number }>} events
 * @param {{ startSec?: number, endSec?: number } | null} [range] 演奏时间区间（见 resolveMeasureRange）
 * @returns {Array<{ key: string, time: number, measureIndex: number, beatSec: number, notes: Array<{ midi: number, duration: number }> }>}
 */
export function buildFollowSteps(events, range) {
  const minSec = Number.isFinite(Number(range?.startSec)) ? Number(range.startSec) : -Infinity
  const maxSec =
    Number.isFinite(Number(range?.endSec)) && Number(range.endSec) > minSec
      ? Number(range.endSec)
      : Infinity
  /** @type {Array<{ key: string, time: number, measureIndex: number, beatSec: number, notes: Array<{ midi: number, duration: number }> }>} */
  const steps = []
  for (const ev of events || []) {
    const midi = Number(ev?.midi)
    const time = Number(ev?.time)
    const duration = Number(ev?.duration)
    const beatSec = Number(ev?.beatSec)
    const measureIndex = Number.isFinite(Number(ev?.measureIndex))
      ? Math.max(0, Math.trunc(Number(ev.measureIndex)))
      : 0
    if (!Number.isFinite(midi) || !Number.isFinite(time)) continue
    if (time < minSec - 1e-4 || time >= maxSec - 1e-4) continue
    const note = {
      midi,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    }
    const last = steps[steps.length - 1]
    if (last && Math.abs(last.time - time) <= 1e-3) {
      if (!last.notes.some((item) => item.midi === midi)) last.notes.push(note)
      if (!(last.beatSec > 0) && beatSec > 0) last.beatSec = beatSec
      continue
    }
    steps.push({
      key: time.toFixed(4),
      time,
      measureIndex,
      beatSec: beatSec > 0 ? beatSec : 0,
      notes: [note],
    })
  }
  return steps
}
