<script setup>
/* global defineProps, defineEmits */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildPitchContour, contourToSvgPath } from '../../utils/pitchContour.js'

const props = defineProps({
  measureCount: { type: Number, default: 1 },
  startMeasure: { type: Number, default: 1 },
  endMeasure: { type: Number, default: 1 },
  minMeasures: { type: Number, default: 1 },
  audioEvents: { type: Array, default: () => [] },
  audioDuration: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:range'])

const VIEW_W = 320
const VIEW_H = 44
const HANDLE_W = 14
const hasPointer =
  typeof window !== 'undefined' && typeof window.PointerEvent === 'function'

let clipSeq = 0
const clipId = `measure-range-clip-${++clipSeq}`

const trackEl = ref(null)
const draftStart = ref(1)
const draftEnd = ref(1)
/** @type {import('vue').Ref<'start' | 'end' | null>} */
const activeHandle = ref(null)

let flushTimer = 0
let pendingRange = null

const totalMeasures = computed(() =>
  Math.max(1, Math.trunc(Number(props.measureCount) || 1))
)

const minLen = computed(() =>
  Math.max(
    1,
    Math.min(totalMeasures.value, Math.trunc(Number(props.minMeasures) || 1))
  )
)

function clampRange(rawStart, rawEnd) {
  const total = totalMeasures.value
  const minSpan = minLen.value
  let s = Math.max(1, Math.min(total, Math.round(Number(rawStart) || 1)))
  let e = Math.max(1, Math.min(total, Math.round(Number(rawEnd) || total)))
  if (e < s) e = s
  if (e - s + 1 < minSpan) {
    if (s + minSpan - 1 <= total) {
      e = s + minSpan - 1
    } else {
      e = total
      s = Math.max(1, total - minSpan + 1)
    }
  }
  return { start: s, end: e }
}

function syncFromProps() {
  if (activeHandle.value != null || pendingRange != null) return
  const clamped = clampRange(props.startMeasure, props.endMeasure)
  draftStart.value = clamped.start
  draftEnd.value = clamped.end
}

watch(
  () => [props.measureCount, props.startMeasure, props.endMeasure, props.minMeasures],
  () => syncFromProps(),
  { immediate: true }
)

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = 0
  }
  if (!pendingRange) return
  const next = pendingRange
  pendingRange = null
  const current = clampRange(props.startMeasure, props.endMeasure)
  if (next.start === current.start && next.end === current.end) return
  emit('update:range', next)
}

function scheduleCommit(next) {
  const current = clampRange(props.startMeasure, props.endMeasure)
  if (next.start === current.start && next.end === current.end) {
    pendingRange = null
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = 0
    }
    return
  }
  pendingRange = next
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = window.setTimeout(flush, 280)
}

const leftRatio = computed(() => (draftStart.value - 1) / totalMeasures.value)
const rightRatio = computed(() => draftEnd.value / totalMeasures.value)

const contourPath = computed(() => {
  const contour = buildPitchContour(
    props.audioEvents,
    props.audioDuration || 1,
    128
  )
  return contourToSvgPath(contour.heights, VIEW_W, VIEW_H)
})

const measureLines = computed(() => {
  const total = totalMeasures.value
  if (total <= 1) return []
  const maxLines = 64
  const step = total > maxLines ? Math.ceil(total / maxLines) : 1
  const lines = []
  for (let i = step; i < total; i += step) {
    lines.push({
      index: i,
      x: (i / total) * VIEW_W,
      major: i % 4 === 0,
    })
  }
  return lines
})

const rangeSummary = computed(() => {
  if (draftStart.value === 1 && draftEnd.value === totalMeasures.value) {
    return totalMeasures.value === 1
      ? '全曲（第 1 小节）'
      : `全曲（第 1–${totalMeasures.value} 小节）`
  }
  if (draftStart.value === draftEnd.value) {
    return `第 ${draftStart.value} 小节`
  }
  return `第 ${draftStart.value}–${draftEnd.value} 小节`
})

const bubbleMeasure = computed(() => {
  if (activeHandle.value === 'start') return draftStart.value
  if (activeHandle.value === 'end') return draftEnd.value
  return null
})

const bubbleLeftPct = computed(() => {
  if (activeHandle.value === 'start') return leftRatio.value * 100
  if (activeHandle.value === 'end') return rightRatio.value * 100
  return 0
})

function ratioFromClientX(clientX) {
  const el = trackEl.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  if (!(rect.width > 0)) return 0
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

function updateHandleFromClientX(kind, clientX) {
  const total = totalMeasures.value
  const minSpan = minLen.value
  const ratio = ratioFromClientX(clientX)
  const boundary = Math.round(ratio * total)
  if (kind === 'start') {
    const maxStart = Math.max(1, draftEnd.value - minSpan + 1)
    const nextStart = Math.max(1, Math.min(maxStart, boundary + 1))
    if (nextStart !== draftStart.value) {
      draftStart.value = nextStart
      scheduleCommit({ start: draftStart.value, end: draftEnd.value })
    }
  } else if (kind === 'end') {
    const minEnd = Math.min(total, draftStart.value + minSpan - 1)
    const nextEnd = Math.max(minEnd, Math.min(total, boundary))
    if (nextEnd !== draftEnd.value) {
      draftEnd.value = nextEnd
      scheduleCommit({ start: draftStart.value, end: draftEnd.value })
    }
  }
}

function pickNearestHandle(clientX) {
  const ratio = ratioFromClientX(clientX)
  const dStart = Math.abs(ratio - leftRatio.value)
  const dEnd = Math.abs(ratio - rightRatio.value)
  if (Math.abs(dStart - dEnd) < 1e-4) {
    return ratio <= leftRatio.value ? 'start' : 'end'
  }
  return dStart <= dEnd ? 'start' : 'end'
}

function startDrag(kind, clientX) {
  if (props.disabled || totalMeasures.value <= 1) return
  activeHandle.value = kind
  updateHandleFromClientX(kind, clientX)
}

function moveDrag(clientX) {
  if (!activeHandle.value) return
  updateHandleFromClientX(activeHandle.value, clientX)
}

function endDrag() {
  if (!activeHandle.value) return
  activeHandle.value = null
  flush()
}

function onPointerDown(ev, explicitKind) {
  if (props.disabled || totalMeasures.value <= 1) return
  if (ev.pointerType === 'mouse' && ev.button !== 0) return
  if (ev.button != null && ev.button !== 0 && ev.pointerType == null) return
  if (ev.cancelable) ev.preventDefault()
  ev.stopPropagation()
  const kind = explicitKind || pickNearestHandle(ev.clientX)
  try {
    trackEl.value?.setPointerCapture?.(ev.pointerId)
  } catch {
    /* ignore */
  }
  startDrag(kind, ev.clientX)
}

function onPointerMove(ev) {
  if (!activeHandle.value) return
  if (ev.cancelable) ev.preventDefault()
  moveDrag(ev.clientX)
}

function onPointerUp(ev) {
  if (!activeHandle.value) return
  try {
    trackEl.value?.releasePointerCapture?.(ev.pointerId)
  } catch {
    /* ignore */
  }
  endDrag()
}

function touchX(ev) {
  const t = ev.touches?.[0] || ev.changedTouches?.[0]
  return t ? t.clientX : null
}

function onTouchStart(ev) {
  if (props.disabled || totalMeasures.value <= 1) return
  const x = touchX(ev)
  if (x == null) return
  if (ev.cancelable) ev.preventDefault()
  const target = ev.target instanceof Element ? ev.target : null
  const handleEl = target?.closest?.('[data-handle]')
  const kind = handleEl?.getAttribute('data-handle') || pickNearestHandle(x)
  startDrag(kind === 'end' ? 'end' : 'start', x)
}

function onTouchMove(ev) {
  if (!activeHandle.value) return
  const x = touchX(ev)
  if (x == null) return
  if (ev.cancelable) ev.preventDefault()
  moveDrag(x)
}

function onTouchEnd() {
  endDrag()
}

function onHandleKeydown(ev, kind) {
  if (props.disabled || totalMeasures.value <= 1) return
  const key = ev.key
  let delta = 0
  if (key === 'ArrowLeft' || key === 'ArrowDown') delta = -1
  else if (key === 'ArrowRight' || key === 'ArrowUp') delta = 1
  if (!delta) return
  ev.preventDefault()
  const total = totalMeasures.value
  const minSpan = minLen.value
  if (kind === 'start') {
    const maxStart = Math.max(1, draftEnd.value - minSpan + 1)
    const nextStart = Math.max(1, Math.min(maxStart, draftStart.value + delta))
    if (nextStart !== draftStart.value) {
      draftStart.value = nextStart
      scheduleCommit({ start: draftStart.value, end: draftEnd.value })
    }
  } else {
    const minEnd = Math.min(total, draftStart.value + minSpan - 1)
    const nextEnd = Math.max(minEnd, Math.min(total, draftEnd.value + delta))
    if (nextEnd !== draftEnd.value) {
      draftEnd.value = nextEnd
      scheduleCommit({ start: draftStart.value, end: draftEnd.value })
    }
  }
}

onMounted(() => {
  if (!hasPointer && trackEl.value) {
    trackEl.value.addEventListener('touchstart', onTouchStart, { passive: false })
    trackEl.value.addEventListener('touchmove', onTouchMove, { passive: false })
    trackEl.value.addEventListener('touchend', onTouchEnd)
    trackEl.value.addEventListener('touchcancel', onTouchEnd)
  }
})

onBeforeUnmount(() => {
  flush()
  if (trackEl.value) {
    trackEl.value.removeEventListener('touchstart', onTouchStart)
    trackEl.value.removeEventListener('touchmove', onTouchMove)
    trackEl.value.removeEventListener('touchend', onTouchEnd)
    trackEl.value.removeEventListener('touchcancel', onTouchEnd)
  }
})
</script>

<template>
  <div
    class="measure-range"
    :class="{ 'is-disabled': disabled || totalMeasures <= 1 }"
  >
    <div class="measure-range__head">
      <span class="measure-range__title">小节范围</span>
      <span class="measure-range__summary">{{ rangeSummary }}</span>
    </div>
    <div
      ref="trackEl"
      class="measure-range__track"
      @pointerdown="hasPointer ? onPointerDown($event, null) : undefined"
      @pointermove="hasPointer ? onPointerMove($event) : undefined"
      @pointerup="hasPointer ? onPointerUp($event) : undefined"
      @pointercancel="hasPointer ? onPointerUp($event) : undefined"
    >
      <div
        v-if="bubbleMeasure != null"
        class="measure-range__bubble"
        :style="{ left: `${bubbleLeftPct}%` }"
        role="status"
      >
        第 {{ bubbleMeasure }} 小节
      </div>

      <div class="measure-range__well">
        <svg
          class="measure-range__svg"
          :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <clipPath :id="clipId">
              <rect
                :x="leftRatio * VIEW_W"
                y="0"
                :width="Math.max(0, (rightRatio - leftRatio) * VIEW_W)"
                :height="VIEW_H"
              />
            </clipPath>
          </defs>
          <path class="measure-range__wave-dim" :d="contourPath" />
          <path
            class="measure-range__wave-active"
            :d="contourPath"
            :clip-path="`url(#${clipId})`"
          />
          <line
            v-for="item in measureLines"
            :key="item.index"
            :class="[
              'measure-range__grid-line',
              item.major ? 'is-major' : '',
            ]"
            :x1="item.x"
            :x2="item.x"
            y1="0"
            :y2="VIEW_H"
          />
        </svg>

        <div
          class="measure-range__mask measure-range__mask--left"
          :style="{ width: `${leftRatio * 100}%` }"
          aria-hidden="true"
        />
        <div
          class="measure-range__mask measure-range__mask--right"
          :style="{ width: `${(1 - rightRatio) * 100}%` }"
          aria-hidden="true"
        />

        <div
          class="measure-range__window"
          :style="{
            left: `${leftRatio * 100}%`,
            width: `${Math.max(0, (rightRatio - leftRatio) * 100)}%`,
          }"
          aria-hidden="true"
        />
      </div>

      <div
        class="measure-range__handle measure-range__handle--start"
        :class="{ 'is-active': activeHandle === 'start' }"
        data-handle="start"
        role="slider"
        :tabindex="disabled || totalMeasures <= 1 ? -1 : 0"
        aria-label="起始小节"
        :aria-valuemin="1"
        :aria-valuemax="Math.max(1, draftEnd - minLen + 1)"
        :aria-valuenow="draftStart"
        :aria-valuetext="`第 ${draftStart} 小节`"
        :style="{ left: `calc(${leftRatio * 100}% - ${HANDLE_W / 2}px)` }"
        @pointerdown="hasPointer ? onPointerDown($event, 'start') : undefined"
        @keydown="onHandleKeydown($event, 'start')"
      >
        <span class="measure-range__grip" aria-hidden="true" />
      </div>

      <div
        class="measure-range__handle measure-range__handle--end"
        :class="{ 'is-active': activeHandle === 'end' }"
        data-handle="end"
        role="slider"
        :tabindex="disabled || totalMeasures <= 1 ? -1 : 0"
        aria-label="结束小节"
        :aria-valuemin="Math.min(totalMeasures, draftStart + minLen - 1)"
        :aria-valuemax="totalMeasures"
        :aria-valuenow="draftEnd"
        :aria-valuetext="`第 ${draftEnd} 小节`"
        :style="{ left: `calc(${rightRatio * 100}% - ${HANDLE_W / 2}px)` }"
        @pointerdown="hasPointer ? onPointerDown($event, 'end') : undefined"
        @keydown="onHandleKeydown($event, 'end')"
      >
        <span class="measure-range__grip" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.measure-range {
  margin-top: 12px;
  padding: 10px 14px 12px;
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
  user-select: none;
  -webkit-user-select: none;
}

.measure-range.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}

.measure-range__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.measure-range__title {
  font-size: 13px;
  line-height: 1.3;
  color: var(--color-text-primary);
}

.measure-range__summary {
  font-size: 12px;
  line-height: 1.3;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.measure-range__track {
  position: relative;
  height: 44px;
  margin: 0 7px;
  touch-action: none;
  cursor: ew-resize;
}

.measure-range__well {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-control);
  background: var(--color-field);
  overflow: hidden;
}

.measure-range__svg {
  display: block;
  width: 100%;
  height: 100%;
}

.measure-range__wave-dim {
  fill: var(--color-text-secondary);
  fill-opacity: 0.22;
}

.measure-range__wave-active {
  fill: var(--color-accent);
  fill-opacity: 0.72;
}

.measure-range__grid-line {
  stroke: var(--color-border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.measure-range__grid-line.is-major {
  stroke: var(--color-text-secondary);
  stroke-opacity: 0.45;
}

.measure-range__mask {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.24);
  pointer-events: none;
}

html[data-scheme='dark'] .measure-range__mask {
  background: rgba(0, 0, 0, 0.45);
}

@media (prefers-color-scheme: dark) {
  html:not([data-scheme='light']) .measure-range__mask {
    background: rgba(0, 0, 0, 0.45);
  }
}

.measure-range__mask--left {
  left: 0;
}

.measure-range__mask--right {
  right: 0;
}

.measure-range__window {
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  border-top: 2px solid var(--color-accent);
  border-bottom: 2px solid var(--color-accent);
  background: rgba(10, 132, 255, 0.08);
  pointer-events: none;
}

.measure-range__handle {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--color-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
  cursor: ew-resize;
  z-index: 2;
  outline: none;
}

.measure-range__handle.is-active {
  z-index: 3;
}

.measure-range__grip {
  width: 2px;
  height: 14px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.92);
}

.measure-range__bubble {
  position: absolute;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--color-text-primary);
  color: var(--color-surface);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
  pointer-events: none;
  z-index: 5;
}

.measure-range__bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -4px;
  border: 4px solid transparent;
  border-top-color: var(--color-text-primary);
}
</style>
