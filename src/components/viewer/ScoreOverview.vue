<template>
  <Teleport to="body">
    <div
      ref="railEl"
      class="score-overview"
      :style="{ width: railPx + 'px' }"
      role="slider"
      aria-label="乐谱总览"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="valueNow"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click.stop
    >
      <div
        ref="sheetEl"
        class="score-overview-sheet"
        :style="sheetStyle"
        aria-hidden="true"
      />
      <div class="score-overview-box" :style="boxStyle" />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearElement } from '../../utils/osmdRenderer.js'
import { OVERVIEW_RAIL_PX } from '../../utils/scoreOverview.js'

const props = defineProps({
  stageEl: { type: Object, default: null },
  pageEl: { type: Object, default: null },
  contentW: { type: Number, default: 1 },
  contentH: { type: Number, default: 1 },
  epoch: { type: Number, default: 0 },
})

const PAD = 4
const railPx = OVERVIEW_RAIL_PX
const railEl = ref(null)
const sheetEl = ref(null)
const sheetStyle = ref({})
const boxTop = ref(0)
const boxHeight = ref(8)
const valueNow = ref(0)

/** @type {{ x: number, y: number, drawW: number, drawH: number }} */
let mapGeom = { x: PAD, y: PAD, drawW: 1, drawH: 1 }
let dragging = false
let resizeObserver = null
let scrollEl = null
/** iOS 12 没有 PointerEvent，改走 Touch Events */
let usePointer = false

const boxStyle = computed(() => ({
  top: `${boxTop.value}px`,
  height: `${boxHeight.value}px`,
}))

function scroller() {
  const page = props.pageEl
  if (!page || typeof page.closest !== 'function') return null
  return page.closest('.app-scroll')
}

function stripClone(root) {
  if (!root || !root.querySelectorAll) return
  root.querySelectorAll('.jianpu-playhead').forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el)
  })
  root.querySelectorAll('img[id^="cursorImg"]').forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el)
  })
  if (root.removeAttribute) root.removeAttribute('id')
  root.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
}

function layoutSheet() {
  const rail = railEl.value
  const w = Math.max(1, props.contentW)
  const h = Math.max(1, props.contentH)
  const railW = rail && rail.clientWidth > 1 ? rail.clientWidth : railPx
  const railH = rail && rail.clientHeight > 1 ? rail.clientHeight : 1
  const innerW = Math.max(1, railW - PAD * 2)
  const innerH = Math.max(1, railH - PAD * 2)
  const s = Math.min(innerW / w, innerH / h)
  const drawW = w * s
  const drawH = h * s
  const x = PAD + Math.max(0, (innerW - drawW) / 2)
  mapGeom = { x, y: PAD, drawW, drawH }
  sheetStyle.value = {
    width: `${w}px`,
    height: `${h}px`,
    transform: `translate(${x}px, ${PAD}px) scale(${s})`,
  }
}

function updateBox() {
  const scroll = scroller()
  const stage = props.stageEl
  if (!scroll || !stage) return
  if (mapGeom.drawH < 1) layoutSheet()
  const scrollRect = scroll.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const stageH = stageRect.height || 1
  const visTop = Math.min(stageH, Math.max(0, scrollRect.top - stageRect.top))
  const visBottom = Math.min(stageH, Math.max(0, scrollRect.bottom - stageRect.top))
  const topRatio = visTop / stageH
  const heightRatio = Math.max(0, visBottom - visTop) / stageH
  const drawH = mapGeom.drawH || 1
  const rawH = Math.min(drawH, Math.max(8, heightRatio * drawH))
  const rawTop = mapGeom.y + topRatio * drawH
  const maxTop = mapGeom.y + drawH - rawH
  boxTop.value = Math.min(Math.max(mapGeom.y, rawTop), Math.max(mapGeom.y, maxTop))
  boxHeight.value = rawH
  const span = Math.max(1, drawH - rawH)
  valueNow.value = Math.round(((boxTop.value - mapGeom.y) / span) * 100)
}

function updateFrame() {
  layoutSheet()
  updateBox()
}

function refreshClone() {
  const stage = props.stageEl
  const host = sheetEl.value
  if (!stage || !host) return
  clearElement(host)
  for (let i = 0; i < stage.children.length; i++) {
    const copy = stage.children[i].cloneNode(true)
    stripClone(copy)
    host.appendChild(copy)
  }
  layoutSheet()
  updateBox()
}

function ratioFromClientY(clientY) {
  const rail = railEl.value
  if (!rail || mapGeom.drawH <= 0) return 0
  const y = clientY - rail.getBoundingClientRect().top - mapGeom.y
  return Math.min(1, Math.max(0, y / mapGeom.drawH))
}

function scrollToRatio(ratio) {
  const scroll = scroller()
  const stage = props.stageEl
  if (!scroll || !stage) return
  const scrollRect = scroll.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const stageTop = stageRect.top - scrollRect.top + scroll.scrollTop
  const stageH = stageRect.height || 1
  const target = stageTop + ratio * stageH - scroll.clientHeight / 2
  const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
  scroll.scrollTop = Math.min(maxTop, Math.max(0, target))
}

function onPointerDown(e) {
  if (!usePointer) return
  if (e.button != null && e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  dragging = true
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch (_) {
    /* 旧 WebKit 没有 pointer capture */
  }
  scrollToRatio(ratioFromClientY(e.clientY))
}

function onPointerMove(e) {
  if (!usePointer || !dragging) return
  e.preventDefault()
  scrollToRatio(ratioFromClientY(e.clientY))
}

function onPointerUp(e) {
  if (!usePointer) return
  dragging = false
  try {
    e.currentTarget.releasePointerCapture(e.pointerId)
  } catch (_) {
    /* ignore */
  }
  updateFrame()
}

function onTouchStart(e) {
  if (!e.touches || e.touches.length !== 1) return
  e.preventDefault()
  dragging = true
  scrollToRatio(ratioFromClientY(e.touches[0].clientY))
}

function onTouchMove(e) {
  if (!dragging || !e.touches || !e.touches.length) return
  e.preventDefault()
  scrollToRatio(ratioFromClientY(e.touches[0].clientY))
}

function onTouchEnd() {
  dragging = false
  updateFrame()
}

function bindScroll() {
  const next = scroller()
  if (next === scrollEl) return
  if (scrollEl) scrollEl.removeEventListener('scroll', updateBox)
  scrollEl = next
  if (scrollEl) scrollEl.addEventListener('scroll', updateBox, { passive: true })
}

function bindTouch(rail) {
  rail.addEventListener('touchstart', onTouchStart, { passive: false })
  rail.addEventListener('touchmove', onTouchMove, { passive: false })
  rail.addEventListener('touchend', onTouchEnd)
  rail.addEventListener('touchcancel', onTouchEnd)
}

function unbindTouch(rail) {
  rail.removeEventListener('touchstart', onTouchStart)
  rail.removeEventListener('touchmove', onTouchMove)
  rail.removeEventListener('touchend', onTouchEnd)
  rail.removeEventListener('touchcancel', onTouchEnd)
}

watch(
  () => props.epoch,
  () => {
    nextTick(() => refreshClone())
  }
)

watch(
  () => [props.contentW, props.contentH, props.stageEl],
  () => {
    nextTick(() => updateFrame())
  }
)

onMounted(() => {
  usePointer = typeof window.PointerEvent === 'function'
  bindScroll()
  refreshClone()
  window.addEventListener('resize', updateFrame)
  const rail = railEl.value
  if (!usePointer && rail) bindTouch(rail)
  if (typeof ResizeObserver !== 'undefined' && rail) {
    resizeObserver = new ResizeObserver(() => {
      updateFrame()
    })
    resizeObserver.observe(rail)
  }
})

onBeforeUnmount(() => {
  if (scrollEl) scrollEl.removeEventListener('scroll', updateBox)
  scrollEl = null
  window.removeEventListener('resize', updateFrame)
  if (railEl.value) unbindTouch(railEl.value)
  if (resizeObserver) resizeObserver.disconnect()
})
</script>

<style scoped>
.score-overview {
  position: fixed;
  z-index: 30;
  top: calc(12px + var(--safe-area-top, env(safe-area-inset-top, 0px)));
  right: calc(16px + var(--safe-area-right, env(safe-area-inset-right, 0px)));
  bottom: calc(16px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  box-sizing: border-box;
  overflow: hidden;
  border-radius: var(--radius-control);
  background: var(--color-surface);
  box-shadow: var(--shadow-raised);
  touch-action: none;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}

.score-overview:focus,
.score-overview:focus-visible {
  outline: none;
}

.score-overview-sheet {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  transform-origin: 0 0;
  pointer-events: none;
  overflow: hidden;
}

.score-overview-box {
  position: absolute;
  left: 4px;
  right: 4px;
  box-sizing: border-box;
  border: 2px solid var(--color-accent);
  border-radius: var(--radius-control);
  background: transparent;
  pointer-events: none;
}
</style>
