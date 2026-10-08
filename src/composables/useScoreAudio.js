import { computed, ref } from "vue";
import { buildFollowSteps } from "../utils/musicXmlSchedule.js";
import {
  connectMidi,
  disconnectMidi,
  isWebMidiSupported,
  setMidiPanicEnabled,
  midiInstrumentId,
  midiPortIdFromInstrument,
  onMidiNotes,
  onMidiPorts,
} from "../utils/midiSession.js";
import { syncStaffCursor } from "../utils/osmdRenderer.js";
import { syncJianpuPlayheads } from "../utils/scoreHighlight.js";
import {
  AUDIO_INSTRUMENT_PIANO,
  AUDIO_INSTRUMENT_SYNTH,
  AUDIO_INSTRUMENTS,
  destroyScoreAudio,
  getScoreAudioSeconds,
  loadScoreAudio,
  onScoreAudioProgress,
  onScoreAudioState,
  pauseScoreAudio,
  playScoreAudio,
  seekScoreAudio,
  setScoreAudioInstrument,
  stopScoreAudio,
} from "../utils/scoreAudioPlayer.js";
import {
  persistMidiOutputName,
  persistFollowRhythm,
  persistFollowRhythmTolerance,
  persistDurationHudStyle,
  readStoredFollowRhythm,
  readStoredFollowRhythmTolerance,
  readStoredDurationHudStyle,
  readStoredMidiOutputName,
  FOLLOW_RHYTHM_TOLERANCES,
  DURATION_HUD_STYLES,
} from "../utils/viewerPrefs.js";

export function useScoreAudio(deps) {
  const { bridge, svg, transposeOpen, currentXml, fixedDo, transposeSemitones } = deps;

const audioReady = ref(false)
const audioPlaying = ref(false)
const audioPlayState = ref('stopped')
const audioProgress = ref(0)
const audioLoading = ref(false)
const audioInstrument = ref(AUDIO_INSTRUMENT_SYNTH)
const audioInstrumentLoading = ref(false)
const audioEvents = ref([])
const audioDuration = ref(0)
const midiSupported = isWebMidiSupported()
const midiPhase = ref('off')
const midiStatusText = ref('未连接设备')
const midiHasDevice = ref(false)
const midiFollow = ref(false)
const midiOutputs = ref([])
const followRhythm = ref(readStoredFollowRhythm())
const followRhythmTolerance = ref(readStoredFollowRhythmTolerance())
const followHudStyle = ref(readStoredDurationHudStyle())
/** @type {import('vue').Ref<{ ratio: number, status: 'holding' | 'ok' | 'short' | 'long' } | null>} */
const followDurationCue = ref(null)
/** @type {{ midi: number, start: number, durationMs: number } | null} */
let followCueNote = null
let followCueRaf = 0
/** @type {Array<{ time: number, notes: Array<{ midi: number, duration: number }> }>} */
let followSteps = []
let followIndex = 0
/** @type {Map<number, number>} */
let followHolds = new Map()
/** @type {Set<number>} */
let followPassed = new Set()
/** @type {Set<number>} */
let followFailed = new Set()
let followHoldTimer = 0
let followScoreEpoch = 0
let followScoreChangePending = false
let audioSeekDragging = false
let audioReloadTimer = 0
let audioLoadToken = 0
/** 拖进度前是否在播放，松手后决定是否继续 */
let audioWasPlayingBeforeSeek = false

function noteHighlightVisible() {
  if (midiFollow.value) return followSteps.length > 0
  if (!audioReady.value) return false
  if (audioPlayState.value === 'playing' || audioPlayState.value === 'paused') {
    return true
  }
  return getScoreAudioSeconds() > 0.02
}

function currentFollowStep() {
  if (!followSteps.length) return null
  if (followIndex < 0 || followIndex >= followSteps.length) return followSteps[0]
  return followSteps[followIndex]
}

function syncFollowHighlight() {
  const step = currentFollowStep()
  const visible = !!step
  const seconds = visible ? step.time : 0
  syncJianpuPlayheads(svg.value, seconds, visible)
  syncStaffCursor(seconds, visible)
  if (visible) bridge.followHighlight()
}

function clearFollowHolds() {
  followHolds = new Map()
  followPassed = new Set()
  followFailed = new Set()
  stopCueMotion()
  if (followHoldTimer) {
    clearTimeout(followHoldTimer)
    followHoldTimer = 0
  }
}

function stopCueMotion() {
  followCueNote = null
  if (followCueRaf) {
    cancelAnimationFrame(followCueRaf)
    followCueRaf = 0
  }
}

function publishDurationCue(ratio, status) {
  const value = Number(ratio)
  if (!Number.isFinite(value)) {
    followDurationCue.value = null
    return
  }
  followDurationCue.value = { ratio: Math.max(0, value), status }
}

const CUE_END_RATIO = 1.5

function shownCueRatio(ratio) {
  return Math.min(CUE_END_RATIO, Math.max(0, ratio))
}

function tickDurationCue() {
  followCueRaf = 0
  const note = followCueNote
  if (!note || !followRhythm.value || !midiFollow.value) return
  const ratio = (performance.now() - note.start) / note.durationMs
  if (followCueNote !== note) return
  publishDurationCue(shownCueRatio(ratio), note.over ? 'long' : 'holding')
  if (followCueNote !== note) return
  followCueRaf = requestAnimationFrame(tickDurationCue)
}

function startCueMotion(midi, start, durationSec) {
  followCueNote = {
    midi,
    start,
    durationMs: Math.max(1, (Number(durationSec) || 0) * 1000),
  }
  if (!followCueRaf) followCueRaf = requestAnimationFrame(tickDurationCue)
}

function toleranceRatio() {
  const found = FOLLOW_RHYTHM_TOLERANCES.find(
    (item) => item.value === followRhythmTolerance.value
  )
  return (found ? found.percent : 16) / 100
}

function durationWindow(note) {
  const dur = Math.max(0, Number(note.duration) || 0) * 1000
  const tol = dur * toleranceRatio()
  return { min: Math.max(0, dur - tol), max: dur + tol }
}

function chordDone(step) {
  return step.notes.every((item) => followPassed.has(item.midi))
}

function advanceFollowStep() {
  clearFollowHolds()
  if (!followSteps.length) return
  followIndex = followIndex >= followSteps.length - 1 ? 0 : followIndex + 1
  syncFollowHighlight()
}

function scheduleUpperBounds() {
  if (followHoldTimer) {
    clearTimeout(followHoldTimer)
    followHoldTimer = 0
  }
  if (!followRhythm.value || !midiFollow.value) return
  const step = followSteps[followIndex]
  if (!step) return
  let wait = Infinity
  const now = performance.now()
  for (const note of step.notes) {
    const start = followHolds.get(note.midi)
    if (start == null || followPassed.has(note.midi) || followFailed.has(note.midi)) {
      continue
    }
    const remain = durationWindow(note).max - (now - start)
    if (remain < wait) wait = remain
  }
  if (!Number.isFinite(wait)) return
  if (wait <= 0) {
    markOverheld()
    return
  }
  followHoldTimer = window.setTimeout(() => {
    followHoldTimer = 0
    markOverheld()
  }, wait)
}

function markOverheld() {
  const step = followSteps[followIndex]
  if (!step || !midiFollow.value) return
  const now = performance.now()
  for (const note of step.notes) {
    const start = followHolds.get(note.midi)
    if (start == null || followPassed.has(note.midi)) continue
    if (now - start >= durationWindow(note).max) {
      followHolds.delete(note.midi)
      followFailed.add(note.midi)
      if (followCueNote && followCueNote.midi === note.midi) {
        followCueNote.over = true
        const ratio = (now - followCueNote.start) / followCueNote.durationMs
        publishDurationCue(shownCueRatio(ratio), 'long')
      }
    }
  }
  scheduleUpperBounds()
}

function syncNoteHighlight() {
  if (midiFollow.value) {
    syncFollowHighlight()
    return
  }
  const visible = noteHighlightVisible()
  const seconds = visible ? getScoreAudioSeconds() : 0
  syncJianpuPlayheads(svg.value, seconds, visible)
  syncStaffCursor(seconds, visible)
  if (transposeOpen.value) {
    bridge.cancelFollowAnim()
    return
  }
  if (!audioSeekDragging) bridge.followHighlight()
}

function resetFollowSteps(events) {
  clearFollowHolds()
  followSteps = buildFollowSteps(events)
  followIndex = 0
  if (midiFollow.value) syncFollowHighlight()
}

function prepareFollowForScoreChange() {
  followScoreEpoch += 1
  followScoreChangePending = true
  clearFollowHolds()
  followSteps = []
  followIndex = 0
  followDurationCue.value = null
  if (midiFollow.value) syncFollowHighlight()
  return followScoreEpoch
}

async function settleFollowForScore(epochAtStart) {
  if (epochAtStart !== followScoreEpoch) return
  if (!followScoreChangePending) return
  followScoreChangePending = false
  if (!midiFollow.value || !currentXml.value) return
  await syncScoreAudio()
}

function onPracticeNote(msg) {
  if (!midiFollow.value) return
  const step = followSteps[followIndex]
  if (!step) return
  const midi = Number(msg.midi)
  const note = step.notes.find((item) => item.midi === midi)
  if (!note) return
  if (!followRhythm.value) {
    if (msg?.type !== 'on') return
    followPassed.add(midi)
    if (chordDone(step)) advanceFollowStep()
    return
  }
  if (msg?.type === 'off') {
    const start = followHolds.get(midi)
    followHolds.delete(midi)
    if (start == null || followFailed.has(midi)) {
      const failed = followFailed.has(midi)
      followFailed.delete(midi)
      if (failed && followCueNote && followCueNote.midi === midi) {
        const ratio = (performance.now() - followCueNote.start) / followCueNote.durationMs
        publishDurationCue(shownCueRatio(ratio), 'long')
        stopCueMotion()
      }
      return
    }
    const elapsed = performance.now() - start
    const windowMs = durationWindow(note)
    const ratio = note.duration > 0 ? elapsed / (note.duration * 1000) : 0
    if (elapsed > windowMs.max) {
      followFailed.add(midi)
      publishDurationCue(shownCueRatio(ratio), 'long')
      stopCueMotion()
      return
    }
    publishDurationCue(shownCueRatio(ratio), elapsed < windowMs.min ? 'short' : 'ok')
    stopCueMotion()
    if (elapsed < windowMs.min) return
    followPassed.add(midi)
    if (chordDone(step)) advanceFollowStep()
    return
  }
  if (msg?.type !== 'on' || followPassed.has(midi)) return
  followFailed.delete(midi)
  if (!followHolds.has(midi)) {
    const now = performance.now()
    followHolds.set(midi, now)
    startCueMotion(midi, now, note.duration)
  }
  scheduleUpperBounds()
}

function onFollowRhythm(on) {
  const next = !!on
  if (next === followRhythm.value) return
  followRhythm.value = next
  persistFollowRhythm(next)
  clearFollowHolds()
  followDurationCue.value = null
}

function onFollowRhythmTolerance(value) {
  const found = FOLLOW_RHYTHM_TOLERANCES.some((item) => item.value === value)
  if (!found || value === followRhythmTolerance.value) return
  followRhythmTolerance.value = value
  persistFollowRhythmTolerance(value)
  clearFollowHolds()
}

function onFollowHudStyle(value) {
  const found = DURATION_HUD_STYLES.some((item) => item.value === value)
  if (!found || value === followHudStyle.value) return
  followHudStyle.value = value
  persistDurationHudStyle(value)
}

function deviceNames(inputs, outputs) {
  const names = []
  for (const port of [...(inputs || []), ...(outputs || [])]) {
    const name = port?.name
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

function applyMidiPorts(snapshot, restore) {
  const outputs = snapshot?.outputs || []
  const inputs = snapshot?.inputs || []
  midiOutputs.value = outputs
  const names = deviceNames(inputs, outputs)
  midiHasDevice.value = names.length > 0
  if (!names.length) {
    midiStatusText.value = '未连接设备'
    if (midiFollow.value) {
      midiFollow.value = false
      setMidiPanicEnabled(true)
      clearFollowHolds()
      followDurationCue.value = null
    }
    if (midiPortIdFromInstrument(audioInstrument.value)) {
      void selectInstrument(AUDIO_INSTRUMENT_SYNTH, { keepMidiPref: true })
    }
    syncNoteHighlight()
    return
  }
  midiPhase.value = 'on'
  midiStatusText.value =
    names.length === 1 ? `已连接 · ${names[0]}` : `已连接 · ${names.length} 台`
  const currentPort = midiPortIdFromInstrument(audioInstrument.value)
  const saved = readStoredMidiOutputName()
  const savedPort = saved ? outputs.find((port) => port.name === saved) : null
  if (currentPort && !outputs.some((port) => port.id === currentPort)) {
    void selectInstrument(
      savedPort ? midiInstrumentId(savedPort.id) : AUDIO_INSTRUMENT_SYNTH,
      { keepMidiPref: !savedPort }
    )
    return
  }
  if (restore && !currentPort && savedPort) {
    void selectInstrument(midiInstrumentId(savedPort.id))
  }
}

onMidiPorts((snapshot) => {
  if (midiPhase.value !== 'on') return
  applyMidiPorts(snapshot, false)
})
onMidiNotes(onPracticeNote)

onScoreAudioState((state) => {
  audioPlayState.value = state || 'stopped'
  audioPlaying.value = state === 'playing'
  syncNoteHighlight()
})
onScoreAudioProgress((ratio) => {
  if (audioSeekDragging) return
  audioProgress.value = ratio
  syncNoteHighlight()
})

function audioTransposeSemitones() {
  return fixedDo.value ? transposeSemitones.value : 0
}

async function syncScoreAudio(opts = {}) {
  const xml = currentXml.value
  if (!xml) {
    await stopScoreAudio()
    audioReady.value = false
    audioProgress.value = 0
    audioPlaying.value = false
    audioPlayState.value = 'stopped'
    audioEvents.value = []
    audioDuration.value = 0
    resetFollowSteps([])
    syncNoteHighlight()
    return
  }
  const token = ++audioLoadToken
  const resume = opts.resume === true || (opts.resumeIfPlaying && audioPlaying.value)
  const resumeRatio = audioProgress.value
  audioLoading.value = true
  try {
    const result = await loadScoreAudio(xml, {
      transposeSemitones: audioTransposeSemitones(),
      resume,
      resumeRatio,
    })
    if (token !== audioLoadToken) return
    audioReady.value = !!result?.ready
    audioEvents.value = result?.events || []
    audioDuration.value = Number(result?.durationSec) || 0
    resetFollowSteps(audioEvents.value)
    if (!resume) {
      // 进度由 loadScoreAudio 的 emitProgress 回写；此处仅在非续播时清播放态标记
      if (resumeRatio <= 0) {
        audioProgress.value = 0
        audioPlaying.value = false
      }
    }
    if (opts.autoPlay && audioReady.value && !resume) {
      await playScoreAudio()
    }
  } catch (err) {
    if (token !== audioLoadToken) return
    console.error('[score-audio]', err)
    audioReady.value = false
    audioPlaying.value = false
    audioProgress.value = 0
    audioEvents.value = []
    audioDuration.value = 0
  } finally {
    if (token === audioLoadToken) {
      audioLoading.value = false
      syncNoteHighlight()
    }
  }
}

function scheduleScoreAudioReload() {
  if (audioReloadTimer) clearTimeout(audioReloadTimer)
  audioReloadTimer = window.setTimeout(() => {
    audioReloadTimer = 0
    void syncScoreAudio({ resumeIfPlaying: true })
  }, 280)
}

async function ensureScoreAudioLoaded() {
  if (audioReady.value || audioLoading.value) return
  if (!currentXml.value) return
  await syncScoreAudio()
}

async function onAudioToggle() {
  if (midiFollow.value) return
  await ensureScoreAudioLoaded()
  if (!audioReady.value) return
  if (audioPlaying.value) {
    await pauseScoreAudio()
  } else {
    await playScoreAudio()
  }
}

async function onAudioStop() {
  await stopScoreAudio()
}

async function selectInstrument(id, opts = {}) {
  const portId = midiPortIdFromInstrument(id)
  const port = portId
    ? midiOutputs.value.find((item) => item.id === portId)
    : null
  const next = port
    ? midiInstrumentId(port.id)
    : id === AUDIO_INSTRUMENT_PIANO
      ? AUDIO_INSTRUMENT_PIANO
      : AUDIO_INSTRUMENT_SYNTH
  if (next === audioInstrument.value) return
  audioInstrumentLoading.value = true
  try {
    await setScoreAudioInstrument(next)
    audioInstrument.value = next
    if (!opts.keepMidiPref) persistMidiOutputName(port ? port.name : '')
  } catch (err) {
    console.error('[score-audio-instrument]', err)
  } finally {
    audioInstrumentLoading.value = false
  }
}

async function onAudioInstrument(id) {
  await selectInstrument(id)
}

async function onMidiConnect() {
  if (!midiSupported || midiPhase.value === 'connecting' || midiPhase.value === 'on') {
    return
  }
  midiPhase.value = 'connecting'
  midiStatusText.value = '搜索设备中…'
  try {
    const result = await connectMidi()
    if (midiPhase.value !== 'connecting') return
    if (!result?.ok) {
      midiPhase.value = 'off'
      midiStatusText.value = '未连接设备'
      midiHasDevice.value = false
      midiOutputs.value = []
      return
    }
    midiPhase.value = 'on'
    applyMidiPorts(result, true)
  } catch (err) {
    console.error('[midi]', err)
    if (midiPhase.value !== 'connecting') return
    midiPhase.value = 'off'
    midiStatusText.value = '未连接设备'
    midiHasDevice.value = false
    midiOutputs.value = []
  }
}

async function onMidiDisconnect() {
  midiFollow.value = false
  setMidiPanicEnabled(true)
  clearFollowHolds()
  if (midiPortIdFromInstrument(audioInstrument.value)) {
    await selectInstrument(AUDIO_INSTRUMENT_SYNTH, { keepMidiPref: true })
  }
  await disconnectMidi()
  midiPhase.value = 'off'
  midiStatusText.value = '未连接设备'
  midiHasDevice.value = false
  midiOutputs.value = []
  syncNoteHighlight()
}

async function onMidiFollow(on) {
  const next = !!on
  if (next && !(midiPhase.value === 'on' && midiHasDevice.value)) return
  if (next === midiFollow.value) return
  if (!next) {
    midiFollow.value = false
    setMidiPanicEnabled(true)
    clearFollowHolds()
    followDurationCue.value = null
    syncNoteHighlight()
    return
  }
  await stopScoreAudio()
  setMidiPanicEnabled(false)
  midiFollow.value = true
  clearFollowHolds()
  followIndex = 0
  audioProgress.value = 0
  audioPlaying.value = false
  await ensureScoreAudioLoaded()
  clearFollowHolds()
  followIndex = 0
  syncNoteHighlight()
}

async function onAudioSeek(ratio, meta = {}) {
  if (midiFollow.value) return
  const dragging = !!meta.dragging
  if (dragging) {
    if (!audioSeekDragging) {
      audioWasPlayingBeforeSeek = audioPlaying.value
      audioSeekDragging = true
      if (audioPlaying.value) await pauseScoreAudio()
    }
    audioProgress.value = Math.max(0, Math.min(1, Number(ratio) || 0))
    await seekScoreAudio(audioProgress.value, { resume: false })
    syncNoteHighlight()
    return
  }
  audioSeekDragging = false
  audioProgress.value = Math.max(0, Math.min(1, Number(ratio) || 0))
  await seekScoreAudio(audioProgress.value, {
    resume: audioWasPlayingBeforeSeek,
  })
  audioWasPlayingBeforeSeek = false
  syncNoteHighlight()
}

  function resetScoreAudio() {
    if (audioReloadTimer) {
      clearTimeout(audioReloadTimer);
      audioReloadTimer = 0;
    }
    void stopScoreAudio();
    audioReady.value = false;
    audioPlaying.value = false;
    audioProgress.value = 0;
    audioLoading.value = false;
    audioInstrumentLoading.value = false;
    audioEvents.value = [];
    audioDuration.value = 0;
    prepareFollowForScoreChange();
  }

  function disposeAudio() {
    midiFollow.value = false;
    setMidiPanicEnabled(true);
    onMidiNotes(null);
    onMidiPorts(null);
    void disconnectMidi();
    resetScoreAudio();
    destroyScoreAudio();
    onScoreAudioState(null);
    onScoreAudioProgress(null);
    audioInstrument.value = AUDIO_INSTRUMENT_SYNTH;
    audioEvents.value = [];
    audioDuration.value = 0;
    midiPhase.value = 'off';
    midiHasDevice.value = false;
    midiOutputs.value = [];
  }

  const audioInstrumentOptions = computed(() => [
    ...AUDIO_INSTRUMENTS,
    ...midiOutputs.value.map((port) => ({
      value: midiInstrumentId(port.id),
      label: port.label || port.name,
    })),
  ])

  return {
    audioReady,
    audioPlaying,
    audioPlayState,
    audioProgress,
    audioLoading,
    audioInstrument,
    audioInstrumentLoading,
    audioEvents,
    audioDuration,
    noteHighlightVisible,
    syncNoteHighlight,
    syncScoreAudio,
    scheduleScoreAudioReload,
    ensureScoreAudioLoaded,
    onAudioToggle,
    onAudioStop,
    audioInstrumentOptions,
    midiSupported,
    midiPhase,
    midiStatusText,
    midiHasDevice,
    midiFollow,
    followRhythm,
    followRhythmTolerance,
    followHudStyle,
    followDurationCue,
    onFollowRhythm,
    onFollowRhythmTolerance,
    onFollowHudStyle,
    onMidiConnect,
    onMidiDisconnect,
    onMidiFollow,
    onAudioInstrument,
    onAudioSeek,
    resetScoreAudio,
    disposeAudio,
    followScoreEpoch: () => followScoreEpoch,
    settleFollowForScore,
  };
}
