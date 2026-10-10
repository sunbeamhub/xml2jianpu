<script setup>
/* global defineProps, defineEmits */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NOTATION_JIANPU } from '../../utils/osmdRenderer.js'
import { isTauri } from '../../utils/platform.js'
import { buildScoreTree, scoreFileLabel } from '../../utils/scoreLibrary.js'
import {
  SCORE_FONT_SIZE_DEFAULT,
  SCORE_FONT_SIZE_LEVELS,
  SCORE_FONT_SIZE_MAX,
  SCORE_FONT_SIZE_MIN,
  clampScoreFontSize,
} from '../../utils/scoreMetrics.js'
import { DEFAULT_PAPER_SIZE, DISPLAY_SIZES } from '../../utils/pageLayout.js'
import { armPageZoomBlock, clearPageZoomBlock } from '../../utils/pageZoomBlock.js'
import AppSelect from '../AppSelect.vue'
import Button from '../ui/Button.vue'
import SegmentSwitch from '../ui/SegmentSwitch.vue'
import NotationSwitch from './NotationSwitch.vue'

const FILE_ACCEPT =
  '.musicxml,.xml,text/xml,application/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,*/*'
const SCORE_ICON =
  'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
const ALBUM_ICON =
  'M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z'
const THEME_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]
const LINE_BREAK_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'musicxml', label: '原谱换行' },
  ...['2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n })),
]
const PAPER_ORDER = ['device', 'a4', 'a3']

const props = defineProps({
  layout: { type: String, default: 'columns' },
  rootExamples: { type: Array, required: true },
  albumGroups: { type: Array, required: true },
  selectedExample: { type: String, default: '' },
  lineBreak: { type: String, default: 'auto' },
  paperSize: { type: String, default: DEFAULT_PAPER_SIZE },
  scoreFontSize: { type: Number, default: SCORE_FONT_SIZE_DEFAULT },
  theme: { type: String, default: 'auto' },
  notationMode: { type: String, default: NOTATION_JIANPU },
  scoreFiles: { type: Array, default: () => [] },
  beforeScoreMenu: { type: Function, default: null },
})

const emit = defineEmits([
  'update:selectedExample',
  'update:lineBreak',
  'update:paperSize',
  'update:theme',
  'update:notationMode',
  'font-size-step',
  'example-change',
  'file-change',
  'native-file-open',
])

const libraryMode = isTauri()
const hasPointerEvent =
  typeof window !== 'undefined' && typeof window.PointerEvent === 'function'
const fileInput = ref(null)
const trackEl = ref(null)
const localSize = ref(clampScoreFontSize(props.scoreFontSize))
let tapFromTouch = false
let dragging = false

watch(
  () => props.scoreFontSize,
  (value) => {
    localSize.value = clampScoreFontSize(value)
  }
)

const paperOptions = PAPER_ORDER.map((id) => {
  const paper = DISPLAY_SIZES[id]
  return { value: paper.id, label: paper.label }
})

const exampleOptions = computed(() => {
  if (libraryMode) {
    return [
      { value: '', label: '请选择曲谱', disabled: true },
      ...buildScoreTree(props.scoreFiles).map((item) => ({
        ...item,
        icon: item.group ? ALBUM_ICON : SCORE_ICON,
      })),
    ]
  }
  const options = [
    { value: '', label: '请选择曲谱', disabled: true },
    ...props.rootExamples.map((item) => ({
      value: item.id,
      label: item.name,
      icon: SCORE_ICON,
    })),
  ]
  for (const album of props.albumGroups) {
    options.push({
      value: `__album__${album.name}`,
      label: album.name,
      group: true,
      icon: ALBUM_ICON,
    })
    for (const item of album.songs) {
      options.push({
        value: item.id,
        label: item.name,
        icon: SCORE_ICON,
        indent: 1,
      })
    }
  }
  return options
})

const exampleLabel = computed(() => {
  const id = props.selectedExample
  if (!id) return '选择曲谱'
  if (libraryMode) return scoreFileLabel(id)
  const root = props.rootExamples.find((item) => item.id === id)
  if (root) return root.name
  for (const album of props.albumGroups) {
    const song = album.songs.find((item) => item.id === id)
    if (song) return song.name
  }
  return '选择曲谱'
})

function setFontSize(next) {
  const clamped = clampScoreFontSize(next)
  const delta = clamped - localSize.value
  if (!delta) return
  localSize.value = clamped
  emit('font-size-step', delta)
}

function onStepClick(delta) {
  if (tapFromTouch) {
    tapFromTouch = false
    return
  }
  setFontSize(localSize.value + delta)
}

function onStepTouchEnd(delta, event) {
  if (event.cancelable) event.preventDefault()
  armPageZoomBlock()
  tapFromTouch = true
  setFontSize(localSize.value + delta)
  window.setTimeout(() => {
    tapFromTouch = false
  }, 500)
}

function levelFromClientX(clientX) {
  const el = trackEl.value
  if (!el) return localSize.value
  const rect = el.getBoundingClientRect()
  const pad = 8
  const span = Math.max(1, rect.width - pad * 2)
  const t = (clientX - rect.left - pad) / span
  const index = Math.round(
    Math.min(1, Math.max(0, t)) * (SCORE_FONT_SIZE_LEVELS.length - 1)
  )
  return SCORE_FONT_SIZE_LEVELS[index]
}

function onTrackPointerDown(event) {
  if (!hasPointerEvent) return
  dragging = true
  event.stopPropagation()
  event.currentTarget.setPointerCapture?.(event.pointerId)
  setFontSize(levelFromClientX(event.clientX))
}

function onTrackPointerMove(event) {
  if (!hasPointerEvent || !dragging) return
  event.stopPropagation()
  setFontSize(levelFromClientX(event.clientX))
}

function onTrackPointerEnd(event) {
  if (!hasPointerEvent || !dragging) return
  dragging = false
  event.stopPropagation()
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  } catch {
    /* 指针已结束时释放会失败 */
  }
}

function onTrackKeydown(event) {
  if (event.key === 'ArrowLeft') {
    setFontSize(localSize.value - 1)
    event.preventDefault()
  } else if (event.key === 'ArrowRight') {
    setFontSize(localSize.value + 1)
    event.preventDefault()
  }
}

function touchClientX(event) {
  const touch = event.touches?.[0] || event.changedTouches?.[0]
  return touch ? touch.clientX : null
}

function onTrackTouchStart(event) {
  const x = touchClientX(event)
  if (x == null) return
  if (event.cancelable) event.preventDefault()
  event.stopPropagation()
  dragging = true
  setFontSize(levelFromClientX(x))
}

function onTrackTouchMove(event) {
  if (!dragging) return
  const x = touchClientX(event)
  if (x == null) return
  if (event.cancelable) event.preventDefault()
  event.stopPropagation()
  setFontSize(levelFromClientX(x))
}

function onTrackTouchEnd(event) {
  if (!dragging) return
  dragging = false
  event.stopPropagation()
}

function bindTrackTouch(el) {
  el.addEventListener('touchstart', onTrackTouchStart, { passive: false })
  el.addEventListener('touchmove', onTrackTouchMove, { passive: false })
  el.addEventListener('touchend', onTrackTouchEnd)
  el.addEventListener('touchcancel', onTrackTouchEnd)
}

function unbindTrackTouch(el) {
  el.removeEventListener('touchstart', onTrackTouchStart)
  el.removeEventListener('touchmove', onTrackTouchMove)
  el.removeEventListener('touchend', onTrackTouchEnd)
  el.removeEventListener('touchcancel', onTrackTouchEnd)
}

function onUpload() {
  if (libraryMode) emit('native-file-open')
  else fileInput.value?.click()
}

function onExample(value) {
  emit('update:selectedExample', value)
  emit('example-change')
}

onMounted(() => {
  if (!hasPointerEvent && trackEl.value) bindTrackTouch(trackEl.value)
})

onBeforeUnmount(() => {
  if (trackEl.value) unbindTrackTouch(trackEl.value)
  clearPageZoomBlock()
})
</script>

<template>
  <div
    class="score-menu"
    :class="{ 'score-menu--stack': layout === 'stack' }"
  >
    <div class="score-cols">
      <div class="score-col">
        <div>
          <p class="score-label">曲谱</p>
          <div class="score-score-row">
            <AppSelect
              class="score-select"
              variant="row"
              nowrap
              :model-value="selectedExample"
              :options="exampleOptions"
              :label="exampleLabel"
              :aria-label="libraryMode ? '曲谱' : '内置示例'"
              :before-open="libraryMode ? beforeScoreMenu : null"
              @update:model-value="onExample"
            />
            <Button class="score-upload" variant="secondary" @click="onUpload">
              <svg
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
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5M12 12v5M9.5 14.5h5" />
              </svg>
              上传
            </Button>
            <input
              v-if="!libraryMode"
              ref="fileInput"
              class="score-file-input"
              type="file"
              :accept="FILE_ACCEPT"
              aria-label="上传曲谱"
              tabindex="-1"
              @change="emit('file-change', $event)"
            />
          </div>
        </div>
        <NotationSwitch
          :model-value="notationMode"
          @update:model-value="emit('update:notationMode', $event)"
        />
        <div>
          <p class="score-label">显示</p>
          <div class="score-font">
            <button
              type="button"
              class="score-font-end"
              :disabled="localSize <= SCORE_FONT_SIZE_MIN"
              aria-label="减小字号"
              @click="onStepClick(-1)"
              @touchend="onStepTouchEnd(-1, $event)"
              @dblclick.prevent
            >
              小
            </button>
            <div
              ref="trackEl"
              class="score-font-track"
              role="slider"
              tabindex="0"
              aria-label="字号"
              :aria-valuemin="SCORE_FONT_SIZE_MIN"
              :aria-valuemax="SCORE_FONT_SIZE_MAX"
              :aria-valuenow="localSize"
              @pointerdown="onTrackPointerDown"
              @pointermove="onTrackPointerMove"
              @pointerup="onTrackPointerEnd"
              @pointercancel="onTrackPointerEnd"
              @keydown="onTrackKeydown"
            >
              <span
                v-for="size in SCORE_FONT_SIZE_LEVELS"
                :key="size"
                class="score-font-dot"
                :class="{ 'score-font-dot--on': size === localSize }"
              />
            </div>
            <button
              type="button"
              class="score-font-end"
              :disabled="localSize >= SCORE_FONT_SIZE_MAX"
              aria-label="增大字号"
              @click="onStepClick(1)"
              @touchend="onStepTouchEnd(1, $event)"
              @dblclick.prevent
            >
              大
            </button>
          </div>
          <SegmentSwitch
            class="score-theme"
            field
            tone="surface"
            label="主题"
            :model-value="theme"
            :options="THEME_OPTIONS"
            @update:model-value="emit('update:theme', $event)"
          />
        </div>
      </div>
      <div class="score-col">
        <div>
          <p class="score-label">纸张大小</p>
          <SegmentSwitch
            field
            tone="surface"
            label="纸张大小"
            :model-value="paperSize"
            :options="paperOptions"
            @update:model-value="emit('update:paperSize', $event)"
          />
        </div>
        <div>
          <p class="score-label">每行小节数</p>
          <div class="score-chips" role="group" aria-label="每行小节数">
            <button
              v-for="item in LINE_BREAK_OPTIONS"
              :key="item.value"
              type="button"
              class="score-chip"
              :class="{ 'score-chip--on': item.value === lineBreak }"
              :aria-pressed="item.value === lineBreak"
              @click="item.value !== lineBreak && emit('update:lineBreak', item.value)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.score-menu {
  padding: 0 16px 4px;
}

.score-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 28px;
}

.score-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.score-menu--stack .score-cols {
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.score-menu--stack .score-col {
  gap: 16px;
}

.score-label {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.2;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.score-score-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.score-select {
  flex: 1 1 auto;
  min-width: 0;
}

.score-upload {
  flex: 0 0 auto;
  min-height: 48px;
  padding: 0 14px;
  border-color: transparent;
  border-radius: 12px;
  background: var(--color-field);
}

.score-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.score-font {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 48px;
  padding: 0 4px;
  border-radius: 12px;
  background: var(--color-field);
}

.score-font-end {
  box-sizing: border-box;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-appearance: none;
  appearance: none;
}

.score-font-end:active:not(:disabled) {
  background: rgba(10, 132, 255, 0.14);
  color: var(--color-accent);
}

.score-font-end:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.score-font-track {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  min-width: 0;
  padding: 0 8px;
  border-radius: 10px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.score-font-track:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.score-font-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-field-mark);
  pointer-events: none;
}

.score-font-dot--on {
  width: 16px;
  height: 16px;
  background: var(--color-accent);
}

.score-theme {
  margin-top: 8px;
}

.score-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.score-chip {
  box-sizing: border-box;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0 14px;
  border: 0;
  border-radius: 20px;
  background: var(--color-field);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-appearance: none;
  appearance: none;
}

.score-chip--on {
  background: var(--color-accent);
  color: #ffffff;
}

@media (prefers-reduced-motion: no-preference) {
  .score-font-dot {
    transition: width 0.12s ease, height 0.12s ease, background 0.12s ease;
  }
}
</style>
