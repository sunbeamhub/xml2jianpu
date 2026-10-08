import { isTauri } from './platform.js'

const MIDI_PREFIX = 'midi:'
const MIDI_CHANNEL = 1

/** @type {typeof import('webmidi').WebMidi | null} */
let webMidi = null
/** @type {((msg: { type: 'on' | 'off', midi: number }) => void) | null} */
let noteHandler = null
/** @type {((snapshot: { inputs: MidiPort[], outputs: MidiPort[] }) => void) | null} */
let portHandler = null
/** @type {Array<() => void>} */
let inputUnsubs = []
let portListenersOn = false
let pageHideBound = false
let panicEnabled = true

/**
 * @typedef {{ id: string, name: string, label: string }} MidiPort
 */

export function midiInstrumentId(portId) {
  return `${MIDI_PREFIX}${portId}`
}

export function midiPortIdFromInstrument(id) {
  if (typeof id !== 'string' || !id.startsWith(MIDI_PREFIX)) return ''
  return id.slice(MIDI_PREFIX.length)
}

/** 安装包和没有 Web MIDI 的浏览器不展示电子琴。不申请权限。 */
export function isWebMidiSupported() {
  if (typeof navigator === 'undefined') return false
  if (isTauri()) return false
  return typeof navigator.requestMIDIAccess === 'function'
}

/** @param {((msg: { type: 'on' | 'off', midi: number }) => void) | null} cb */
export function onMidiNotes(cb) {
  noteHandler = typeof cb === 'function' ? cb : null
}

/** @param {((snapshot: { inputs: MidiPort[], outputs: MidiPort[] }) => void) | null} cb */
export function onMidiPorts(cb) {
  portHandler = typeof cb === 'function' ? cb : null
}

function portName(port) {
  const name = String(port?.name || '').trim()
  return name || '电子琴'
}

/** @param {Array<{ id: string, name: string }>} outputs */
function labelOutputs(outputs) {
  const counts = new Map()
  for (const port of outputs) {
    counts.set(port.name, (counts.get(port.name) || 0) + 1)
  }
  const seen = new Map()
  return outputs.map((port) => {
    const n = (seen.get(port.name) || 0) + 1
    seen.set(port.name, n)
    const label = counts.get(port.name) > 1 ? `${port.name} ${n}` : port.name
    return { id: port.id, name: port.name, label }
  })
}

function readSnapshot() {
  if (!webMidi) return { inputs: [], outputs: [] }
  const inputs = webMidi.inputs.map((port) => ({
    id: String(port.id),
    name: portName(port),
    label: portName(port),
  }))
  const outputs = labelOutputs(
    webMidi.outputs.map((port) => ({
      id: String(port.id),
      name: portName(port),
    }))
  )
  return { inputs, outputs }
}

function emitNote(type, midi) {
  if (!noteHandler || !Number.isFinite(midi)) return
  noteHandler({ type, midi })
}

function unbindInputs() {
  for (const unsub of inputUnsubs) {
    try {
      unsub()
    } catch {
      /* ignore */
    }
  }
  inputUnsubs = []
}

function bindInputs() {
  unbindInputs()
  if (!webMidi) return
  for (const input of webMidi.inputs) {
    const onNoteOn = (event) => {
      const midi = Number(event?.note?.number)
      if (!Number.isFinite(midi)) return
      if (Number(event.note.rawAttack) === 0) {
        emitNote('off', midi)
        return
      }
      emitNote('on', midi)
    }
    const onNoteOff = (event) => {
      const midi = Number(event?.note?.number)
      emitNote('off', midi)
    }
    input.addListener('noteon', onNoteOn)
    input.addListener('noteoff', onNoteOff)
    inputUnsubs.push(() => {
      input.removeListener('noteon', onNoteOn)
      input.removeListener('noteoff', onNoteOff)
    })
  }
}

function onPortChange() {
  bindInputs()
  if (portHandler) portHandler(readSnapshot())
}

function ensurePortListeners() {
  if (!webMidi || portListenersOn) return
  webMidi.addListener('connected', onPortChange)
  webMidi.addListener('disconnected', onPortChange)
  portListenersOn = true
}

function removePortListeners() {
  if (!webMidi || !portListenersOn) {
    portListenersOn = false
    return
  }
  try {
    webMidi.removeListener('connected', onPortChange)
    webMidi.removeListener('disconnected', onPortChange)
  } catch {
    /* ignore */
  }
  portListenersOn = false
}

function onPageHide() {
  silenceMidiOutput('', { force: true })
}

function bindPageHide() {
  if (pageHideBound || typeof window === 'undefined') return
  window.addEventListener('pagehide', onPageHide)
  pageHideBound = true
}

function unbindPageHide() {
  if (!pageHideBound || typeof window === 'undefined') return
  window.removeEventListener('pagehide', onPageHide)
  pageHideBound = false
}

/** 跟弹时关掉，避免重载试听日程把琴上正在按住的音停掉。 */
export function setMidiPanicEnabled(on) {
  panicEnabled = on !== false
}

/**
 * 停掉已排队和正在响的音。portId 为空时清全部输出。
 * @param {string} [portId]
 * @param {{ force?: boolean }} [opts]
 */
export function silenceMidiOutput(portId, opts = {}) {
  if (!panicEnabled && !opts.force) return
  if (!webMidi) return
  const list = portId
    ? webMidi.outputs.filter((port) => String(port.id) === String(portId))
    : webMidi.outputs.slice()
  for (const output of list) {
    try {
      output.clear()
    } catch {
      /* ignore */
    }
    try {
      output.sendAllSoundOff()
    } catch {
      /* ignore */
    }
    try {
      output.sendAllNotesOff()
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} portId
 * @param {number} midi
 * @param {number} durationSec
 * @param {number} delaySec Tone 提前量，相对当前音频时钟
 */
export function scheduleMidiNote(portId, midi, durationSec, delaySec) {
  if (!webMidi) return
  const output = webMidi.outputs.find((port) => String(port.id) === String(portId))
  if (!output) return
  const note = Number(midi)
  if (!Number.isFinite(note)) return
  const delayMs = Math.max(0, Number(delaySec) || 0) * 1000
  const duration = Math.max(1, (Number(durationSec) || 0) * 1000)
  output.playNote(note, {
    channels: MIDI_CHANNEL,
    duration,
    rawAttack: 96,
    time: webMidi.time + delayMs,
  })
}

let connectTask = null

/**
 * 点击连接时才加载 webmidi.js 并申请权限。
 * @returns {Promise<{ ok: boolean, inputs: MidiPort[], outputs: MidiPort[] }>}
 */
export async function connectMidi() {
  if (connectTask) return connectTask
  connectTask = openMidi().finally(() => {
    connectTask = null
  })
  return connectTask
}

async function openMidi() {
  const { WebMidi } = await import('webmidi')
  webMidi = WebMidi
  if (!WebMidi.supported) {
    return { ok: false, inputs: [], outputs: [] }
  }
  if (!WebMidi.enabled) {
    await WebMidi.enable({ sysex: false })
  }
  ensurePortListeners()
  bindInputs()
  bindPageHide()
  const snapshot = readSnapshot()
  if (!snapshot.inputs.length && !snapshot.outputs.length) {
    await disconnectMidi()
    return { ok: false, inputs: [], outputs: [] }
  }
  return { ok: true, ...snapshot }
}

export async function disconnectMidi() {
  unbindInputs()
  removePortListeners()
  silenceMidiOutput('', { force: true })
  setMidiPanicEnabled(true)
  unbindPageHide()
  if (webMidi?.enabled) {
    try {
      await webMidi.disable()
    } catch {
      /* ignore */
    }
  }
}
