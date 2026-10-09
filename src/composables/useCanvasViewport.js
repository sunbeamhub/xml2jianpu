import { computed, ref } from "vue";
import { NOTATION_JIANPU } from "../utils/osmdRenderer.js";
import { getScoreAudioSeconds } from "../utils/scoreAudioPlayer.js";

export function useCanvasViewport(deps) {
  const {
    bridge,
    svg,
    osmdHost,
    pageEl,
    viewport,
    notationMode,
    isDesktop,
    fitSidePad: FIT_SIDE_PAD,
    overviewActive,
  } = deps;

const contentW = ref(1)
const contentH = ref(1)
/** 刚好铺满容器宽度的缩放 */
const fitScale = ref(1)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
/** 是否仍处于「适配缩放」（未手动放大） */
const atFitScale = ref(true)

const MAX_ZOOM_RATIO = 4
/** 缩放模式可缩到铺满宽度的 1/3；总览模式与缩放互斥，不走这条下限 */
const MIN_ZOOM_OUT_RATIO = 1 / 3
const FIT_EPS = 0.001
const AXIS_LOCK_PX = 8
const TAP_MOVE_PX = 10

const isPinching = ref(false)
const wrapStyle = computed(() => ({
  touchAction: isPinching.value ? 'none' : 'pan-y',
}))

const spacerStyle = computed(() => ({
  // 宽度始终跟容器，避免放大后撑出横向页面滚动条
  width: '100%',
  position: 'relative',
  height: `${Math.max(1, contentH.value * scale.value)}px`,
}))

const stageStyle = computed(() => ({
  width: `${contentW.value}px`,
  height: `${contentH.value}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
  cursor: scale.value > fitScale.value + FIT_EPS ? 'grab' : 'default',
}))

/** 视口宽度（响应式，供标题/功能区对齐） */
const viewportW = ref(1)

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function getViewportWidth() {
  return viewport.value?.clientWidth || window.innerWidth || 1
}

function getRenderViewportHeight() {
  const vh = window.innerHeight || document.documentElement.clientHeight || 800
  return Math.max(120, vh - 112)
}

function syncViewportWidth() {
  viewportW.value = getViewportWidth()
}

function computeFitScale() {
  const vw = getViewportWidth()
  const usable = Math.max(1, vw - 2 * FIT_SIDE_PAD)
  const w = Math.max(1, contentW.value)
  return Math.min(1, usable / w)
}

/** 横向限制在可视区内；纵向交给页面滚动，ty 固定为 0 */
function clampPan(nextTx, _nextTy, nextScale = scale.value) {
  const vw = getViewportWidth()
  const scaledW = contentW.value * nextScale
  let x
  if (scaledW <= vw) {
    x = (vw - scaledW) / 2
  } else {
    x = clamp(nextTx, vw - scaledW, 0)
  }
  return { x, y: 0 }
}

/** 用户手动滚动后，自动跟随至少停这么久；连续滚动会顺延 */
const FOLLOW_PAUSE_MS = 3000
const FOLLOW_ANIM_MS = 200
/** 视口中间这一段里已有高亮时不再滚 */
const FOLLOW_BAND = 0.25
let followPausedUntil = 0
let followResumeTimer = 0
let followAnimId = 0
/** @type {null | { top: number, tx: number }} */
let followAnim = null
let followIgnoreScroll = false
/** @type {number | null} */
let lastProgrammaticTop = null
/** @type {HTMLElement | null} */
let appScrollEl = null

function appScroller() {
  return pageEl.value?.closest('.app-scroll') || appScrollEl
}

function cancelFollowAnim() {
  if (followAnimId) {
    cancelAnimationFrame(followAnimId)
    followAnimId = 0
  }
  followAnim = null
  followIgnoreScroll = false
}

function scheduleFollowResume() {
  if (followResumeTimer) clearTimeout(followResumeTimer)
  const delay = Math.max(0, followPausedUntil - performance.now())
  followResumeTimer = window.setTimeout(() => {
    followResumeTimer = 0
    followHighlight()
  }, delay)
}

function armFollowPause() {
  cancelFollowAnim()
  followPausedUntil = performance.now() + FOLLOW_PAUSE_MS
  scheduleFollowResume()
}

function onAppScroll() {
  const scroller = appScroller()
  if (!scroller) return
  if (followIgnoreScroll) return
  if (
    lastProgrammaticTop != null &&
    Math.abs(scroller.scrollTop - lastProgrammaticTop) < 2
  ) {
    return
  }
  if (!bridge.noteHighlightVisible() && !followAnim) return
  armFollowPause()
}

function onFollowWheel(e) {
  if (e.ctrlKey || e.metaKey) return
  if (!bridge.noteHighlightVisible() && !followAnim) return
  armFollowPause()
}

function writeFollowScroll(scroller, top) {
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const next = clamp(top, 0, maxTop)
  lastProgrammaticTop = next
  if (Math.abs(scroller.scrollTop - next) < 0.5) return
  followIgnoreScroll = true
  scroller.scrollTop = next
  lastProgrammaticTop = scroller.scrollTop
  followIgnoreScroll = false
}

function highlightClientRect() {
  /** @type {Element[]} */
  const nodes = []
  if (notationMode.value === NOTATION_JIANPU) {
    svg.value?.querySelectorAll('.jianpu-playhead').forEach((el) => {
      if (el.getAttribute('visibility') === 'hidden') return
      nodes.push(el)
    })
    const now = getScoreAudioSeconds()
    let latest = null
    for (const el of nodes) {
      const t = Number(el.getAttribute('data-onset'))
      if (!Number.isFinite(t) || t > now + 1e-3) continue
      if (latest == null || t > latest) latest = t
    }
    if (latest != null) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const t = Number(nodes[i].getAttribute('data-onset'))
        if (!Number.isFinite(t) || Math.abs(t - latest) > 1e-6) nodes.splice(i, 1)
      }
    }
  } else {
    osmdHost.value?.querySelectorAll('img[id^="cursorImg"]').forEach((el) => {
      if (getComputedStyle(el).display === 'none') return
      nodes.push(el)
    })
  }
  if (!nodes.length) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const el of nodes) {
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 && rect.height < 1) continue
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left)) return null
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  }
}

function followTarget() {
  const scroller = appScroller()
  const box = highlightClientRect()
  if (!scroller || !box) return null
  const view = scroller.getBoundingClientRect()
  if (view.width < 1 || view.height < 1) return null
  const vOverflow = scroller.scrollHeight > scroller.clientHeight + 1
  const hOverflow = contentW.value * scale.value > scroller.clientWidth + 1
  if (!vOverflow && !hOverflow) return null

  const inY =
    !vOverflow ||
    (box.cy >= view.top + view.height * FOLLOW_BAND &&
      box.cy <= view.bottom - view.height * FOLLOW_BAND)
  const inX =
    !hOverflow ||
    (box.cx >= view.left + view.width * FOLLOW_BAND &&
      box.cx <= view.right - view.width * FOLLOW_BAND)
  if (inY && inX) return null

  let top = scroller.scrollTop
  if (!inY) {
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    top = clamp(
      scroller.scrollTop + (box.cy - (view.top + view.height / 2)),
      0,
      maxTop
    )
  }
  let nextTx = tx.value
  if (!inX) {
    nextTx = clampPan(
      tx.value - (box.cx - (view.left + view.width / 2)),
      0,
      scale.value
    ).x
  }
  if (Math.abs(top - scroller.scrollTop) < 8 && Math.abs(nextTx - tx.value) < 8) {
    return null
  }
  return { top, tx: nextTx }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function startFollowAnim(target) {
  const scroller = appScroller()
  if (!scroller) return
  cancelFollowAnim()
  const fromTop = scroller.scrollTop
  const fromTx = tx.value
  const t0 = performance.now()
  followAnim = { top: target.top, tx: target.tx }

  function step(now) {
    if (performance.now() < followPausedUntil) {
      cancelFollowAnim()
      return
    }
    const k = easeOutCubic(Math.min(1, (now - t0) / FOLLOW_ANIM_MS))
    writeFollowScroll(scroller, fromTop + (target.top - fromTop) * k)
    if (!followAnim) return
    const pan = clampPan(fromTx + (target.tx - fromTx) * k, 0, scale.value)
    tx.value = pan.x
    ty.value = pan.y
    if (k < 1) {
      followAnimId = requestAnimationFrame(step)
      return
    }
    followAnimId = 0
    followAnim = null
  }

  followAnimId = requestAnimationFrame(step)
}

function followHighlight() {
  try {
    if (!bridge.noteHighlightVisible()) {
      cancelFollowAnim()
      return
    }
    if (isPinching.value) return
    if (performance.now() < followPausedUntil) return
    const target = followTarget()
    if (!target) return
    if (
      followAnim &&
      Math.abs(followAnim.top - target.top) < 12 &&
      Math.abs(followAnim.tx - target.tx) < 12
    ) {
      return
    }
    startFollowAnim(target)
  } catch (err) {
    console.error('[follow-highlight]', err)
  }
}

function bindFollowScroll() {
  const scroller = pageEl.value?.closest('.app-scroll')
  if (!scroller || scroller === appScrollEl) return
  unbindFollowScroll()
  appScrollEl = scroller
  appScrollEl.addEventListener('scroll', onAppScroll, { passive: true })
  appScrollEl.addEventListener('wheel', onFollowWheel, { passive: true })
}

function unbindFollowScroll() {
  appScrollEl?.removeEventListener('scroll', onAppScroll)
  appScrollEl?.removeEventListener('wheel', onFollowWheel)
  appScrollEl = null
  cancelFollowAnim()
  if (followResumeTimer) {
    clearTimeout(followResumeTimer)
    followResumeTimer = 0
  }
}

function zoomingAllowed() {
  return !overviewActive?.value
}

function scaleBounds(nextFit = fitScale.value) {
  if (!zoomingAllowed()) return { min: nextFit, max: nextFit }
  return {
    min: nextFit * MIN_ZOOM_OUT_RATIO,
    max: nextFit * MAX_ZOOM_RATIO,
  }
}

function setScaleAtPoint(nextScale, anchorX) {
  if (!zoomingAllowed()) return
  const { min: minS, max: maxS } = scaleBounds()
  const s = clamp(nextScale, minS, maxS)
  const contentX = (anchorX - tx.value) / scale.value
  const nextTx = anchorX - contentX * s
  const pan = clampPan(nextTx, 0, s)
  scale.value = s
  tx.value = pan.x
  ty.value = pan.y
  atFitScale.value = Math.abs(s - fitScale.value) < FIT_EPS
}

/** 上次用于适配的容器宽度；忽略由自身高度变化触发的 ResizeObserver */
let lastFitViewportW = 0
let fitRetryTimers = []

function applyFitScale() {
  lastFitViewportW = getViewportWidth()
  syncViewportWidth()
  fitScale.value = computeFitScale()
  scale.value = fitScale.value
  atFitScale.value = true
  const pan = clampPan(0, 0, scale.value)
  tx.value = pan.x
  ty.value = pan.y
}

/** 首次布局宽度未稳（尤其 iOS 12 无 ResizeObserver）时补几次横向适配 */
function scheduleFitScaleRetries() {
  fitRetryTimers.forEach(clearTimeout)
  fitRetryTimers = []
  const run = () => {
    if (atFitScale.value) applyFitScale()
  }
  requestAnimationFrame(run)
  fitRetryTimers.push(setTimeout(run, 80), setTimeout(run, 320))
  if (typeof ResizeObserver === 'undefined') {
    fitRetryTimers.push(setTimeout(run, 800))
  }
}

function updateFitScaleOnResize() {
  if (contentW.value <= 1) return
  const vw = getViewportWidth()
  syncViewportWidth()
  // spacer 高度随 scale 变化会触发 RO；仅宽度变化才重算
  if (Math.abs(vw - lastFitViewportW) < 0.5) return
  lastFitViewportW = vw

  const prevFit = fitScale.value
  const nextFit = computeFitScale()
  fitScale.value = nextFit
  if (atFitScale.value) {
    scale.value = nextFit
    const pan = clampPan(0, 0, scale.value)
    tx.value = pan.x
    ty.value = pan.y
    return
  }
  // 已手动缩放：保持相对 fit 的倍率，并夹紧（总览模式锁在铺满宽度）
  const ratio = prevFit > 0 ? scale.value / prevFit : 1
  const { min, max } = scaleBounds(nextFit)
  const s = clamp(nextFit * ratio, min, max)
  scale.value = s
  const pan = clampPan(tx.value, ty.value, s)
  tx.value = pan.x
  ty.value = pan.y
  atFitScale.value = Math.abs(s - nextFit) < FIT_EPS
}

/* ---------- 指针：捏合 + 横向拖动（纵向交给页面滚动） ---------- */
const activePointers = new Map()
let pinchStartDist = 0
let pinchStartScale = 1
let panStartX = 0
let panOriginTx = 0
let panDownClientX = 0
let panDownClientY = 0
/** null | 'x' | 'y' — 放大后单指先判定轴向，避免与页面滚动抢手势 */
let panAxis = null
let isPanning = false
/** 用于 Mobile 点击乐谱唤醒 FAB */
let tapStartX = 0
let tapStartY = 0
let tapTracking = false
let tapMoved = false

function viewportPoint(e) {
  const rect = viewport.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function pointerDistance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function pointerMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function capturePointer(e) {
  try {
    e.currentTarget?.setPointerCapture?.(e.pointerId)
  } catch (_) {
    /* ignore */
  }
}

function beginPinchFromTouches(touches) {
  isPanning = false
  panAxis = null
  tapTracking = false
  isPinching.value = true
  atFitScale.value = false
  const a = touches[0]
  const b = touches[1]
  pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
  pinchStartScale = scale.value
}

function pinchAnchorXFromTouches(touches) {
  const rect = viewport.value?.getBoundingClientRect()
  const left = rect?.left || 0
  return (touches[0].clientX + touches[1].clientX) / 2 - left
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    // 非 passive 时才能拦住 iOS 的页面缩放（否则只会放大标题文字）
    e.preventDefault()
    if (!zoomingAllowed()) return
    beginPinchFromTouches(e.touches)
  }
}

function onTouchMove(e) {
  if (e.touches.length < 2) return
  e.preventDefault()
  if (!zoomingAllowed() || !isPinching.value) return
  const dist =
    Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    ) || 1
  setScaleAtPoint(
    pinchStartScale * (dist / pinchStartDist),
    pinchAnchorXFromTouches(e.touches),
  )
}

function onTouchEnd(e) {
  if (e.touches.length < 2) {
    pinchStartDist = 0
    isPinching.value = false
  }
}

function onGestureBlock(e) {
  e.preventDefault()
}

function onPointerDown(e) {
  if (!viewport.value) return
  const pt = viewportPoint(e)
  activePointers.set(e.pointerId, pt)

  if (!isDesktop.value && activePointers.size === 1) {
    tapTracking = true
    tapMoved = false
    tapStartX = e.clientX
    tapStartY = e.clientY
  }

  if (activePointers.size === 2) {
    // iOS Safari 无法稳定给出第二根 pointer，触摸捏合走 Touch Events
    // Android Chrome 两种事件都会来，这里跳过以免缩放加倍
    if (e.pointerType === 'touch' || isPinching.value || !zoomingAllowed()) return
    isPanning = false
    panAxis = null
    tapTracking = false
    isPinching.value = true
    atFitScale.value = false
    capturePointer(e)
    const pts = [...activePointers.values()]
    pinchStartDist = pointerDistance(pts[0], pts[1]) || 1
    pinchStartScale = scale.value
    return
  }

  if (isPinching.value) return

  // 放大后单指：先不 capture，等方向锁定再决定横向平移或纵向滚动
  // 鼠标没有「拖拽滚页面」，直接进入横向平移
  if (scale.value > fitScale.value + FIT_EPS) {
    isPanning = true
    panAxis = e.pointerType === 'mouse' ? 'x' : null
    panStartX = pt.x
    panOriginTx = tx.value
    panDownClientX = e.clientX
    panDownClientY = e.clientY
    if (panAxis === 'x') capturePointer(e)
  }
}

function onPointerMove(e) {
  if (!activePointers.has(e.pointerId)) return
  const pt = viewportPoint(e)
  activePointers.set(e.pointerId, pt)

  if (tapTracking) {
    const adx = Math.abs(e.clientX - tapStartX)
    const ady = Math.abs(e.clientY - tapStartY)
    if (adx > TAP_MOVE_PX || ady > TAP_MOVE_PX) tapMoved = true
  }

  // 触摸双指由 Touch Events 负责
  if (e.pointerType === 'touch' && (isPinching.value || activePointers.size >= 2)) {
    return
  }

  if (activePointers.size >= 2) {
    e.preventDefault()
    const pts = [...activePointers.values()]
    const dist = pointerDistance(pts[0], pts[1]) || 1
    const mid = pointerMidpoint(pts[0], pts[1])
    const next = pinchStartScale * (dist / pinchStartDist)
    setScaleAtPoint(next, mid.x)
    return
  }

  if (isPinching.value || !isPanning || activePointers.size !== 1) return

  const dxClient = e.clientX - panDownClientX
  const dyClient = e.clientY - panDownClientY

  if (!panAxis) {
    const adx = Math.abs(dxClient)
    const ady = Math.abs(dyClient)
    if (adx < AXIS_LOCK_PX && ady < AXIS_LOCK_PX) return
    panAxis = adx > ady ? 'x' : 'y'
    if (panAxis === 'x') {
      // 锁定横向后再 capture，避免抢走纵向滚动
      capturePointer(e)
      panStartX = pt.x
      panOriginTx = tx.value
    }
  }

  if (panAxis === 'x') {
    e.preventDefault()
    const dx = pt.x - panStartX
    const pan = clampPan(panOriginTx + dx, 0, scale.value)
    tx.value = pan.x
    ty.value = pan.y
    if (bridge.noteHighlightVisible() || followAnim) armFollowPause()
  }
  // panAxis === 'y'：不 preventDefault、不改 transform，交给 touch-action: pan-y
}

function onPointerUp(e) {
  const wasTap =
    tapTracking &&
    !tapMoved &&
    !isPinching.value &&
    activePointers.size <= 1

  activePointers.delete(e.pointerId)
  try {
    e.currentTarget?.releasePointerCapture?.(e.pointerId)
  } catch (_) {
    /* ignore */
  }

  if (activePointers.size < 2) {
    pinchStartDist = 0
    isPinching.value = false
  }

  if (activePointers.size === 0) {
    isPanning = false
    panAxis = null
    tapTracking = false
    if (wasTap && !isDesktop.value) {
      bridge.onCanvasTap()
    }
  } else if (activePointers.size === 1 && scale.value > fitScale.value + FIT_EPS) {
    const remaining = [...activePointers.values()][0]
    isPanning = true
    panAxis = null
    panStartX = remaining.x
    panOriginTx = tx.value
    // client 起点在只剩一指时无从精确恢复，下一帧用当前点重新锁定
    panDownClientX = e.clientX
    panDownClientY = e.clientY
  }
}

function onWheel(e) {
  // Ctrl/Cmd + 滚轮（含触控板捏合常带 ctrlKey）
  if (!(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  if (!zoomingAllowed()) return
  const pt = viewportPoint(e)
  const factor = Math.exp(-e.deltaY * 0.01)
  setScaleAtPoint(scale.value * factor, pt.x)
}

  function disposeViewport() {
    unbindFollowScroll();
    fitRetryTimers.forEach(clearTimeout);
    fitRetryTimers = [];
  }

  return {
    contentW,
    contentH,
    fitScale,
    scale,
    tx,
    ty,
    atFitScale,
    isPinching,
    viewportW,
    wrapStyle,
    spacerStyle,
    stageStyle,
    getViewportWidth,
    getRenderViewportHeight,
    syncViewportWidth,
    applyFitScale,
    scheduleFitScaleRetries,
    updateFitScaleOnResize,
    bindFollowScroll,
    unbindFollowScroll,
    cancelFollowAnim,
    followHighlight,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onGestureBlock,
    disposeViewport,
  };
}
