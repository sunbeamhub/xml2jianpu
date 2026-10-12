<script setup>
/* global defineProps */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { persistDurationHudPos } from '../../utils/viewerPrefs.js'

const props = defineProps({
  variant: { type: String, default: 'arc' },
  showOnset: { type: Boolean, default: false },
  showDuration: { type: Boolean, default: false },
  onsetPercent: { type: Number, default: 16 },
  durationPercent: { type: Number, default: 16 },
  onsetCue: { type: Object, default: null },
  durationCue: { type: Object, default: null },
})

const LINE_W = 100
const LINE_H = 20
const ARC_W = 80
const ARC_H = 46
const DOT = 16
const STROKE = 2
const CX = 40
const CY = 44
const FACE_R = 37
const INNER_R = FACE_R - STROKE / 2
const ICON = 24
const ICON_GAP = 8
const CAP = 16
const ROW_GAP = 10

const placed = ref(null)
const dragging = ref(false)
let dragDx = 0
let dragDy = 0

const isLine = computed(() => props.variant === 'line')
const rowCount = computed(
  () => (props.showOnset ? 1 : 0) + (props.showDuration ? 1 : 0)
)
const rowHeight = computed(() => (isLine.value ? LINE_H : ARC_H) + 2 + CAP)
const hudSize = computed(() => ({
  w: (isLine.value ? LINE_W : ARC_W) + ICON + ICON_GAP,
  h: rowCount.value * rowHeight.value + Math.max(0, rowCount.value - 1) * ROW_GAP,
}))

persistDurationHudPos(null)

function pointOnFace(degFrom12, radius) {
  const rad = (degFrom12 * Math.PI) / 180
  return {
    x: CX + radius * Math.sin(rad),
    y: CY - radius * Math.cos(rad),
  }
}

const ringPath = computed(() => {
  const left = pointOnFace(-90, FACE_R)
  const right = pointOnFace(90, FACE_R)
  return `M ${left.x} ${left.y} A ${FACE_R} ${FACE_R} 0 0 1 ${right.x} ${right.y} Z`
})

function meterOf(getCue, getPercent) {
  const progress = computed(() => {
    const ratio = Math.max(0, Number(getCue()?.ratio) || 0)
    return Math.min(1, Math.max(0, ratio - 0.5))
  })
  const bandStyle = computed(() => {
    const p = Math.max(0, Math.min(50, Number(getPercent()) || 0)) / 100
    const left = Math.max(0, 0.5 - p)
    const right = Math.min(1, 0.5 + p)
    return {
      left: `${left * 100}%`,
      width: `${(right - left) * 100}%`,
    }
  })
  const sectorPath = computed(() => {
    const p = Math.max(0, Math.min(50, Number(getPercent()) || 0)) / 100
    const half = p * 180
    if (half <= 0) return ''
    const start = pointOnFace(-half, INNER_R)
    const end = pointOnFace(half, INNER_R)
    const large = half * 2 > 180 ? 1 : 0
    return `M ${CX} ${CY} L ${start.x} ${start.y} A ${INNER_R} ${INNER_R} 0 ${large} 1 ${end.x} ${end.y} Z`
  })
  const showMark = computed(() => Number.isFinite(Number(getCue()?.ratio)))
  const handPoint = computed(() => pointOnFace((progress.value - 0.5) * 180, INNER_R))
  const dotStyle = computed(() => ({
    left: `calc(${progress.value * 100}% - ${DOT / 2}px)`,
  }))
  const markStatus = computed(() => {
    const status = getCue()?.status
    if (
      status === 'ok' ||
      status === 'short' ||
      status === 'long' ||
      status === 'early' ||
      status === 'late'
    ) {
      return status
    }
    return 'holding'
  })
  return { progress, bandStyle, sectorPath, showMark, handPoint, dotStyle, markStatus }
}

const onsetMeter = meterOf(
  () => props.onsetCue,
  () => props.onsetPercent
)
const durationMeter = meterOf(
  () => props.durationCue,
  () => props.durationPercent
)

function clampPos(x, y) {
  const { w, h } = hudSize.value
  const maxX = Math.max(0, window.innerWidth - w)
  const maxY = Math.max(0, window.innerHeight - h)
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  }
}

function onPointerDown(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  dragging.value = true
  dragDx = event.clientX - rect.left
  dragDy = event.clientY - rect.top
  placed.value = clampPos(rect.left, rect.top)
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event) {
  if (!dragging.value) return
  placed.value = clampPos(event.clientX - dragDx, event.clientY - dragDy)
}

function onPointerUp(event) {
  if (!dragging.value) return
  dragging.value = false
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  } catch {
    /* ignore */
  }
  if (placed.value) persistDurationHudPos(placed.value)
}

function resetPlace() {
  dragging.value = false
  placed.value = null
  persistDurationHudPos(null)
}

function onResize() {
  resetPlace()
}

watch(hudSize, () => {
  if (!placed.value) return
  placed.value = clampPos(placed.value.x, placed.value.y)
  persistDurationHudPos(placed.value)
})

window.addEventListener('resize', onResize)
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  resetPlace()
})
</script>

<template>
  <div
    class="duration-hud"
    :class="{
      'is-placed': placed,
      'is-dragging': dragging,
      'duration-hud--line': isLine,
      'duration-hud--arc': !isLine,
    }"
    :style="placed ? { left: `${placed.x}px`, top: `${placed.y}px` } : null"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div v-if="showOnset" class="duration-hud__row" role="img" aria-label="落点判定">
      <svg class="duration-hud__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6" />
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
      <div class="duration-hud__meter">
        <div v-if="isLine" class="duration-hud__line" aria-hidden="true">
          <span class="duration-hud__track" />
          <span class="duration-hud__band" :style="onsetMeter.bandStyle.value" />
          <span class="duration-hud__target" />
          <span
            v-if="onsetMeter.showMark.value"
            class="duration-hud__dot"
            :class="`is-${onsetMeter.markStatus.value}`"
            :style="onsetMeter.dotStyle.value"
          />
        </div>
        <svg v-else class="duration-hud__face" viewBox="0 0 80 46" aria-hidden="true">
          <path v-if="onsetMeter.sectorPath.value" class="duration-hud__sector" :d="onsetMeter.sectorPath.value" />
          <path class="duration-hud__ring" :d="ringPath" />
          <line
            v-if="onsetMeter.showMark.value"
            class="duration-hud__hand"
            :class="`is-${onsetMeter.markStatus.value}`"
            :x1="CX"
            :y1="CY"
            :x2="onsetMeter.handPoint.value.x"
            :y2="onsetMeter.handPoint.value.y"
          />
        </svg>
        <div class="duration-hud__caps">
          <span>偏早</span>
          <span>偏晚</span>
        </div>
      </div>
    </div>
    <div v-if="showDuration" class="duration-hud__row" role="img" aria-label="时值判定">
      <svg class="duration-hud__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6.5 3.5h11M6.5 20.5h11"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
        <path
          d="M7.2 4.4c.3 3.2 2.3 4.7 4.8 6.8 2.5-2.1 4.5-3.6 4.8-6.8M7.2 19.6c.3-3.2 2.3-4.7 4.8-6.8 2.5 2.1 4.5 3.6 4.8 6.8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
      <div class="duration-hud__meter">
        <div v-if="isLine" class="duration-hud__line" aria-hidden="true">
          <span class="duration-hud__track" />
          <span class="duration-hud__band" :style="durationMeter.bandStyle.value" />
          <span class="duration-hud__target" />
          <span
            v-if="durationMeter.showMark.value"
            class="duration-hud__dot"
            :class="`is-${durationMeter.markStatus.value}`"
            :style="durationMeter.dotStyle.value"
          />
        </div>
        <svg v-else class="duration-hud__face" viewBox="0 0 80 46" aria-hidden="true">
          <path
            v-if="durationMeter.sectorPath.value"
            class="duration-hud__sector"
            :d="durationMeter.sectorPath.value"
          />
          <path class="duration-hud__ring" :d="ringPath" />
          <line
            v-if="durationMeter.showMark.value"
            class="duration-hud__hand"
            :class="`is-${durationMeter.markStatus.value}`"
            :x1="CX"
            :y1="CY"
            :x2="durationMeter.handPoint.value.x"
            :y2="durationMeter.handPoint.value.y"
          />
        </svg>
        <div class="duration-hud__caps">
          <span>偏短</span>
          <span>偏长</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.duration-hud {
  position: fixed;
  z-index: 30;
  left: calc(16px + var(--safe-area-left, env(safe-area-inset-left, 0px)));
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-primary);
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.duration-hud__row {
  display: flex;
  align-items: flex-start;
}

.duration-hud__row + .duration-hud__row {
  margin-top: 10px;
}

.duration-hud__icon {
  display: block;
  width: 24px;
  height: 24px;
  margin-right: 8px;
  flex-shrink: 0;
}

.duration-hud--line .duration-hud__icon {
  margin-top: -2px;
}

.duration-hud--arc .duration-hud__icon {
  margin-top: 11px;
}

.duration-hud__meter {
  min-width: 0;
}

.duration-hud__caps {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--color-text-secondary);
}

.duration-hud.is-placed {
  transform: none;
}

.duration-hud.is-dragging {
  cursor: grabbing;
}

.duration-hud__line {
  position: relative;
  width: 100px;
  height: 20px;
}

.duration-hud__track,
.duration-hud__band {
  position: absolute;
  top: 9px;
  height: 2px;
  border-radius: 1px;
}

.duration-hud__track {
  left: 0;
  right: 0;
  background: #c7c5ba;
}

.duration-hud__band {
  background: #378add;
}

.duration-hud__target {
  position: absolute;
  top: 3px;
  left: 50%;
  width: 1px;
  height: 14px;
  background: #5f5e5a;
}

.duration-hud__dot {
  position: absolute;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  background: #5f5e5a;
}

.duration-hud__dot.is-ok {
  background: var(--color-success);
}

.duration-hud__dot.is-short,
.duration-hud__dot.is-long,
.duration-hud__dot.is-early,
.duration-hud__dot.is-late {
  background: var(--color-danger);
}

.duration-hud__face {
  display: block;
  width: 80px;
  height: 46px;
  overflow: visible;
}

.duration-hud__ring {
  fill: none;
  stroke: #c7c5ba;
  stroke-width: 2;
}

.duration-hud__sector {
  fill: #378add;
}

.duration-hud__hand {
  stroke: #5f5e5a;
  stroke-width: 2;
  stroke-linecap: butt;
}

.duration-hud__hand.is-ok {
  stroke: var(--color-success);
}

.duration-hud__hand.is-short,
.duration-hud__hand.is-long,
.duration-hud__hand.is-early,
.duration-hud__hand.is-late {
  stroke: var(--color-danger);
}

html[data-scheme='dark'] .duration-hud__track {
  background: #5f5e5a;
}

html[data-scheme='dark'] .duration-hud__band,
html[data-scheme='dark'] .duration-hud__sector {
  background: #85b7eb;
  fill: #85b7eb;
}

html[data-scheme='dark'] .duration-hud__ring {
  stroke: #5f5e5a;
}

html[data-scheme='dark'] .duration-hud__target,
html[data-scheme='dark'] .duration-hud__dot.is-holding,
html[data-scheme='dark'] .duration-hud__hand.is-holding {
  background: #b4b2a9;
  stroke: #b4b2a9;
}

@media (prefers-color-scheme: dark) {
  html:not([data-scheme='light']) .duration-hud__track {
    background: #5f5e5a;
  }

  html:not([data-scheme='light']) .duration-hud__band,
  html:not([data-scheme='light']) .duration-hud__sector {
    background: #85b7eb;
    fill: #85b7eb;
  }

  html:not([data-scheme='light']) .duration-hud__ring {
    stroke: #5f5e5a;
  }

  html:not([data-scheme='light']) .duration-hud__target,
  html:not([data-scheme='light']) .duration-hud__dot.is-holding,
  html:not([data-scheme='light']) .duration-hud__hand.is-holding {
    background: #b4b2a9;
    stroke: #b4b2a9;
  }
}
</style>
