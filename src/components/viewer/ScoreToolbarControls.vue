<script setup>
/* global defineProps, defineEmits */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NOTATION_JIANPU } from '../../utils/osmdRenderer.js'
import { isTauri } from '../../utils/platform.js'
import { scoreFileLabel } from '../../utils/scoreLibrary.js'
import {
  SCORE_FONT_SIZE_DEFAULT,
  SCORE_FONT_SIZE_LEVELS,
  SCORE_FONT_SIZE_MAX,
  SCORE_FONT_SIZE_MIN,
  clampScoreFontSize,
} from '../../utils/scoreMetrics.js'
import { DEFAULT_PAPER_SIZE, DISPLAY_SIZES } from '../../utils/pageLayout.js'
import { armPageZoomBlock, clearPageZoomBlock } from '../../utils/pageZoomBlock.js'
import Button from '../ui/Button.vue'
import SegmentSwitch from '../ui/SegmentSwitch.vue'
import NotationSwitch from './NotationSwitch.vue'

const FILE_ACCEPT =
  '.musicxml,.xml,text/xml,application/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,*/*'
const THEME_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]
const SKIN_OPTIONS = [
  { value: 'modern', label: '现代' },
  { value: 'smartisan', label: '锤子' },
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
  skin: { type: String, default: 'modern' },
  notationMode: { type: String, default: NOTATION_JIANPU },
  beforeScoreMenu: { type: Function, default: null },
  pickerOpen: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:selectedExample',
  'update:lineBreak',
  'update:paperSize',
  'update:theme',
  'update:skin',
  'update:notationMode',
  'font-size-step',
  'example-change',
  'file-change',
  'native-file-open',
  'open-picker',
])

const libraryMode = isTauri()
const hasPointerEvent =
  typeof window !== 'undefined' && typeof window.PointerEvent === 'function'
const fileInput = ref(null)
const trackEl = ref(null)
const localSize = ref(clampScoreFontSize(props.scoreFontSize))
let tapFromTouch = false
let dragging = false
let flushTimer = 0
let pending = null
const pickerOpening = ref(false)

watch(
  () => props.scoreFontSize,
  (value) => {
    if (pending != null) return
    localSize.value = clampScoreFontSize(value)
  }
)

const paperOptions = PAPER_ORDER.map((id) => {
  const paper = DISPLAY_SIZES[id]
  return { value: paper.id, label: paper.label }
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

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = 0
  }
  if (pending == null) return
  const next = pending
  pending = null
  const delta = next - props.scoreFontSize
  if (!delta) return
  emit('font-size-step', delta)
}

function commit(next) {
  const clamped = clampScoreFontSize(next)
  localSize.value = clamped
  pending = clamped
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = window.setTimeout(flush, 280)
}

function onStepClick(delta) {
  if (tapFromTouch) {
    tapFromTouch = false
    return
  }
  commit(localSize.value + delta)
}

function onStepTouchEnd(delta, event) {
  if (event.cancelable) event.preventDefault()
  armPageZoomBlock()
  tapFromTouch = true
  commit(localSize.value + delta)
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
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId)
  } catch {
    /* 指针尚未按下时捕获会失败 */
  }
  commit(levelFromClientX(event.clientX))
}

function onTrackPointerMove(event) {
  if (!hasPointerEvent || !dragging) return
  event.stopPropagation()
  commit(levelFromClientX(event.clientX))
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
    commit(localSize.value - 1)
    event.preventDefault()
  } else if (event.key === 'ArrowRight') {
    commit(localSize.value + 1)
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
  commit(levelFromClientX(x))
}

function onTrackTouchMove(event) {
  if (!dragging) return
  const x = touchClientX(event)
  if (x == null) return
  if (event.cancelable) event.preventDefault()
  event.stopPropagation()
  commit(levelFromClientX(x))
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

async function openPicker() {
  if (props.pickerOpen || pickerOpening.value) return
  if (typeof props.beforeScoreMenu === 'function') {
    pickerOpening.value = true
    try {
      const ok = await props.beforeScoreMenu()
      if (ok === false) return
    } catch {
      return
    } finally {
      pickerOpening.value = false
    }
  }
  emit('open-picker')
}

onMounted(() => {
  if (!hasPointerEvent && trackEl.value) bindTrackTouch(trackEl.value)
})

onBeforeUnmount(() => {
  flush()
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
            <button
              type="button"
              class="score-select"
              :aria-expanded="pickerOpen"
              aria-haspopup="dialog"
              :aria-label="libraryMode ? '曲谱' : '内置示例'"
              @click="openPicker"
            >
              <span class="score-select-label">{{ exampleLabel }}</span>
              <svg
                class="score-select-caret"
                :class="{ 'score-select-caret--open': pickerOpen }"
                viewBox="0 0 12 12"
                width="10"
                height="10"
                aria-hidden="true"
              >
                <path
                  d="M2.5 4.5 6 8l3.5-3.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
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
            :model-value="skin"
            :options="SKIN_OPTIONS"
            @update:model-value="emit('update:skin', $event)"
          />
          <SegmentSwitch
            class="score-theme"
            field
            tone="surface"
            label="外观"
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
  padding: 16px;
}

.score-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  grid-gap: 28px;
  gap: 28px;
}

.score-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.score-col > * + * {
  margin-top: 20px;
}

.score-menu--stack .score-cols {
  grid-template-columns: minmax(0, 1fr);
  grid-gap: 16px;
  gap: 16px;
}

.score-menu--stack .score-col > * + * {
  margin-top: 16px;
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
  min-width: 0;
}

.score-select {
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  min-height: 48px;
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: var(--color-field);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-appearance: none;
  appearance: none;
}

.score-select-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

.score-select-caret {
  flex: none;
  margin-left: 12px;
  transform: translateY(0.5px);
  transition: transform 0.15s ease;
}

.score-select-caret--open {
  transform: translateY(0.5px) rotate(180deg);
}

.score-select:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.score-upload {
  flex: 0 0 auto;
  min-height: 48px;
  margin-left: 8px;
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
  margin: 0 4px;
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
  margin: -4px;
}

.score-chip {
  box-sizing: border-box;
  min-width: 44px;
  min-height: 44px;
  margin: 4px;
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
