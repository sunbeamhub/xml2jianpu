<script setup>
/* global defineProps, defineEmits */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Switch from '../ui/Switch.vue'
import { armPageZoomBlock } from '../../utils/pageZoomBlock.js'
import {
  PLAYBACK_BPM_MAX,
  PLAYBACK_BPM_MIN,
  clampPlaybackBpm,
} from '../../utils/musicXmlSchedule.js'

const props = defineProps({
  modelValue: { type: Number, default: 100 },
  original: { type: Number, default: 100 },
})

const emit = defineEmits(['update:modelValue'])

const PPB = 9
const H = 78
const BASE = 32
const hasPointer =
  typeof window !== 'undefined' && typeof window.PointerEvent === 'function'

const bpm = ref(clampPlaybackBpm(props.modelValue))
const grabbing = ref(false)
const minusBtn = ref(null)
const plusBtn = ref(null)
const rulerEl = ref(null)
const canvasEl = ref(null)

let pos = bpm.value
let mode = 'idle'
let vel = 0
let raw = 0
let lastX = 0
let lastT = 0
let raf = 0
let lastFrame = 0
let resizeObserver = null
let reduceMotion = false
let reduceQuery = null
let onReduce = null
let holdTimer = 0
let holdDir = 0
let pointerHandled = false

const atMin = computed(() => bpm.value <= PLAYBACK_BPM_MIN)
const atMax = computed(() => bpm.value >= PLAYBACK_BPM_MAX)
const originBpm = computed(() => clampPlaybackBpm(props.original))
const atOriginal = computed(() => bpm.value === originBpm.value)
const speedLabel = computed(() => (atOriginal.value ? '速度' : '回到原速'))

function colors() {
  const cs = getComputedStyle(document.documentElement)
  const pick = (name, fallback) => cs.getPropertyValue(name).trim() || fallback
  return {
    tick: pick('--color-border', '#e2e2e2'),
    strong: pick('--color-text-secondary', '#8e8e93'),
    label: pick('--color-text-secondary', '#8e8e93'),
    accent: pick('--color-accent', '#0a84ff'),
    font: pick('--font-ui', 'sans-serif'),
  }
}

function commit(next) {
  const value = clampPlaybackBpm(next)
  if (value === bpm.value) return
  bpm.value = value
  emit('update:modelValue', value)
}

function syncFromPos() {
  commit(pos)
}

function setBpm(next) {
  const value = clampPlaybackBpm(next)
  if (mode === 'inertia' || mode === 'drag') mode = 'ease'
  commit(value)
  if (pos !== bpm.value) {
    mode = 'ease'
    kick()
  } else {
    draw()
  }
}

function draw() {
  const canvas = canvasEl.value
  const ruler = rulerEl.value
  if (!canvas || !ruler) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const width = ruler.clientWidth || 300
  const dpr = window.devicePixelRatio || 1
  const pixelW = Math.round(width * dpr)
  const pixelH = Math.round(H * dpr)
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW
    canvas.height = pixelH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const c = colors()
  const cx = width / 2
  ctx.clearRect(0, 0, width, H)
  const lo = Math.max(PLAYBACK_BPM_MIN, Math.ceil(pos - cx / PPB))
  const hi = Math.min(PLAYBACK_BPM_MAX, Math.floor(pos + cx / PPB))
  ctx.textAlign = 'center'
  ctx.font = `11px ${c.font}`
  for (let i = lo; i <= hi; i += 1) {
    const x = Math.round(cx + (i - pos) * PPB) + 0.5
    const major = i % 10 === 0
    const mid = i % 5 === 0
    const end = i === PLAYBACK_BPM_MIN || i === PLAYBACK_BPM_MAX
    const tickH = end ? 30 : major ? 26 : mid ? 19 : 11
    ctx.beginPath()
    ctx.strokeStyle = major || end ? c.strong : c.tick
    ctx.lineWidth = end ? 2 : major ? 1.5 : 1
    ctx.moveTo(x, BASE)
    ctx.lineTo(x, BASE - tickH)
    ctx.stroke()
    if (major) {
      ctx.fillStyle = c.label
      ctx.fillText(String(i), x, BASE + 16)
    }
  }
  const origin = clampPlaybackBpm(props.original)
  const ox = cx + (origin - pos) * PPB
  if (ox > -20 && ox < width + 20) {
    ctx.fillStyle = c.accent
    ctx.beginPath()
    ctx.moveTo(ox, BASE + 24)
    ctx.lineTo(ox - 4, BASE + 31)
    ctx.lineTo(ox + 4, BASE + 31)
    ctx.closePath()
    ctx.fill()
    ctx.font = `10px ${c.font}`
    ctx.fillStyle = c.label
    ctx.fillText('原速', ox, BASE + 43)
  }
}

function kick() {
  if (raf) return
  lastFrame = 0
  const step = (t) => {
    const dt = lastFrame ? Math.min(50, t - lastFrame) : 16
    lastFrame = t
    let busy = false
    if (mode === 'inertia') {
      pos += vel * dt
      vel *= Math.exp(-dt / 320)
      if (pos <= PLAYBACK_BPM_MIN) {
        pos = PLAYBACK_BPM_MIN
        vel = 0
      }
      if (pos >= PLAYBACK_BPM_MAX) {
        pos = PLAYBACK_BPM_MAX
        vel = 0
      }
      syncFromPos()
      if (Math.abs(vel) < 0.003) mode = 'ease'
      busy = true
    }
    if (mode === 'ease') {
      const d = bpm.value - pos
      if (Math.abs(d) < 0.005 || reduceMotion) {
        pos = bpm.value
        mode = 'idle'
      } else {
        pos += d * (1 - Math.exp(-dt / 80))
        busy = true
      }
    }
    draw()
    if (busy && mode !== 'idle' && mode !== 'drag') raf = requestAnimationFrame(step)
    else raf = 0
  }
  raf = requestAnimationFrame(step)
}

function onRulerDown(ev) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return
  if (ev.button != null && ev.button !== 0 && ev.pointerType == null) return
  const el = rulerEl.value
  try {
    el?.setPointerCapture?.(ev.pointerId)
  } catch {
    /* 指针已经结束时忽略 */
  }
  mode = 'drag'
  raw = pos
  vel = 0
  lastX = ev.clientX
  lastT = ev.timeStamp
  grabbing.value = true
}

function onRulerMove(ev) {
  if (mode !== 'drag') return
  const dx = ev.clientX - lastX
  const dtm = Math.max(1, ev.timeStamp - lastT)
  const dv = -dx / PPB
  raw += dv
  vel = vel * 0.6 + (dv / dtm) * 0.4
  lastX = ev.clientX
  lastT = ev.timeStamp
  const clamped = Math.max(PLAYBACK_BPM_MIN, Math.min(PLAYBACK_BPM_MAX, raw))
  const over = raw - clamped
  pos =
    clamped +
    (over ? Math.sign(over) * Math.min(3, Math.abs(over) * 0.3) : 0)
  syncFromPos()
  draw()
}

function onRulerUp(ev) {
  if (mode !== 'drag') return
  grabbing.value = false
  try {
    rulerEl.value?.releasePointerCapture?.(ev?.pointerId)
  } catch {
    /* ignore */
  }
  if (ev && ev.timeStamp - lastT > 90) vel = 0
  const inside = pos >= PLAYBACK_BPM_MIN && pos <= PLAYBACK_BPM_MAX
  if (Math.abs(vel) > 0.02 && !reduceMotion && inside) mode = 'inertia'
  else mode = 'ease'
  kick()
}

function onRulerKey(ev) {
  const key = ev.key
  const shift = ev.shiftKey ? 10 : 1
  let next = null
  if (key === 'ArrowLeft' || key === 'ArrowDown') next = bpm.value - shift
  else if (key === 'ArrowRight' || key === 'ArrowUp') next = bpm.value + shift
  else if (key === 'PageDown') next = bpm.value - 10
  else if (key === 'PageUp') next = bpm.value + 10
  else if (key === 'Home') next = PLAYBACK_BPM_MIN
  else if (key === 'End') next = PLAYBACK_BPM_MAX
  if (next == null) return
  ev.preventDefault()
  setBpm(next)
}

function stopHold() {
  if (holdTimer) {
    clearTimeout(holdTimer)
    holdTimer = 0
  }
  holdDir = 0
}

function atEdge(dir) {
  return dir < 0 ? bpm.value <= PLAYBACK_BPM_MIN : bpm.value >= PLAYBACK_BPM_MAX
}

function startHold(ev, dir) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return
  if (ev.button != null && ev.button !== 0 && ev.pointerType == null) return
  if (atEdge(dir)) return
  if (ev.cancelable) ev.preventDefault()
  pointerHandled = true
  armPageZoomBlock()
  stopHold()
  const step = ev.shiftKey ? 10 : 1
  holdDir = dir
  setBpm(bpm.value + dir * step)
  let n = 0
  const loop = () => {
    if (holdDir !== dir || atEdge(dir)) {
      stopHold()
      return
    }
    setBpm(bpm.value + dir * step)
    n += 1
    const delay = n < 8 ? 110 : n < 24 ? 60 : 35
    holdTimer = window.setTimeout(loop, delay)
  }
  holdTimer = window.setTimeout(loop, 400)
}

function onKeyClick(ev, dir) {
  if (pointerHandled) {
    pointerHandled = false
    return
  }
  if (ev.detail !== 0) return
  if (atEdge(dir)) return
  const step = ev.shiftKey ? 10 : 1
  setBpm(bpm.value + dir * step)
}

function onTempoSwitch(on) {
  if (on) return
  setBpm(props.original)
}

function bindHoldTarget(el, dir) {
  if (!el) return () => {}
  if (hasPointer) {
    const down = (ev) => startHold(ev, dir)
    const up = () => stopHold()
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', up)
    }
  }
  const down = (ev) => startHold(ev, dir)
  const up = () => stopHold()
  el.addEventListener('mousedown', down)
  el.addEventListener('mouseup', up)
  el.addEventListener('mouseleave', up)
  el.addEventListener('touchstart', down, { passive: false })
  el.addEventListener('touchend', up)
  el.addEventListener('touchcancel', up)
  return () => {
    el.removeEventListener('mousedown', down)
    el.removeEventListener('mouseup', up)
    el.removeEventListener('mouseleave', up)
    el.removeEventListener('touchstart', down)
    el.removeEventListener('touchend', up)
    el.removeEventListener('touchcancel', up)
  }
}

let unbindMinus = () => {}
let unbindPlus = () => {}
let unbindRuler = () => {}

function bindRuler(el) {
  if (!el) return () => {}
  if (hasPointer) {
    const down = (ev) => onRulerDown(ev)
    const move = (ev) => onRulerMove(ev)
    const up = (ev) => onRulerUp(ev)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('keydown', onRulerKey)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('keydown', onRulerKey)
    }
  }
  const downMouse = (ev) => onRulerDown(ev)
  const moveMouse = (ev) => onRulerMove(ev)
  const upMouse = (ev) => onRulerUp(ev)
  const downTouch = (ev) => {
    const touch = ev.changedTouches?.[0]
    if (!touch) return
    if (ev.cancelable) ev.preventDefault()
    onRulerDown({
      clientX: touch.clientX,
      timeStamp: ev.timeStamp,
      button: 0,
    })
  }
  const moveTouch = (ev) => {
    const touch = ev.changedTouches?.[0]
    if (!touch || mode !== 'drag') return
    if (ev.cancelable) ev.preventDefault()
    onRulerMove({ clientX: touch.clientX, timeStamp: ev.timeStamp })
  }
  const upTouch = (ev) => {
    onRulerUp({ timeStamp: ev.timeStamp })
  }
  el.addEventListener('mousedown', downMouse)
  window.addEventListener('mousemove', moveMouse)
  window.addEventListener('mouseup', upMouse)
  el.addEventListener('touchstart', downTouch, { passive: false })
  el.addEventListener('touchmove', moveTouch, { passive: false })
  el.addEventListener('touchend', upTouch)
  el.addEventListener('touchcancel', upTouch)
  el.addEventListener('keydown', onRulerKey)
  return () => {
    el.removeEventListener('mousedown', downMouse)
    window.removeEventListener('mousemove', moveMouse)
    window.removeEventListener('mouseup', upMouse)
    el.removeEventListener('touchstart', downTouch)
    el.removeEventListener('touchmove', moveTouch)
    el.removeEventListener('touchend', upTouch)
    el.removeEventListener('touchcancel', upTouch)
    el.removeEventListener('keydown', onRulerKey)
  }
}

watch(
  () => props.modelValue,
  (value) => {
    const next = clampPlaybackBpm(value)
    if (next === bpm.value) return
    bpm.value = next
    if (mode === 'drag') return
    mode = 'ease'
    kick()
  }
)

watch(
  () => props.original,
  () => draw()
)

onMounted(() => {
  reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduceMotion = !!reduceQuery.matches
  onReduce = () => {
    reduceMotion = !!reduceQuery.matches
  }
  if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onReduce)
  else if (reduceQuery.addListener) reduceQuery.addListener(onReduce)
  unbindMinus = bindHoldTarget(minusBtn.value, -1)
  unbindPlus = bindHoldTarget(plusBtn.value, 1)
  unbindRuler = bindRuler(rulerEl.value)
  if (typeof window.ResizeObserver === 'function' && rulerEl.value) {
    resizeObserver = new ResizeObserver(() => draw())
    resizeObserver.observe(rulerEl.value)
  } else {
    window.addEventListener('resize', draw)
  }
  draw()
})

onBeforeUnmount(() => {
  stopHold()
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  unbindMinus()
  unbindPlus()
  unbindRuler()
  if (resizeObserver) resizeObserver.disconnect()
  else window.removeEventListener('resize', draw)
  if (reduceQuery && onReduce) {
    if (reduceQuery.removeEventListener) reduceQuery.removeEventListener('change', onReduce)
    else if (reduceQuery.removeListener) reduceQuery.removeListener(onReduce)
  }
})
</script>

<template>
  <div class="bpm-control">
    <div class="bpm-head">
      <span class="bpm-title">{{ speedLabel }}</span>
      <Switch
        :model-value="!atOriginal"
        :label="speedLabel"
        @update:model-value="onTempoSwitch"
      />
    </div>
    <div class="bpm-stepper">
      <button
        ref="minusBtn"
        type="button"
        class="bpm-round"
        :disabled="atMin"
        aria-label="减慢 1 BPM"
        @click="onKeyClick($event, -1)"
      >
        <svg class="bpm-round-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
      <div class="bpm-readout">
        <div class="bpm-num-line">
          <span class="bpm-num">{{ bpm }}</span><span class="bpm-unit">BPM</span>
        </div>
        <div class="bpm-origin">原速 {{ originBpm }} BPM</div>
      </div>
      <button
        ref="plusBtn"
        type="button"
        class="bpm-round"
        :disabled="atMax"
        aria-label="加快 1 BPM"
        @click="onKeyClick($event, 1)"
      >
        <svg class="bpm-round-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <div
      ref="rulerEl"
      class="bpm-ruler"
      :class="{ 'is-grabbing': grabbing }"
      role="slider"
      tabindex="0"
      aria-label="速度标尺，左右拖动调节"
      :aria-valuemin="PLAYBACK_BPM_MIN"
      :aria-valuemax="PLAYBACK_BPM_MAX"
      :aria-valuenow="bpm"
      :aria-valuetext="`${bpm} BPM`"
    >
      <canvas ref="canvasEl" />
      <span class="bpm-needle" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.bpm-control {
  margin-top: 16px;
}

.bpm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.bpm-title {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.3;
}

.bpm-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 12px;
  padding: 16px;
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
}

.bpm-stepper > * + * {
  margin-left: 8px;
}

.bpm-readout {
  flex: 1;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
}

.bpm-num {
  font-size: 32px;
  font-weight: 500;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.bpm-origin {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.3;
  color: var(--color-text-secondary);
}

.bpm-unit {
  margin-left: 6px;
  font-size: 13px;
  line-height: 1.2;
  color: var(--color-text-secondary);
}

.bpm-round {
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  color: inherit;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  touch-action: manipulation;
}

.bpm-round-icon {
  display: block;
  flex-shrink: 0;
}

.bpm-round:hover:not(:disabled) {
  background: var(--color-menu-divider);
}

.bpm-round:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bpm-ruler {
  position: relative;
  height: 78px;
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.bpm-ruler.is-grabbing {
  cursor: grabbing;
}

.bpm-ruler canvas {
  display: block;
  width: 100%;
  height: 100%;
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 16%, #000 84%, transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 16%, #000 84%, transparent 100%);
}

.bpm-needle {
  position: absolute;
  left: 50%;
  top: 0;
  width: 2px;
  height: 34px;
  margin-left: -1px;
  background: var(--color-accent);
  border-radius: 0 0 2px 2px;
  pointer-events: none;
}
</style>
