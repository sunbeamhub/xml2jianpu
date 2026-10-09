<script setup>
/* global defineProps, defineEmits */
import { computed } from 'vue'
import { useCompactSheet } from '../../composables/useCompactSheet.js'
import Dialog from '../ui/Dialog.vue'
import Sheet from '../ui/Sheet.vue'
import ScoreToolbarControls from './ScoreToolbarControls.vue'

defineProps({
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
})

const emit = defineEmits([
  'close',
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
])

const { useSheet } = useCompactSheet()

const frameBind = computed(() => {
  if (useSheet.value) {
    return {
      title: '乐谱',
      titleId: 'score-menu-title',
    }
  }
  return {
    title: '乐谱',
    titleId: 'score-menu-title',
    width: '380px',
    maxWidth: '100%',
    maxHeight: '640px',
    padded: false,
  }
})
</script>

<template>
  <component
    :is="useSheet ? Sheet : Dialog"
    v-bind="frameBind"
    @close="emit('close')"
  >
    <div class="score-menu-scroll">
      <ScoreToolbarControls
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
        @update:selected-example="emit('update:selectedExample', $event)"
        @update:line-break="emit('update:lineBreak', $event)"
        @update:paper-size="emit('update:paperSize', $event)"
        @update:theme="emit('update:theme', $event)"
        @font-size-step="emit('font-size-step', $event)"
        @example-change="emit('example-change')"
        @file-change="emit('file-change', $event)"
        @native-file-open="emit('native-file-open')"
        @export-pdf="emit('export-pdf')"
        @update:notation-mode="emit('update:notationMode', $event)"
      />
    </div>
  </component>
</template>

<style scoped>
.score-menu-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 16px 16px;
}
</style>
