<script>
import ScoreToolbarControls from './ScoreToolbarControls.vue'
import TransposePanel, { TransposeIcon } from './TransposePanel.vue'

export default {
  components: { ScoreToolbarControls, TransposePanel, TransposeIcon },
  props: {
    fabVisible: { type: Boolean, default: false },
    sheetOpen: { type: Boolean, default: false },
    transposeOpen: { type: Boolean, default: false },
    transposeDirty: { type: Boolean, default: false },
    originalKeyName: { type: String, default: 'C' },
    transposeSemitones: { type: Number, default: 0 },
    fixedDo: { type: Boolean, default: false },
    transposePanelFixedDo: { type: Boolean, default: false },
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
    rootExamples: { type: Array, default: () => [] },
    albumGroups: { type: Array, default: () => [] },
    selectedExample: { type: String, default: '' },
    lineBreak: { type: String, default: 'auto' },
    paperSize: { type: String, default: '' },
    scoreFontSize: { type: Number, default: 16 },
    theme: { type: String, default: 'auto' },
    currentXml: { type: String, default: '' },
    exporting: { type: Boolean, default: false },
    notationMode: { type: String, default: 'jianpu' },
    scoreFiles: { type: Array, default: () => [] },
    beforeScoreMenu: { type: Function, default: null },
  },
  emits: [
    'toggle-transpose',
    'toggle-sheet',
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
    'update:selectedExample',
    'update:lineBreak',
    'update:paperSize',
    'update:theme',
    'font-size-step',
    'example-change',
    'file-change',
    'native-file-open',
    'export-pdf',
    'update:notationMode',
  ],
}
</script>

<template>
  <Teleport to="body">
    <div
      class="menu-anchor menu-anchor--fixed menu-anchor--start"
      :class="{ 'menu-anchor--visible': fabVisible || sheetOpen || transposeOpen }"
      @click.stop
    >
      <div
        v-if="transposeOpen"
        class="toolbar-panel toolbar-panel--sheet toolbar-panel--sheet-start toolbar-panel--transpose"
      >
        <TransposePanel
          :original-key-name="originalKeyName"
          :transpose-semitones="fixedDo ? transposeSemitones : 0"
          :fixed-do="transposePanelFixedDo"
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
          @set="$emit('set-transpose', $event)"
          @reset="$emit('reset-transpose')"
          @engage="$emit('engage-transpose')"
          @audio-toggle="$emit('audio-toggle')"
          @audio-stop="$emit('audio-stop')"
          @audio-seek="(ratio, meta) => $emit('audio-seek', ratio, meta)"
          @audio-instrument="$emit('audio-instrument', $event)"
          @midi-connect="$emit('midi-connect')"
          @midi-disconnect="$emit('midi-disconnect')"
          @midi-follow="$emit('midi-follow', $event)"
          @follow-rhythm="$emit('follow-rhythm', $event)"
          @follow-rhythm-tolerance="$emit('follow-rhythm-tolerance', $event)"
          @follow-hud-style="$emit('follow-hud-style', $event)"
        />
      </div>
      <button
        type="button"
        class="menu-btn"
        :class="{ 'menu-btn--active': transposeDirty }"
        :aria-expanded="transposeOpen"
        aria-label="固定调移调"
        @click="$emit('toggle-transpose')"
      >
        <TransposeIcon />
      </button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      class="menu-anchor menu-anchor--fixed"
      :class="{ 'menu-anchor--visible': fabVisible || sheetOpen || transposeOpen }"
      @click.stop
    >
      <div v-if="sheetOpen" class="toolbar-panel toolbar-panel--sheet">
        <ScoreToolbarControls
          layout="stack"
          :root-examples="rootExamples"
          :album-groups="albumGroups"
          :selected-example="selectedExample"
          :line-break="lineBreak"
          :paper-size="paperSize"
          :score-font-size="scoreFontSize"
          :theme="theme"
          :current-xml="currentXml"
          :exporting="exporting"
          :notation-mode="notationMode"
          :score-files="scoreFiles"
          :before-score-menu="beforeScoreMenu"
          @update:selected-example="$emit('update:selectedExample', $event)"
          @update:line-break="$emit('update:lineBreak', $event)"
          @update:paper-size="$emit('update:paperSize', $event)"
          @update:theme="$emit('update:theme', $event)"
          @font-size-step="$emit('font-size-step', $event)"
          @example-change="$emit('example-change')"
          @file-change="$emit('file-change', $event)"
          @native-file-open="$emit('native-file-open')"
          @export-pdf="$emit('export-pdf')"
          @update:notation-mode="$emit('update:notationMode', $event)"
        />
      </div>
      <button
        type="button"
        class="menu-btn"
        :aria-expanded="sheetOpen"
        aria-label="打开功能菜单"
        @click="$emit('toggle-sheet')"
      >
        <svg
          class="menu-icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M4 7h16v2H4V7zm0 4h16v2H4v-2zm0 4h16v2H4v-2z"
          />
        </svg>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-anchor {
  position: relative;
  display: flex;
  align-items: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  touch-action: manipulation;
}

.menu-anchor--fixed {
  position: fixed;
  top: calc(12px + var(--safe-area-top, env(safe-area-inset-top, 0px)));
  right: calc(16px + var(--score-overview-reserve, 0px) + var(--safe-area-right, env(safe-area-inset-right, 0px)));
  z-index: 80;
}

.menu-anchor--start {
  right: auto;
  left: calc(16px + var(--safe-area-left, env(safe-area-inset-left, 0px)));
}

.menu-anchor--visible {
  opacity: 1;
  pointer-events: auto;
}

.menu-btn {
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--color-menu-light-bg);
  box-shadow: var(--shadow-raised);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-primary);
  touch-action: manipulation;
}

.menu-btn.menu-btn--active {
  background: var(--color-accent);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(10, 132, 255, 0.35);
}

.menu-icon {
  display: block;
}

.toolbar-panel--sheet {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: var(--menu-width);
  max-width: calc(100vw - 32px);
  z-index: 60;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

.toolbar-panel--sheet-start {
  right: auto;
  left: 0;
}

.toolbar-panel--transpose {
  width: 380px;
  max-width: calc(100vw - 32px);
}
</style>
