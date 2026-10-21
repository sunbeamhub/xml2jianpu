import { computed, ref } from "vue";
import { buildFollowSteps, clampPlaybackBpm } from "../utils/musicXmlSchedule.js";
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
import { syncStaffBeatLine, syncStaffCursor } from "../utils/osmdRenderer.js";
import { syncJianpuBeatLine, syncJianpuPlayheads } from "../utils/scoreHighlight.js";
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
  setScorePlaybackTempo,
  stopScoreAudio,
} from "../utils/scoreAudioPlayer.js";
import {
  persistMidiOutputName,
  persistFollowRhythm,
  persistFollowRhythmTolerance,
  persistFollowOnset,
  persistFollowOnsetTolerance,
  persistDurationHudStyle,
  readStoredFollowRhythm,
  readStoredFollowRhythmTolerance,
  readStoredFollowOnset,
  readStoredFollowOnsetTolerance,
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
const audioMeasures = ref([])
const audioDuration = ref(0)
const measureCount = computed(() => Math.max(1, audioMeasures.value.length || 1))
const followStartMeasure = ref(1)
const followEndMeasure = ref(1)
const midiSupported = isWebMidiSupported()
const midiPhase = ref('off')
const midiStatusText = ref('未连接设备')
const midiHasDevice = ref(false)
const midiFollow = ref(false)
const midiOutputs = ref([])
const followRhythm = ref(readStoredFollowRhythm())
const followRhythmTolerance = ref(readStoredFollowRhythmTolerance())
const followOnset = ref(readStoredFollowOnset())
const followOnsetTolerance = ref(readStoredFollowOnsetTolerance())
if (followOnset.value && !followRhythm.value) {
  followRhythm.value = true
  persistFollowRhythm(true)
}
const followHudStyle = ref(readStoredDurationHudStyle())
const scoreBpm = ref(100)
const playbackBpm = ref(100)
/** @type {import('vue').Ref<{ ratio: number, status: 'holding' | 'ok' | 'short' | 'long' } | null>} */
const followDurationCue = ref(null)
/** @type {import('vue').Ref<{ ratio: number, status: 'holding' | 'ok' | 'early' | 'late' } | null>} */
const followOnsetCue = ref(null)
const followCountdown = ref(0)
/** @type {{ midi: number, start: number, scheduleSec: number } | null} */
let followCueNote = null
let followCueRaf = 0
/** @type {Array<{ key: string, time: number, measureIndex: number, beatSec: number, notes: Array<{ midi: number, duration: number }> }>} */
let followSteps = []
let followIndex = 0
/** @type {Map<number, any>} */
let followHolds = new Map()
/** @type {Set<number>} */
let followPassed = new Set()
/** @type {Set<number>} */
let followFailed = new Set()
/** 本轮已出错的步骤 key 集合（保留红色高亮直到新一轮重置） */
/** @type {Set<string>} */
let failedStepKeys = new Set()
/** 落点判定模式下每一步已落点命中的音符集合 */
/** @type {Map<number, Set<number>>} */
let onsetStepHits = new Map()
let followHoldTimer = 0
let followScoreEpoch = 0
let followScoreChangePending = false
let tempoXmlKey = null
let onsetRunning = false
let onsetOrigin = 0
let onsetRate = 1
let onsetRaf = 0
let onsetLockIndex = -1
let countdownTimer = 0
let audioSeekDragging = false
let audioReloadTimer = 0
let audioLoadToken = 0
/** 拖进度前是否在播放，松手后决定是否继续 */
let audioWasPlayingBeforeSeek = false

function rangeBoundsSec() {
  const list = audioMeasures.value
  if (!list.length) {
    return {
      startSec: 0,
      endSec: Math.max(0.05, Number(audioDuration.value) || 0.05),
    }
  }
  const sIdx = Math.max(
    0,
    Math.min(list.length - 1, (Number(followStartMeasure.value) || 1) - 1)
  )
  const eIdx = Math.max(
    sIdx,
    Math.min(list.length - 1, (Number(followEndMeasure.value) || list.length) - 1)
  )
  const startSec = Math.max(0, Number(list[sIdx]?.startSec) || 0)
  const endSec = Math.max(
    startSec + 0.05,
    Number(list[eIdx]?.endSec) || Number(audioDuration.value) || startSec + 0.05
  )
  return { startSec, endSec }
}

function stepKeyOf(step) {
  if (!step) return ''
  if (typeof step.key === 'string' && step.key) return step.key
  return Number(step.time || 0).toFixed(4)
}

function markStepFailed(step) {
  const key = stepKeyOf(step)
  if (!key) return
  if (!failedStepKeys.has(key)) {
    failedStepKeys.add(key)
  }
  syncFollowPlayheadsOnly()
}

function syncFollowPlayheadsOnly() {
  const step = currentFollowStep()
  const visible = !!step
  const seconds = visible ? step.time : 0
  syncJianpuPlayheads(svg.value, seconds, visible, failedStepKeys)
  syncStaffCursor(seconds, visible, failedStepKeys)
}

function syncBeatIndicator(scoreSec, visible) {
  syncJianpuBeatLine(svg.value, scoreSec, visible)
  syncStaffBeatLine(scoreSec, visible)
}

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
  syncJianpuPlayheads(svg.value, seconds, visible, failedStepKeys)
  syncStaffCursor(seconds, visible, failedStepKeys)
  if (midiFollow.value && followOnset.value) {
    const { startSec } = rangeBoundsSec()
    const lineSec = onsetRunning ? scoreSecNow() : startSec
    syncBeatIndicator(lineSec, visible)
  } else {
    syncBeatIndicator(0, false)
  }
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
  const ratio = (performance.now() - note.start) / cueDurationMs(note)
  if (followCueNote !== note) return
  publishDurationCue(shownCueRatio(ratio), note.over ? 'long' : 'holding')
  if (followCueNote !== note) return
  followCueRaf = requestAnimationFrame(tickDurationCue)
}

function startCueMotion(midi, start, durationSec) {
  followCueNote = {
    midi,
    start,
    scheduleSec: Math.max(0.001, Number(durationSec) || 0),
  }
  if (!followCueRaf) followCueRaf = requestAnimationFrame(tickDurationCue)
}

function tempoRate() {
  const score = Math.max(1, Number(scoreBpm.value) || 1)
  const play = Math.max(1, Number(playbackBpm.value) || score)
  return play / score
}

function realScale() {
  return 1 / tempoRate()
}

function toleranceRatio() {
  const found = FOLLOW_RHYTHM_TOLERANCES.find(
    (item) => item.value === followRhythmTolerance.value
  )
  return (found ? found.percent : 16) / 100
}

function onsetToleranceRatio() {
  const found = FOLLOW_RHYTHM_TOLERANCES.find(
    (item) => item.value === followOnsetTolerance.value
  )
  return (found ? found.percent : 16) / 100
}

function durationWindow(note) {
  const dur = Math.max(0, Number(note.duration) || 0) * 1000 * realScale()
  const tol = dur * toleranceRatio()
  return { min: Math.max(0, dur - tol), max: dur + tol }
}

function cueDurationMs(note) {
  return Math.max(1, (Number(note?.scheduleSec) || 0) * 1000 * realScale())
}

function beatScheduleSec(step) {
  const beat = Number(step?.beatSec)
  if (beat > 0) return beat
  return 60 / Math.max(1, Number(scoreBpm.value) || 1)
}

function chordDone(step) {
  return step.notes.every((item) => followPassed.has(item.midi))
}

function advanceFollowStep() {
  clearFollowHolds()
  if (!followSteps.length) return
  if (followIndex >= followSteps.length - 1) {
    failedStepKeys = new Set()
    onsetStepHits = new Map()
    followIndex = 0
  } else {
    followIndex += 1
  }
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
      markStepFailed(step)
      if (followCueNote && followCueNote.midi === note.midi) {
        followCueNote.over = true
        const ratio = (now - followCueNote.start) / cueDurationMs(followCueNote)
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
  syncJianpuPlayheads(svg.value, seconds, visible, null)
  syncStaffCursor(seconds, visible, null)
  syncBeatIndicator(0, false)
  if (transposeOpen.value) {
    bridge.cancelFollowAnim()
    return
  }
  if (!audioSeekDragging) bridge.followHighlight()
}

function resetFollowSteps(events) {
  clearFollowHolds()
  failedStepKeys = new Set()
  onsetStepHits = new Map()
  followSteps = buildFollowSteps(events, {
    startMeasure: followStartMeasure.value,
    endMeasure: followEndMeasure.value,
  })
  followIndex = 0
  if (midiFollow.value) syncFollowHighlight()
}

function stopOnsetMotion() {
  onsetRunning = false
  onsetLockIndex = -1
  if (onsetRaf) {
    cancelAnimationFrame(onsetRaf)
    onsetRaf = 0
  }
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = 0
  }
  followCountdown.value = 0
  syncBeatIndicator(0, false)
}

function scoreSecNow() {
  const rate = Math.max(0.01, onsetRate)
  return ((performance.now() - onsetOrigin) / 1000) * rate
}

function stepIndexAt(scoreSec) {
  let index = 0
  for (let i = 0; i < followSteps.length; i += 1) {
    if (followSteps[i].time <= scoreSec + 1e-4) index = i
    else break
  }
  return index
}

function publishLiveOnset(scoreSec) {
  if (onsetLockIndex >= 0) return
  const step = followSteps[followIndex]
  if (!step) return
  const beat = beatScheduleSec(step)
  const ratio = 1 + (scoreSec - step.time) / beat
  followOnsetCue.value = { ratio: shownCueRatio(ratio), status: 'holding' }
}

function markOnsetOverheld() {
  if (!followRhythm.value) return
  const now = performance.now()
  for (const [midi, rec] of followHolds) {
    if (!rec || typeof rec.start !== 'number') continue
    const windowMs = durationWindow({ duration: rec.duration })
    if (now - rec.start < windowMs.max) continue
    followHolds.delete(midi)
    if (rec.step) markStepFailed(rec.step)
    const ratio =
      rec.duration > 0 ? (now - rec.start) / (rec.duration * 1000 * realScale()) : 0
    publishDurationCue(shownCueRatio(ratio), 'long')
    if (followCueNote && followCueNote.midi === midi) stopCueMotion()
  }
}

function checkMissedOnsetSteps(scoreSec) {
  const tolRatio = onsetToleranceRatio()
  for (let i = 0; i <= followIndex && i < followSteps.length; i++) {
    const step = followSteps[i]
    if (!step) continue
    const key = stepKeyOf(step)
    if (failedStepKeys.has(key)) continue
    const deadlineSec = step.time + beatScheduleSec(step) * tolRatio
    if (scoreSec <= deadlineSec) continue
    const hits = onsetStepHits.get(i)
    const allHit = step.notes.every((n) => hits && hits.has(n.midi))
    if (!allHit) {
      markStepFailed(step)
    }
  }
}

function tickOnset() {
  onsetRaf = 0
  if (!onsetRunning || !midiFollow.value || !followOnset.value) return
  const scoreSec = scoreSecNow()
  const { endSec } = rangeBoundsSec()
  if (endSec > 0.05 && scoreSec >= endSec) {
    beginOnsetCountdown()
    return
  }
  const index = stepIndexAt(scoreSec)
  if (onsetLockIndex >= 0 && index > onsetLockIndex) onsetLockIndex = -1
  if (index !== followIndex) {
    followIndex = index
    syncFollowPlayheadsOnly()
  }
  syncBeatIndicator(scoreSec, true)
  bridge.followHighlight()
  checkMissedOnsetSteps(scoreSec)
  if (followRhythm.value) markOnsetOverheld()
  publishLiveOnset(scoreSec)
  onsetRaf = requestAnimationFrame(tickOnset)
}

function startOnsetClock(scoreSec) {
  if (!midiFollow.value || !followOnset.value || !followSteps.length) return
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = 0
    followCountdown.value = 0
  }
  const { startSec } = rangeBoundsSec()
  const originSec = scoreSec != null ? Math.max(startSec, Number(scoreSec) || 0) : startSec
  onsetRate = tempoRate()
  const rate = Math.max(0.01, onsetRate)
  onsetOrigin = performance.now() - (originSec / rate) * 1000
  onsetRunning = true
  onsetLockIndex = -1
  syncFollowHighlight()
  if (!onsetRaf) onsetRaf = requestAnimationFrame(tickOnset)
}

function rebaseOnsetClock() {
  if (!onsetRunning) return
  const scoreSec = scoreSecNow()
  onsetRate = tempoRate()
  const rate = Math.max(0.01, onsetRate)
  onsetOrigin = performance.now() - (scoreSec / rate) * 1000
}

function beginOnsetCountdown() {
  stopOnsetMotion()
  followOnsetCue.value = null
  followDurationCue.value = null
  clearFollowHolds()
  failedStepKeys = new Set()
  onsetStepHits = new Map()
  followIndex = 0
  if (midiFollow.value) syncFollowHighlight()
  if (!midiFollow.value || !followOnset.value || !followSteps.length) return
  let left = 6
  followCountdown.value = left
  countdownTimer = window.setInterval(() => {
    left -= 1
    if (left <= 0) {
      clearInterval(countdownTimer)
      countdownTimer = 0
      followCountdown.value = 0
      const { startSec } = rangeBoundsSec()
      startOnsetClock(startSec)
      return
    }
    followCountdown.value = left
  }, 1000)
}

function prepareFollowForScoreChange() {
  followScoreEpoch += 1
  followScoreChangePending = true
  clearFollowHolds()
  failedStepKeys = new Set()
  onsetStepHits = new Map()
  followSteps = []
  followIndex = 0
  followDurationCue.value = null
  followOnsetCue.value = null
  stopOnsetMotion()
  if (midiFollow.value) syncFollowHighlight()
  return followScoreEpoch
}

async function settleFollowForScore(epochAtStart) {
  if (epochAtStart !== followScoreEpoch) return
  if (!followScoreChangePending) return
  followScoreChangePending = false
  if (!midiFollow.value || !currentXml.value) return
  await syncScoreAudio({ restartOnset: true })
}

function nearestOnsetStep(midi, now) {
  let best = null
  const from = Math.max(0, followIndex - 1)
  const to = Math.min(followSteps.length - 1, followIndex + 1)
  const rate = Math.max(0.01, onsetRate)
  for (let i = from; i <= to; i += 1) {
    const step = followSteps[i]
    if (!step?.notes.some((item) => item.midi === midi)) continue
    const onset = onsetOrigin + (step.time / rate) * 1000
    const abs = Math.abs(now - onset)
    if (!best || abs < best.abs) best = { step, index: i, onset, abs }
  }
  return best
}

function onOnsetPractice(msg) {
  const midi = Number(msg.midi)
  const now = performance.now()
  if (msg?.type === 'off') {
    if (!followRhythm.value) return
    const rec = followHolds.get(midi)
    followHolds.delete(midi)
    if (!rec || typeof rec.start !== 'number') return
    const elapsed = now - rec.start
    const windowMs = durationWindow({ duration: rec.duration })
    const ratio =
      rec.duration > 0 ? elapsed / (rec.duration * 1000 * realScale()) : 0
    if (elapsed > windowMs.max) {
      if (rec.step) markStepFailed(rec.step)
      publishDurationCue(shownCueRatio(ratio), 'long')
    } else if (elapsed < windowMs.min) {
      if (rec.step) markStepFailed(rec.step)
      publishDurationCue(shownCueRatio(ratio), 'short')
    } else {
      publishDurationCue(shownCueRatio(ratio), 'ok')
    }
    stopCueMotion()
    return
  }
  if (msg?.type !== 'on') return
  const hit = nearestOnsetStep(midi, now)
  if (!hit) {
    const curStep = followSteps[followIndex]
    if (curStep) markStepFailed(curStep)
    return
  }
  let hits = onsetStepHits.get(hit.index)
  if (!hits) {
    hits = new Set()
    onsetStepHits.set(hit.index, hits)
  }
  hits.add(midi)
  const beatMs = beatScheduleSec(hit.step) * realScale() * 1000
  const delta = now - hit.onset
  const tol = beatMs * onsetToleranceRatio()
  const ratio = beatMs > 0 ? 1 + delta / beatMs : 1
  let status = 'ok'
  if (delta < -tol) status = 'early'
  else if (delta > tol) status = 'late'
  if (status !== 'ok') {
    markStepFailed(hit.step)
  }
  onsetLockIndex = hit.index
  followOnsetCue.value = { ratio: shownCueRatio(ratio), status }
  if (!followRhythm.value) return
  const note = hit.step.notes.find((item) => item.midi === midi)
  followHolds.set(midi, { start: now, duration: note?.duration || 0, step: hit.step })
  startCueMotion(midi, now, note?.duration || 0)
}

function onPracticeNote(msg) {
  if (!midiFollow.value) return
  if (followOnset.value) {
    if (!onsetRunning || followCountdown.value > 0) return
    onOnsetPractice(msg)
    return
  }
  const step = followSteps[followIndex]
  if (!step) return
  const midi = Number(msg.midi)
  const note = step.notes.find((item) => item.midi === midi)
  if (!note) {
    if (msg?.type === 'on') markStepFailed(step)
    return
  }
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
        const ratio = (performance.now() - followCueNote.start) / cueDurationMs(followCueNote)
        publishDurationCue(shownCueRatio(ratio), 'long')
        stopCueMotion()
      }
      return
    }
    const elapsed = performance.now() - start
    const windowMs = durationWindow(note)
    const ratio = note.duration > 0 ? elapsed / (note.duration * 1000 * realScale()) : 0
    if (elapsed > windowMs.max) {
      followFailed.add(midi)
      markStepFailed(step)
      publishDurationCue(shownCueRatio(ratio), 'long')
      stopCueMotion()
      return
    }
    publishDurationCue(shownCueRatio(ratio), elapsed < windowMs.min ? 'short' : 'ok')
    stopCueMotion()
    if (elapsed < windowMs.min) {
      markStepFailed(step)
      return
    }
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
  if (followOnset.value && !next) return
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

function onFollowOnset(on) {
  const next = !!on
  if (next === followOnset.value) return
  followOnset.value = next
  persistFollowOnset(next)
  followOnsetCue.value = null
  if (next && !followRhythm.value) {
    followRhythm.value = true
    persistFollowRhythm(true)
  }
  if (!next) {
    stopOnsetMotion()
    clearFollowHolds()
    failedStepKeys = new Set()
    onsetStepHits = new Map()
    followIndex = 0
    if (midiFollow.value) syncFollowHighlight()
    return
  }
  if (midiFollow.value) beginOnsetCountdown()
}

function onFollowOnsetTolerance(value) {
  const found = FOLLOW_RHYTHM_TOLERANCES.some((item) => item.value === value)
  if (!found || value === followOnsetTolerance.value) return
  followOnsetTolerance.value = value
  persistFollowOnsetTolerance(value)
  onsetLockIndex = -1
  followOnsetCue.value = null
}

function onPlaybackBpm(value) {
  const next = clampPlaybackBpm(value)
  if (next === playbackBpm.value) return
  playbackBpm.value = next
  setScorePlaybackTempo(scoreBpm.value, next)
  rebaseOnsetClock()
  if (followRhythm.value && midiFollow.value && !followOnset.value) scheduleUpperBounds()
}

function onFollowHudStyle(value) {
  const found = DURATION_HUD_STYLES.some((item) => item.value === value)
  if (!found || value === followHudStyle.value) return
  followHudStyle.value = value
  persistDurationHudStyle(value)
}

function onFollowRange(range) {
  const total = measureCount.value
  const rawStart = Math.max(1, Math.min(total, Math.round(Number(range?.start) || 1)))
  const rawEnd = Math.max(rawStart, Math.min(total, Math.round(Number(range?.end) || total)))
  if (rawStart === followStartMeasure.value && rawEnd === followEndMeasure.value) {
    return
  }
  followStartMeasure.value = rawStart
  followEndMeasure.value = rawEnd
  stopOnsetMotion()
  followOnsetCue.value = null
  followDurationCue.value = null
  resetFollowSteps(audioEvents.value)
  if (midiFollow.value && followOnset.value && followSteps.length) {
    beginOnsetCountdown()
  }
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
      followOnsetCue.value = null
      stopOnsetMotion()
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
    audioMeasures.value = []
    audioDuration.value = 0
    followStartMeasure.value = 1
    followEndMeasure.value = 1
    tempoXmlKey = ''
    stopOnsetMotion()
    resetFollowSteps([])
    syncNoteHighlight()
    return
  }
  const token = ++audioLoadToken
  const resume = opts.resume === true || (opts.resumeIfPlaying && audioPlaying.value)
  const resumeRatio = audioProgress.value
  const xmlChanged = xml !== tempoXmlKey
  audioLoading.value = true
  try {
    const result = await loadScoreAudio(xml, {
      transposeSemitones: audioTransposeSemitones(),
      resume,
      resumeRatio,
      playbackBpm: xmlChanged ? null : playbackBpm.value,
    })
    if (token !== audioLoadToken) return
    audioReady.value = !!result?.ready
    audioEvents.value = result?.events || []
    audioMeasures.value = Array.isArray(result?.measures) ? result.measures : []
    audioDuration.value = Number(result?.durationSec) || 0
    const totalM = Math.max(1, audioMeasures.value.length || 1)
    if (xmlChanged) {
      followStartMeasure.value = 1
      followEndMeasure.value = totalM
    } else {
      followStartMeasure.value = Math.max(
        1,
        Math.min(totalM, followStartMeasure.value)
      )
      followEndMeasure.value = Math.max(
        followStartMeasure.value,
        Math.min(totalM, followEndMeasure.value)
      )
    }
    if (result?.ready) {
      const loadedBpm = Number(result?.bpm) > 0 ? Number(result.bpm) : 100
      scoreBpm.value = loadedBpm
      if (xmlChanged) playbackBpm.value = clampPlaybackBpm(loadedBpm)
      tempoXmlKey = xml
      setScorePlaybackTempo(scoreBpm.value, playbackBpm.value)
    }
    const wasRunning = onsetRunning
    resetFollowSteps(audioEvents.value)
    if (opts.restartOnset && midiFollow.value && followOnset.value && followSteps.length) {
      beginOnsetCountdown()
    } else if (wasRunning && midiFollow.value && followOnset.value && followSteps.length) {
      const { startSec } = rangeBoundsSec()
      startOnsetClock(startSec)
    }
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
    audioMeasures.value = []
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
  failedStepKeys = new Set()
  onsetStepHits = new Map()
  followOnsetCue.value = null
  stopOnsetMotion()
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
    failedStepKeys = new Set()
    onsetStepHits = new Map()
    followDurationCue.value = null
    followOnsetCue.value = null
    stopOnsetMotion()
    syncNoteHighlight()
    return
  }
  await stopScoreAudio()
  setMidiPanicEnabled(false)
  midiFollow.value = true
  clearFollowHolds()
  failedStepKeys = new Set()
  onsetStepHits = new Map()
  followIndex = 0
  audioProgress.value = 0
  audioPlaying.value = false
  if (!audioReady.value) await syncScoreAudio()
  resetFollowSteps(audioEvents.value)
  syncNoteHighlight()
  if (followOnset.value) beginOnsetCountdown()
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
    audioMeasures.value = [];
    audioDuration.value = 0;
    followStartMeasure.value = 1;
    followEndMeasure.value = 1;
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
    audioMeasures.value = [];
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
    scoreBpm,
    playbackBpm,
    followRhythm,
    followRhythmTolerance,
    followOnset,
    followOnsetTolerance,
    followHudStyle,
    followDurationCue,
    followOnsetCue,
    followCountdown,
    measureCount,
    followStartMeasure,
    followEndMeasure,
    onPlaybackBpm,
    onFollowRhythm,
    onFollowRhythmTolerance,
    onFollowOnset,
    onFollowOnsetTolerance,
    onFollowHudStyle,
    onFollowRange,
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
