import { addPluginListener, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isAndroidTauri, isTauri } from './platform.js'

const MIDI_PREFIX = 'midi:'
const MIDI_CHANNEL = 1

/** @type {typeof import('webmidi').WebMidi | null} */
let webMidi = null
/** @type {'web' | 'native' | ''} */
let backend = ''
/** @type {((msg: { type: 'on' | 'off', midi: number }) => void) | null} */
let noteHandler = null
/** @type {((snapshot: { inputs: MidiPort[], outputs: MidiPort[] }) => void) | null} */
let portHandler = null
/** @type {Array<() => void>} */
let inputUnsubs = []
/** @type {Array<() => void | Promise<void>>} */
let nativeUnsubs = []
/** @type {MidiPort[]} */
let nativeOutputs = []
/** @type {Set<ReturnType<typeof setTimeout>>} */
let scheduled = new Set()
let scheduleEpoch = 0
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

/** 没有 Web MIDI、也不在安装包里时不展示电子琴。不申请权限。 */
export function isWebMidiSupported() {
  if (typeof navigator === 'undefined') return false
  if (isTauri()) return true
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

/**
 * @param {{ inputs?: Array<{ id: string, name: string }>, outputs?: Array<{ id: string, name: string }> } | null} snapshot
 */
function presentSnapshot(snapshot) {
  const inputs = (snapshot?.inputs || []).map((port) => ({
    id: String(port.id),
    name: portName(port),
    label: portName(port),
  }))
  const outputs = labelOutputs(
    (snapshot?.outputs || []).map((port) => ({
      id: String(port.id),
      name: portName(port),
    }))
  )
  return { inputs, outputs }
}

function readSnapshot() {
  if (!webMidi) return { inputs: [], outputs: [] }
  return presentSnapshot({
    inputs: webMidi.inputs.map((port) => ({
      id: String(port.id),
      name: portName(port),
    })),
    outputs: webMidi.outputs.map((port) => ({
      id: String(port.id),
      name: portName(port),
    })),
  })
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

function clearScheduled() {
  scheduleEpoch += 1
  for (const timer of scheduled) clearTimeout(timer)
  scheduled.clear()
}

function nativeSend(portId, bytes) {
  void invoke('plugin:midi|send', { portId, bytes }).catch(() => {
    /* 断开时发送失败可以忽略 */
  })
}

function silenceNative(portId) {
  clearScheduled()
  const targets = portId
    ? nativeOutputs.filter((port) => port.id === String(portId))
    : nativeOutputs.slice()
  for (const port of targets) {
    for (let channel = 0; channel < 16; channel += 1) {
      nativeSend(port.id, [0xb0 | channel, 120, 0])
      nativeSend(port.id, [0xb0 | channel, 123, 0])
    }
  }
}

/**
 * 停掉已排队和正在响的音。portId 为空时清全部输出。
 * @param {string} [portId]
 * @param {{ force?: boolean }} [opts]
 */
export function silenceMidiOutput(portId, opts = {}) {
  if (!panicEnabled && !opts.force) return
  if (backend === 'native') {
    silenceNative(portId || '')
    return
  }
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
  const note = Number(midi)
  if (!Number.isFinite(note)) return
  if (backend === 'native') {
    const epoch = scheduleEpoch
    const delayMs = Math.max(0, Number(delaySec) || 0) * 1000
    const duration = Math.max(1, (Number(durationSec) || 0) * 1000)
    const channel = MIDI_CHANNEL - 1
    const arm = (ms, bytes) => {
      const timer = setTimeout(() => {
        scheduled.delete(timer)
        if (epoch !== scheduleEpoch) return
        nativeSend(portId, bytes)
      }, ms)
      scheduled.add(timer)
    }
    arm(delayMs, [0x90 | channel, note, 96])
    arm(delayMs + duration, [0x80 | channel, note, 0])
    return
  }
  if (!webMidi) return
  const output = webMidi.outputs.find((port) => String(port.id) === String(portId))
  if (!output) return
  const delayMs = Math.max(0, Number(delaySec) || 0) * 1000
  const duration = Math.max(1, (Number(durationSec) || 0) * 1000)
  output.playNote(note, {
    channels: MIDI_CHANNEL,
    duration,
    rawAttack: 96,
    time: webMidi.time + delayMs,
  })
}

function onNativeNote(payload) {
  const type = payload?.type
  const midi = Number(payload?.midi)
  if ((type !== 'on' && type !== 'off') || !Number.isFinite(midi)) return
  emitNote(type, midi)
}

function onNativePorts(payload) {
  const snapshot = presentSnapshot(payload)
  nativeOutputs = snapshot.outputs
  if (portHandler) portHandler(snapshot)
}

async function unbindNative() {
  const pending = nativeUnsubs.splice(0)
  for (const unsub of pending) {
    try {
      await unsub()
    } catch {
      /* ignore */
    }
  }
}

async function bindNative() {
  await unbindNative()
  if (isAndroidTauri()) {
    const notes = await addPluginListener('midi', 'note', onNativeNote)
    const ports = await addPluginListener('midi', 'ports', onNativePorts)
    nativeUnsubs = [() => notes.unregister(), () => ports.unregister()]
    return
  }
  const notes = await listen('midi-note', (event) => onNativeNote(event.payload))
  const ports = await listen('midi-ports', (event) => onNativePorts(event.payload))
  nativeUnsubs = [() => notes(), () => ports()]
}

async function closeNative() {
  clearScheduled()
  try {
    await invoke('plugin:midi|disconnect')
  } catch {
    /* ignore */
  }
  await unbindNative()
  nativeOutputs = []
  if (backend === 'native') backend = ''
}

let connectTask = null

/**
 * 点击连接时才加载 webmidi.js 或打开安装包里的系统 MIDI。
 * @returns {Promise<{ ok: boolean, inputs: MidiPort[], outputs: MidiPort[] }>}
 */
export async function connectMidi() {
  if (connectTask) return connectTask
  connectTask = openMidi().finally(() => {
    connectTask = null
  })
  return connectTask
}

async function openNative() {
  await bindNative()
  bindPageHide()
  try {
    const result = await invoke('plugin:midi|connect')
    const snapshot = presentSnapshot(result)
    nativeOutputs = snapshot.outputs
    if (!result?.ok || (!snapshot.inputs.length && !snapshot.outputs.length)) {
      await closeNative()
      unbindPageHide()
      return { ok: false, inputs: [], outputs: [] }
    }
    backend = 'native'
    return { ok: true, ...snapshot }
  } catch (err) {
    await closeNative()
    unbindPageHide()
    throw err
  }
}

async function openWeb() {
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
  backend = 'web'
  return { ok: true, ...snapshot }
}

async function openMidi() {
  if (isTauri()) return openNative()
  return openWeb()
}

export async function disconnectMidi() {
  unbindInputs()
  removePortListeners()
  silenceMidiOutput('', { force: true })
  setMidiPanicEnabled(true)
  unbindPageHide()
  if (backend === 'native') {
    await closeNative()
    return
  }
  backend = ''
  clearScheduled()
  if (webMidi?.enabled) {
    try {
      await webMidi.disable()
    } catch {
      /* ignore */
    }
  }
  webMidi = null
}
