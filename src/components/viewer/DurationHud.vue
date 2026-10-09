<script setup>
/* global defineProps */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { persistDurationHudPos } from '../../utils/viewerPrefs.js'

const props = defineProps({
  variant: { type: String, default: 'arc' },
  percent: { type: Number, default: 16 },
  cue: { type: Object, default: null },
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

const placed = ref(null)
const dragging = ref(false)
let dragDx = 0
let dragDy = 0

const isLine = computed(() => props.variant === 'line')
const hudSize = computed(() =>
  isLine.value ? { w: LINE_W, h: LINE_H } : { w: ARC_W, h: ARC_H }
)

persistDurationHudPos(null)

function pointOnFace(degFrom12, radius) {
  const rad = (degFrom12 * Math.PI) / 180
  return {
    x: CX + radius * Math.sin(rad),
    y: CY - radius * Math.cos(rad),
  }
}

const progress = computed(() => {
  const ratio = Math.max(0, Number(props.cue?.ratio) || 0)
  return Math.min(1, Math.max(0, ratio - 0.5))
})

const bandStyle = computed(() => {
  const p = Math.max(0, Math.min(50, Number(props.percent) || 0)) / 100
  const left = Math.max(0, 0.5 - p)
  const right = Math.min(1, 0.5 + p)
  return {
    left: `${left * 100}%`,
    width: `${(right - left) * 100}%`,
  }
})

const ringPath = computed(() => {
  const left = pointOnFace(-90, FACE_R)
  const right = pointOnFace(90, FACE_R)
  return `M ${left.x} ${left.y} A ${FACE_R} ${FACE_R} 0 0 1 ${right.x} ${right.y} Z`
})

const sectorPath = computed(() => {
  const p = Math.max(0, Math.min(50, Number(props.percent) || 0)) / 100
  const half = p * 180
  if (half <= 0) return ''
  const start = pointOnFace(-half, INNER_R)
  const end = pointOnFace(half, INNER_R)
  const large = half * 2 > 180 ? 1 : 0
  return `M ${CX} ${CY} L ${start.x} ${start.y} A ${INNER_R} ${INNER_R} 0 ${large} 1 ${end.x} ${end.y} Z`
})

const showMark = computed(() => {
  const ratio = Number(props.cue?.ratio)
  return Number.isFinite(ratio)
})

const handPoint = computed(() => pointOnFace((progress.value - 0.5) * 180, INNER_R))

const dotStyle = computed(() => ({
  left: `calc(${progress.value * 100}% - ${DOT / 2}px)`,
}))

const markStatus = computed(() => {
  const status = props.cue?.status
  if (status === 'ok' || status === 'short' || status === 'long') return status
  return 'holding'
})

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
    <div v-if="isLine" class="duration-hud__line" aria-hidden="true">
      <span class="duration-hud__track" />
      <span class="duration-hud__band" :style="bandStyle" />
      <span class="duration-hud__target" />
      <span
        v-if="showMark"
        class="duration-hud__dot"
        :class="`is-${markStatus}`"
        :style="dotStyle"
      />
    </div>
    <svg v-else class="duration-hud__face" viewBox="0 0 80 46" aria-hidden="true">
      <path v-if="sectorPath" class="duration-hud__sector" :d="sectorPath" />
      <path class="duration-hud__ring" :d="ringPath" />
      <line
        v-if="showMark"
        class="duration-hud__hand"
        :class="`is-${markStatus}`"
        :x1="CX"
        :y1="CY"
        :x2="handPoint.x"
        :y2="handPoint.y"
      />
    </svg>
  </div>
</template>

<style scoped>
.duration-hud {
  position: fixed;
  z-index: 30;
  left: calc(16px + var(--safe-area-left, env(safe-area-inset-left, 0px)));
  top: 50%;
  transform: translateY(-50%);
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.duration-hud--line {
  width: 100px;
  height: 20px;
}

.duration-hud--arc {
  width: 80px;
  height: 46px;
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
.duration-hud__dot.is-long {
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
.duration-hud__hand.is-long {
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
