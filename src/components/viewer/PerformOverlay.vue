<script setup>
/* global defineProps, defineEmits */
import { computed, ref, watch } from 'vue'
import { useCompactSheet } from '../../composables/useCompactSheet.js'
import Dialog from '../ui/Dialog.vue'
import Sheet from '../ui/Sheet.vue'
import TransposePanel from './TransposePanel.vue'

const props = defineProps({
  originalKeyName: { type: String, default: 'C' },
  transposeSemitones: { type: Number, default: 0 },
  fixedDo: { type: Boolean, default: false },
  audioReady: { type: Boolean, default: false },
  audioPlaying: { type: Boolean, default: false },
  audioProgress: { type: Number, default: 0 },
  audioLoading: { type: Boolean, default: false },
  audioInstrument: { type: String, default: '' },
  audioInstrumentLoading: { type: Boolean, default: false },
  audioEvents: { type: Array, default: () => [] },
  audioDuration: { type: Number, default: 0 },
  instrumentOptions: { type: Array, default: () => [] },
  midiSupported: { type: Boolean, default: false },
  midiPhase: { type: String, default: 'off' },
  midiStatusText: { type: String, default: '未连接设备' },
  midiHasDevice: { type: Boolean, default: false },
  midiFollow: { type: Boolean, default: false },
  playbackBpm: { type: Number, default: 100 },
  scoreBpm: { type: Number, default: 100 },
  followRhythm: { type: Boolean, default: false },
  followRhythmTolerance: { type: String, default: 'standard' },
  followOnset: { type: Boolean, default: false },
  followOnsetTolerance: { type: String, default: 'standard' },
  followCountdown: { type: Number, default: 0 },
  followHudStyle: { type: String, default: 'arc' },
  measureCount: { type: Number, default: 1 },
  followStartMeasure: { type: Number, default: 1 },
  followEndMeasure: { type: Number, default: 1 },
})

const emit = defineEmits([
  'close',
  'set-transpose',
  'reset-transpose',
  'engage-transpose',
  'audio-toggle',
  'audio-stop',
  'audio-seek',
  'audio-instrument',
  'midi-connect',
  'midi-disconnect',
  'midi-follow',
  'playback-bpm',
  'follow-rhythm',
  'follow-rhythm-tolerance',
  'follow-onset',
  'follow-onset-tolerance',
  'follow-hud-style',
  'follow-range',
])

const { useSheet } = useCompactSheet()
const sideOpen = ref(false)

watch(
  useSheet,
  (sheet, prev) => {
    if (sheet) return
    if (prev === false) return
    sideOpen.value = props.midiPhase === 'on'
  },
  { immediate: true }
)

const frameBind = computed(() => {
  if (useSheet.value) {
    return {
      title: '演奏',
      titleId: 'perform-title',
    }
  }
  let width = '420px'
  if (props.midiSupported) width = sideOpen.value ? '820px' : '440px'
  return {
    title: '演奏',
    titleId: 'perform-title',
    width,
    maxWidth: '100%',
    maxHeight: 'min(760px, calc(100vh - 32px))',
    padded: false,
    widthTransition: true,
  }
})
</script>

<template>
  <component
    :is="useSheet ? Sheet : Dialog"
    v-bind="frameBind"
    @close="emit('close')"
  >
    <div class="perform-scroll">
      <TransposePanel
        :layout="useSheet ? 'stack' : 'columns'"
        :side-open="sideOpen"
        :original-key-name="originalKeyName"
        :transpose-semitones="transposeSemitones"
        :fixed-do="fixedDo"
        :audio-ready="audioReady"
        :audio-playing="audioPlaying"
        :audio-progress="audioProgress"
        :audio-loading="audioLoading"
        :audio-instrument="audioInstrument"
        :audio-instrument-loading="audioInstrumentLoading"
        :audio-events="audioEvents"
        :audio-duration="audioDuration"
        :instrument-options="instrumentOptions"
        :midi-supported="midiSupported"
        :midi-phase="midiPhase"
        :midi-status-text="midiStatusText"
        :midi-has-device="midiHasDevice"
        :midi-follow="midiFollow"
        :playback-bpm="playbackBpm"
        :score-bpm="scoreBpm"
        :follow-rhythm="followRhythm"
        :follow-rhythm-tolerance="followRhythmTolerance"
        :follow-onset="followOnset"
        :follow-onset-tolerance="followOnsetTolerance"
        :follow-countdown="followCountdown"
        :follow-hud-style="followHudStyle"
        :measure-count="measureCount"
        :follow-start-measure="followStartMeasure"
        :follow-end-measure="followEndMeasure"
        @update:side-open="sideOpen = $event"
        @set="emit('set-transpose', $event)"
        @reset="emit('reset-transpose')"
        @engage="emit('engage-transpose')"
        @audio-toggle="emit('audio-toggle')"
        @audio-stop="emit('audio-stop')"
        @audio-seek="(ratio, meta) => emit('audio-seek', ratio, meta)"
        @audio-instrument="emit('audio-instrument', $event)"
        @midi-connect="emit('midi-connect')"
        @midi-disconnect="emit('midi-disconnect')"
        @midi-follow="emit('midi-follow', $event)"
        @playback-bpm="emit('playback-bpm', $event)"
        @follow-rhythm="emit('follow-rhythm', $event)"
        @follow-rhythm-tolerance="emit('follow-rhythm-tolerance', $event)"
        @follow-onset="emit('follow-onset', $event)"
        @follow-onset-tolerance="emit('follow-onset-tolerance', $event)"
        @follow-hud-style="emit('follow-hud-style', $event)"
        @follow-range="emit('follow-range', $event)"
      />
    </div>
  </component>
</template>

<style scoped>
.perform-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
</style>
