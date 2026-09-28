import { ref } from "vue";
import { syncStaffCursor } from "../utils/osmdRenderer.js";
import { syncJianpuPlayheads } from "../utils/scoreHighlight.js";
import {
  AUDIO_INSTRUMENT_PIANO,
  AUDIO_INSTRUMENT_SYNTH,
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
let audioSeekDragging = false
let audioReloadTimer = 0
let audioLoadToken = 0
/** 拖进度前是否在播放，松手后决定是否继续 */
let audioWasPlayingBeforeSeek = false

function noteHighlightVisible() {
  if (!audioReady.value) return false
  if (audioPlayState.value === 'playing' || audioPlayState.value === 'paused') {
    return true
  }
  return getScoreAudioSeconds() > 0.02
}

function syncNoteHighlight() {
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

async function onAudioInstrument(id) {
  const next =
    id === AUDIO_INSTRUMENT_PIANO
      ? AUDIO_INSTRUMENT_PIANO
      : AUDIO_INSTRUMENT_SYNTH
  if (next === audioInstrument.value) return
  audioInstrumentLoading.value = true
  try {
    await setScoreAudioInstrument(next)
    audioInstrument.value = next
  } catch (err) {
    console.error('[score-audio-instrument]', err)
  } finally {
    audioInstrumentLoading.value = false
  }
}

async function onAudioSeek(ratio, meta = {}) {
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
  }

  function disposeAudio() {
    resetScoreAudio();
    destroyScoreAudio();
    onScoreAudioState(null);
    onScoreAudioProgress(null);
    audioInstrument.value = AUDIO_INSTRUMENT_SYNTH;
    audioEvents.value = [];
    audioDuration.value = 0;
  }

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
    onAudioInstrument,
    onAudioSeek,
    resetScoreAudio,
    disposeAudio,
  };
}
