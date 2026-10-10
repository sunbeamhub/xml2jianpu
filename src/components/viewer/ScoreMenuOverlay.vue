<script setup>
/* global defineProps, defineEmits */
import { computed } from 'vue'
import { useCompactSheet } from '../../composables/useCompactSheet.js'
import Button from '../ui/Button.vue'
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
    width: '860px',
    maxWidth: '100%',
    maxHeight: '100%',
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
        :layout="useSheet ? 'stack' : 'columns'"
        :root-examples="rootExamples"
        :album-groups="albumGroups"
        :selected-example="selectedExample"
        :line-break="lineBreak"
        :paper-size="paperSize"
        :score-font-size="scoreFontSize"
        :theme="theme"
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
        @update:notation-mode="emit('update:notationMode', $event)"
      />
    </div>
    <template #footer>
      <div class="overlay-actions overlay-actions--half">
        <Button
          class="overlay-actions__confirm"
          variant="primary"
          :disabled="!currentXml || exporting"
          :aria-label="exporting ? '导出中' : '下载 PDF'"
          @click="emit('export-pdf')"
        >
          <svg
            v-if="exporting"
            class="score-export-spin"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-dasharray="14 42"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
          </svg>
          下载 PDF
        </Button>
      </div>
    </template>
  </component>
</template>

<style scoped>
.score-menu-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.score-export-spin {
  display: block;
  animation: score-export-spin 0.8s linear infinite;
}

@keyframes score-export-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .score-export-spin {
    animation: none;
  }
}
</style>
