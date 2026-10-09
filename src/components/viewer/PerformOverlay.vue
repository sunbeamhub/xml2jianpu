<script setup>
/* global defineProps, defineEmits */
import { computed, ref } from 'vue'
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
  followRhythm: { type: Boolean, default: false },
  followRhythmTolerance: { type: String, default: 'standard' },
  followHudStyle: { type: String, default: 'arc' },
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
  'follow-rhythm',
  'follow-rhythm-tolerance',
  'follow-hud-style',
])

const { useSheet } = useCompactSheet()
const sideOpen = ref(false)

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
    maxHeight: '640px',
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
        :follow-rhythm="followRhythm"
        :follow-rhythm-tolerance="followRhythmTolerance"
        :follow-hud-style="followHudStyle"
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
        @follow-rhythm="emit('follow-rhythm', $event)"
        @follow-rhythm-tolerance="emit('follow-rhythm-tolerance', $event)"
        @follow-hud-style="emit('follow-hud-style', $event)"
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
