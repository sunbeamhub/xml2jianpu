import { buildMusicXmlSchedule } from './musicXmlSchedule.js'

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
/** @type {Array<{ time: number, duration: number, midi: number }>} */
let scheduleEvents = []
let ready = false
let loading = false
let instrumentLoading = false
/** @type {'synth' | 'piano'} */
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

function tickProgress() {
  progressRaf = 0
  if (!Tone || !ready || durationSec <= 0) return
  const seconds = Tone.getTransport().seconds
  emitProgress(seconds / durationSec)
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
}

function triggerNote(midi, duration, time) {
  if (!Tone) return
  if (instrument === AUDIO_INSTRUMENT_PIANO && piano) {
    const note = Tone.Frequency(midi, 'midi').toNote()
    piano.triggerAttackRelease(note, duration, time)
    return
  }
  const active = ensureSynth()
  if (!active) return
  const freq = Tone.Frequency(midi, 'midi').toFrequency()
  active.triggerAttackRelease(freq, duration, time)
}

function onTransportEnd() {
  if (!Tone) return
  Tone.getTransport().pause()
  Tone.getTransport().seconds = 0
  releaseAllVoices()
  emitProgress(0)
  emitState('stopped')
  stopProgressLoop()
}

function readProgressRatio() {
  if (!Tone || durationSec <= 0) return 0
  return Math.max(0, Math.min(1, Tone.getTransport().seconds / durationSec))
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

    clearPart()
    durationSec = schedule.durationSec
    scheduleEvents = schedule.events.map((ev) => ({
      time: ev.time,
      duration: ev.duration,
      midi: ev.midi,
    }))

    part = new Tone.Part((time, value) => {
      if (!value) return
      triggerNote(value.midi, value.duration, time)
    }, scheduleEvents)

    part.start(0)
    Tone.getTransport().loop = false
    endEventId = Tone.getTransport().scheduleOnce(() => {
      onTransportEnd()
    }, durationSec)

    ready = true
    const startAt =
      resumeRatio > 0
        ? Math.min(durationSec * resumeRatio, Math.max(0, durationSec - 0.05))
        : 0
    Tone.getTransport().seconds = startAt
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
    }
  } finally {
    if (token === loadToken) loading = false
  }
}

export async function playScoreAudio() {
  if (!ready || !Tone) return
  if (instrument === AUDIO_INSTRUMENT_PIANO) {
    await ensurePiano()
  }
  await Tone.start()
  if (Tone.getTransport().seconds >= durationSec - 0.02) {
    Tone.getTransport().seconds = 0
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
    emitProgress(Tone.getTransport().seconds / durationSec)
  }
}

export async function stopScoreAudio() {
  if (!Tone) return
  Tone.getTransport().pause()
  Tone.getTransport().seconds = 0
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
  Tone.getTransport().seconds = next
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
 * @param {'synth' | 'piano'} id
 */
export async function setScoreAudioInstrument(id) {
  const next = id === AUDIO_INSTRUMENT_PIANO ? AUDIO_INSTRUMENT_PIANO : AUDIO_INSTRUMENT_SYNTH
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
  } else {
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
    durationSec,
  }
}

/** 当前播放位置（秒）。未加载时为 0。 */
export function getScoreAudioSeconds() {
  if (!Tone || !ready) return 0
  return Math.max(0, Number(Tone.getTransport().seconds) || 0)
}

export function destroyScoreAudio() {
  loadToken += 1
  stopProgressLoop()
  if (Tone) {
    try {
      Tone.getTransport().stop()
      Tone.getTransport().seconds = 0
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
  durationSec = 0
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
