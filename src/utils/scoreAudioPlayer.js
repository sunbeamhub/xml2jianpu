import { buildMusicXmlSchedule } from './musicXmlSchedule.js'
import {
  midiPortIdFromInstrument,
  scheduleMidiNote,
  silenceMidiOutput,
} from './midiSession.js'

function isMidiInstrument(id) {
  return midiPortIdFromInstrument(id) !== ''
}

export const AUDIO_INSTRUMENT_SYNTH = 'synth'
export const AUDIO_INSTRUMENT_PIANO = 'piano'
export const AUDIO_INSTRUMENTS = [
  { value: AUDIO_INSTRUMENT_SYNTH, label: '电子' },
  { value: AUDIO_INSTRUMENT_PIANO, label: '钢琴' },
]

/** @type {typeof import('tone') | null} */
let Tone = null
/** @type {import('tone').PolySynth | null} */
let synth = null
/** @type {import('tone').Sampler | null} */
let piano = null
/** @type {Promise<import('tone').Sampler> | null} */
let pianoLoadPromise = null
/** @type {import('tone').Part | null} */
let part = null
/** @type {number | null} */
let endEventId = null

let durationSec = 0
/** 日程按这个 BPM 记成 tick，之后只改 Transport.bpm 来变速 */
const SCHEDULE_BPM = 120
/** 谱面起始速度。0 表示还没加载 */
let scoreBpm = 100
/** 用户选择的速度。0 表示跟谱面起始速度 */
let playbackBpm = 0
/** @type {Array<{ time: number, duration: number, midi: number, measureIndex?: number, beatSec?: number }>} */
let scheduleEvents = []
/** @type {Array<{ measureIndex: number, startSec: number, endSec: number, beatSec: number, beats: number }>} */
let scheduleMeasures = []
let ready = false
let loading = false
let instrumentLoading = false
/** @type {'synth' | 'piano' | string} */
let instrument = AUDIO_INSTRUMENT_SYNTH
/** @type {'stopped' | 'playing' | 'paused'} */
let playState = 'stopped'
/** @type {((state: string) => void) | null} */
let stateListener = null
/** @type {((ratio: number) => void) | null} */
let progressListener = null
let progressRaf = 0
let loadToken = 0

async function ensureTone() {
  if (Tone) return Tone
  Tone = await import('tone')
  return Tone
}

function emitState(next) {
  playState = next
  if (stateListener) stateListener(next)
}

function emitProgress(ratio) {
  if (progressListener) {
    progressListener(Math.max(0, Math.min(1, ratio)))
  }
}

function stopProgressLoop() {
  if (progressRaf) {
    cancelAnimationFrame(progressRaf)
    progressRaf = 0
  }
}

function playbackRate() {
  const score = Math.max(1, scoreBpm)
  const play = playbackBpm > 0 ? playbackBpm : score
  return play / score
}

function ticksPerScheduleSecond() {
  const ppq = Tone.getTransport().PPQ || 192
  return ppq * (SCHEDULE_BPM / 60)
}

/** 谱面秒。Transport.seconds 是墙上时间，不跟 BPM 走，所以用 tick 换算。 */
function readScheduleSeconds() {
  if (!Tone) return 0
  return Tone.getTransport().ticks / ticksPerScheduleSecond()
}

function writeScheduleSeconds(sec) {
  if (!Tone) return
  Tone.getTransport().ticks = Math.max(0, Number(sec) || 0) * ticksPerScheduleSecond()
}

function applyPlaybackTempo() {
  if (!Tone) return
  Tone.getTransport().bpm.value = SCHEDULE_BPM * playbackRate()
}

/**
 * @param {number} nextScoreBpm
 * @param {number} nextPlaybackBpm
 */
export function setScorePlaybackTempo(nextScoreBpm, nextPlaybackBpm) {
  const score = Number(nextScoreBpm)
  if (Number.isFinite(score) && score > 0) scoreBpm = score
  const play = Number(nextPlaybackBpm)
  playbackBpm = Number.isFinite(play) && play > 0 ? play : 0
  applyPlaybackTempo()
}

function tickProgress() {
  progressRaf = 0
  if (!Tone || !ready || durationSec <= 0) return
  emitProgress(readScheduleSeconds() / durationSec)
  if (playState === 'playing') {
    progressRaf = requestAnimationFrame(tickProgress)
  }
}

function startProgressLoop() {
  stopProgressLoop()
  progressRaf = requestAnimationFrame(tickProgress)
}

function clearPart() {
  if (!Tone) return
  if (endEventId != null) {
    try {
      Tone.getTransport().clear(endEventId)
    } catch {
      /* ignore */
    }
    endEventId = null
  }
  if (part) {
    try {
      part.dispose()
    } catch {
      /* ignore */
    }
    part = null
  }
}

function ensureSynth() {
  if (!Tone) return null
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.35,
        release: 0.4,
      },
    }).toDestination()
    synth.volume.value = -8
  }
  return synth
}

function pianoBaseUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}audio/piano/`
}

async function ensurePiano() {
  if (piano) return piano
  if (pianoLoadPromise) return pianoLoadPromise
  instrumentLoading = true
  pianoLoadPromise = (async () => {
    await ensureTone()
    const sampler = new Tone.Sampler({
      urls: {
        C1: 'C1.mp3',
        C2: 'C2.mp3',
        C3: 'C3.mp3',
        C4: 'C4.mp3',
        C5: 'C5.mp3',
        C6: 'C6.mp3',
        C7: 'C7.mp3',
      },
      baseUrl: pianoBaseUrl(),
      release: 1.2,
    }).toDestination()
    sampler.volume.value = -4
    await Tone.loaded()
    piano = sampler
    return piano
  })()
  try {
    return await pianoLoadPromise
  } finally {
    pianoLoadPromise = null
    instrumentLoading = false
  }
}

function releaseAllVoices() {
  try {
    if (synth) synth.releaseAll()
  } catch {
    /* ignore */
  }
  try {
    if (piano) piano.releaseAll()
  } catch {
    /* ignore */
  }
  if (isMidiInstrument(instrument)) {
    silenceMidiOutput(midiPortIdFromInstrument(instrument))
  }
}

function triggerNote(midi, duration, time) {
  if (!Tone) return
  const scaled = Math.max(0.02, (Number(duration) || 0) / Math.max(0.05, playbackRate()))
  if (isMidiInstrument(instrument)) {
    const delay = time - Tone.now()
    scheduleMidiNote(midiPortIdFromInstrument(instrument), midi, scaled, delay)
    return
  }
  if (instrument === AUDIO_INSTRUMENT_PIANO && piano) {
    const note = Tone.Frequency(midi, 'midi').toNote()
    piano.triggerAttackRelease(note, scaled, time)
    return
  }
  const active = ensureSynth()
  if (!active) return
  const freq = Tone.Frequency(midi, 'midi').toFrequency()
  active.triggerAttackRelease(freq, scaled, time)
}

function onTransportEnd() {
  if (!Tone) return
  Tone.getTransport().pause()
  writeScheduleSeconds(0)
  releaseAllVoices()
  emitProgress(0)
  emitState('stopped')
  stopProgressLoop()
}

function readProgressRatio() {
  if (!Tone || durationSec <= 0) return 0
  return Math.max(0, Math.min(1, readScheduleSeconds() / durationSec))
}

/**
 * @param {string} xmlString
 * @param {{ transposeSemitones?: number, resume?: boolean, resumeRatio?: number }} [options]
 */
export async function loadScoreAudio(xmlString, options = {}) {
  const token = ++loadToken
  const wasPlaying = playState === 'playing' || options.resume === true
  const resumeRatio =
    options.resumeRatio != null
      ? Math.max(0, Math.min(1, Number(options.resumeRatio) || 0))
      : wasPlaying
        ? readProgressRatio()
        : 0

  loading = true
  ready = false
  try {
    if (Tone) {
      Tone.getTransport().pause()
      releaseAllVoices()
    }
    const schedule = buildMusicXmlSchedule(xmlString, options)
    if (token !== loadToken) return { ready: false }

    await ensureTone()
    if (token !== loadToken) return { ready: false }

    ensureSynth()
    if (instrument === AUDIO_INSTRUMENT_PIANO) {
      await ensurePiano()
      if (token !== loadToken) return { ready: false }
    }

    scoreBpm = Number(schedule.bpm) > 0 ? Number(schedule.bpm) : 100
    if (options.playbackBpm === null) playbackBpm = 0
    else if (options.playbackBpm != null && Number(options.playbackBpm) > 0) {
      playbackBpm = Number(options.playbackBpm)
    }

    const transport = Tone.getTransport()
    transport.pause()
    transport.bpm.value = SCHEDULE_BPM
    clearPart()
    durationSec = schedule.durationSec
    scheduleMeasures = Array.isArray(schedule.measures) ? schedule.measures : []
    scheduleEvents = schedule.events.map((ev) => ({
      time: ev.time,
      duration: ev.duration,
      midi: ev.midi,
      measureIndex: Number.isFinite(Number(ev.measureIndex)) ? Math.trunc(Number(ev.measureIndex)) : 0,
      beatSec: Number(ev.beatSec) > 0 ? Number(ev.beatSec) : 0,
    }))

    part = new Tone.Part((time, value) => {
      if (!value) return
      triggerNote(value.midi, value.duration, time)
    }, scheduleEvents)

    part.start(0)
    transport.loop = false
    endEventId = transport.scheduleOnce(() => {
      onTransportEnd()
    }, durationSec)

    ready = true
    const startAt =
      resumeRatio > 0
        ? Math.min(durationSec * resumeRatio, Math.max(0, durationSec - 0.05))
        : 0
    writeScheduleSeconds(startAt)
    applyPlaybackTempo()
    emitProgress(durationSec > 0 ? startAt / durationSec : 0)

    if (wasPlaying && startAt < durationSec - 0.02) {
      await Tone.start()
      Tone.getTransport().start()
      emitState('playing')
      startProgressLoop()
    } else {
      emitState(startAt > 0 ? 'paused' : 'stopped')
      stopProgressLoop()
    }

    return {
      ready: true,
      durationSec,
      events: scheduleEvents,
      measures: scheduleMeasures,
      bpm: scoreBpm,
    }
  } finally {
    if (token === loadToken) loading = false
  }
}

export async function playScoreAudio() {
  if (!ready || !Tone) return
  if (instrument === AUDIO_INSTRUMENT_PIANO) {
    await ensurePiano()
  } else if (!isMidiInstrument(instrument)) {
    ensureSynth()
  }
  await Tone.start()
  if (readScheduleSeconds() >= durationSec - 0.02) {
    writeScheduleSeconds(0)
  }
  Tone.getTransport().start()
  emitState('playing')
  startProgressLoop()
}

export async function pauseScoreAudio() {
  if (!Tone) return
  Tone.getTransport().pause()
  releaseAllVoices()
  if (playState === 'playing') {
    emitState('paused')
  }
  stopProgressLoop()
  if (durationSec > 0) {
    emitProgress(readScheduleSeconds() / durationSec)
  }
}

export async function stopScoreAudio() {
  if (!Tone) return
  Tone.getTransport().pause()
  writeScheduleSeconds(0)
  releaseAllVoices()
  emitProgress(0)
  emitState('stopped')
  stopProgressLoop()
}

/**
 * @param {number} ratio 0~1
 * @param {{ resume?: boolean }} [opts]
 */
export async function seekScoreAudio(ratio, opts = {}) {
  if (!Tone || !ready || durationSec <= 0) return
  const wasPlaying = playState === 'playing' || opts.resume === true
  const next = Math.max(0, Math.min(1, Number(ratio) || 0)) * durationSec
  Tone.getTransport().pause()
  releaseAllVoices()
  writeScheduleSeconds(next)
  emitProgress(next / durationSec)
  if (wasPlaying && next < durationSec - 0.02) {
    await Tone.start()
    Tone.getTransport().start()
    emitState('playing')
    startProgressLoop()
  } else if (next >= durationSec - 0.02) {
    emitState('stopped')
    stopProgressLoop()
  } else {
    emitState(playState === 'stopped' ? 'stopped' : 'paused')
    stopProgressLoop()
  }
}

/**
 * @param {'synth' | 'piano' | string} id `midi:` 前缀表示电子琴输出端口
 */
export async function setScoreAudioInstrument(id) {
  const next =
    id === AUDIO_INSTRUMENT_PIANO
      ? AUDIO_INSTRUMENT_PIANO
      : isMidiInstrument(id)
        ? id
        : AUDIO_INSTRUMENT_SYNTH
  if (next === instrument) {
    return { instrument, loading: false }
  }
  if (next === AUDIO_INSTRUMENT_PIANO) {
    instrumentLoading = true
    try {
      await ensurePiano()
    } finally {
      instrumentLoading = false
    }
  } else if (next === AUDIO_INSTRUMENT_SYNTH) {
    ensureSynth()
  }
  releaseAllVoices()
  instrument = next
  return { instrument, loading: false }
}

export function getScoreAudioInstrument() {
  return instrument
}

export function getScoreAudioSchedule() {
  return {
    events: scheduleEvents,
    measures: scheduleMeasures,
    durationSec,
  }
}

/** 当前播放位置（秒）。未加载时为 0。 */
export function getScoreAudioSeconds() {
  if (!Tone || !ready) return 0
  return Math.max(0, readScheduleSeconds())
}

export function destroyScoreAudio() {
  loadToken += 1
  stopProgressLoop()
  if (Tone) {
    try {
      Tone.getTransport().stop()
      writeScheduleSeconds(0)
    } catch {
      /* ignore */
    }
  }
  clearPart()
  releaseAllVoices()
  if (synth) {
    try {
      synth.dispose()
    } catch {
      /* ignore */
    }
    synth = null
  }
  if (piano) {
    try {
      piano.dispose()
    } catch {
      /* ignore */
    }
    piano = null
  }
  pianoLoadPromise = null
  scheduleEvents = []
  scheduleMeasures = []
  durationSec = 0
  scoreBpm = 100
  playbackBpm = 0
  ready = false
  loading = false
  instrumentLoading = false
  instrument = AUDIO_INSTRUMENT_SYNTH
  emitProgress(0)
  emitState('stopped')
}

export function getScoreAudioState() {
  return {
    ready,
    loading,
    instrumentLoading,
    instrument,
    playing: playState === 'playing',
    paused: playState === 'paused',
    playState,
    durationSec,
    events: scheduleEvents,
    measures: scheduleMeasures,
    progress: readProgressRatio(),
  }
}

/** @param {(state: string) => void} cb */
export function onScoreAudioState(cb) {
  stateListener = typeof cb === 'function' ? cb : null
}

/** @param {(ratio: number) => void} cb */
export function onScoreAudioProgress(cb) {
  progressListener = typeof cb === 'function' ? cb : null
}
