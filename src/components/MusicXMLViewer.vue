<template>
  <div class="page-wrap">
    <div class="toolbar">
      <label class="select-wrap">
        <span class="select-label">上传曲谱</span>
        <span class="btn file-btn">
          <!-- iOS Safari：勿用 hidden/display:none，否则点按常无法打开文件选择器；
               accept 过严也会把未登记的 .musicxml 滤掉，故放宽并由 JS 校验 -->
          <input
            type="file"
            class="file-input"
            accept=".musicxml,.xml,text/xml,application/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,*/*"
            @change="onFileChange"
          />
          选择 MusicXML
        </span>
      </label>
      <label class="select-wrap">
        <span class="select-label">内置示例</span>
        <select class="select" v-model="selectedExample" @change="onExampleChange">
          <option value="" disabled>请选择曲谱</option>
          <!-- 根目录歌曲可直接选 -->
          <option
            v-for="item in rootExamples"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }}
          </option>
          <!-- 不用 optgroup：iOS Safari 会把专辑名渲染两次；改用不可选分隔项 -->
          <template v-for="album in albumGroups" :key="album.name">
            <option disabled :value="`__album__${album.name}`">
              —— {{ album.name }} ——
            </option>
            <option
              v-for="item in album.songs"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }}
            </option>
          </template>
        </select>
      </label>
      <button
        class="btn"
        :disabled="!currentXml || exporting"
        @click="onExportPdf"
      >
        {{ exporting ? '导出中…' : '导出 PDF' }}
      </button>
    </div>

    <!-- 按屏宽缩放 + 双指捏合；放大后拖动平移 -->
    <div
      class="canvas-wrap"
      ref="viewport"
      :style="wrapStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="canvas-spacer" :style="spacerStyle">
        <div class="canvas-stage" :style="stageStyle">
          <svg ref="svg" class="score-svg"></svg>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import initApp from './MusicXMLViewer.js'
import { exportA4Pdf } from '../utils/exportA4Pdf.js'

/**
 * 递归收集 assets 下全部 .musicxml，支持两种路径：
 * - 歌曲.musicxml
 * - 专辑/歌曲.musicxml
 */
const musicxmlCtx = require.context('../assets', true, /\.musicxml$/)
const examples = musicxmlCtx.keys().map((key) => {
  const relativePath = key.replace(/^\.\//, '')
  const id = relativePath.replace(/\.musicxml$/i, '')
  const parts = id.split('/')
  const name = parts[parts.length - 1]
  const album = parts.length > 1 ? parts.slice(0, -1).join('/') : null
  return { id, name, album, url: musicxmlCtx(key) }
})

const byZh = (a, b) => a.name.localeCompare(b.name, 'zh-CN')

/** 根目录曲谱（无专辑） */
const rootExamples = examples.filter((e) => !e.album).sort(byZh)

/** 按专辑分组；专辑本身不可选，仅作树形分组 */
const albumGroups = (() => {
  const map = new Map()
  for (const item of examples) {
    if (!item.album) continue
    if (!map.has(item.album)) map.set(item.album, [])
    map.get(item.album).push(item)
  }
  return [...map.entries()]
    .map(([name, songs]) => ({ name, songs: songs.sort(byZh) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
})()

const defaultExampleId =
  rootExamples[0]?.id || albumGroups[0]?.songs[0]?.id || ''

const svg = ref(null)
const viewport = ref(null)
const currentXml = ref('')
const currentTitle = ref('')
const exporting = ref(false)
const selectedExample = ref(defaultExampleId)

/** 谱面内容像素尺寸（未缩放） */
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
const FIT_EPS = 0.001
/** 适配宽度时左右留白，避免谱面贴边 */
const FIT_SIDE_PAD = 16
/** 单指方向锁定阈值（px） */
const AXIS_LOCK_PX = 8

/** 捏合中禁用浏览器手势；其余情况保留纵向原生滚动 */
const isPinching = ref(false)
const wrapStyle = computed(() => ({
  touchAction: isPinching.value ? 'none' : 'pan-y',
}))

const spacerStyle = computed(() => ({
  // 宽度始终跟容器，避免放大后撑出横向页面滚动条
  width: '100%',
  height: `${Math.max(1, contentH.value * scale.value)}px`,
  position: 'relative',
}))

const stageStyle = computed(() => ({
  width: `${contentW.value}px`,
  height: `${contentH.value}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
  cursor: scale.value > fitScale.value + FIT_EPS ? 'grab' : 'default',
}))

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function getViewportWidth() {
  return viewport.value?.clientWidth || window.innerWidth || 1
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

function setScaleAtPoint(nextScale, anchorX) {
  const minS = fitScale.value
  const maxS = fitScale.value * MAX_ZOOM_RATIO
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

function applyFitScale() {
  lastFitViewportW = getViewportWidth()
  fitScale.value = computeFitScale()
  scale.value = fitScale.value
  atFitScale.value = true
  const pan = clampPan(0, 0, scale.value)
  tx.value = pan.x
  ty.value = pan.y
}

function updateFitScaleOnResize() {
  if (contentW.value <= 1) return
  const vw = getViewportWidth()
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
  // 已手动放大：保持相对 fit 的倍率，并夹紧
  const ratio = prevFit > 0 ? scale.value / prevFit : 1
  const s = clamp(nextFit * ratio, nextFit, nextFit * MAX_ZOOM_RATIO)
  scale.value = s
  const pan = clampPan(tx.value, ty.value, s)
  tx.value = pan.x
  ty.value = pan.y
  atFitScale.value = Math.abs(s - nextFit) < FIT_EPS
}

async function fitSvgSize(svgEl, padding = 16) {
  await nextTick()
  const bbox = svgEl.getBBox()
  const attrW = Number(svgEl.getAttribute('width')) || 0
  const contentWidth = Math.max(
    attrW,
    Math.ceil(Math.max(0, bbox.x) + bbox.width + padding)
  )
  const contentHeight = Math.max(0, Math.ceil(bbox.y + bbox.height + padding))
  svgEl.removeAttribute('viewBox')
  svgEl.setAttribute('width', String(contentWidth || 1))
  svgEl.setAttribute('height', String(contentHeight || 1))
  contentW.value = contentWidth || 1
  contentH.value = contentHeight || 1
  applyFitScale()
}

async function renderWithUrl(url) {
  if (!svg.value) return
  const result = await initApp(svg.value, url)
  if (result) {
    currentXml.value = result.xmlString
    currentTitle.value = result.title || ''
  }
  await fitSvgSize(svg.value)
}

async function renderWithXmlString(xmlString) {
  if (!svg.value) return
  const result = await initApp(svg.value, xmlString)
  if (result) {
    currentXml.value = result.xmlString
    currentTitle.value = result.title || ''
  }
  await fitSvgSize(svg.value)
}

function loadSelectedExample() {
  const item = examples.find((e) => e.id === selectedExample.value)
  if (!item) return
  renderWithUrl(item.url)
}

function onExampleChange() {
  if (!selectedExample.value) return
  loadSelectedExample()
}

function isMusicXmlFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return true
  const type = (file.type || '').toLowerCase()
  // iOS 常给未知扩展名空 MIME；空类型也放行，交给解析阶段报错
  return (
    !type ||
    type.includes('xml') ||
    type === 'application/octet-stream' ||
    type === 'text/plain'
  )
}

async function readFileAsText(file) {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    if (!isMusicXmlFile(file)) {
      alert('请选择 MusicXML 或 XML 文件')
      return
    }
    const text = await readFileAsText(file)
    // 上传后清空下拉：避免与当前谱面不一致，并允许再次选中同一示例触发加载
    selectedExample.value = ''
    await renderWithXmlString(text)
  } catch (err) {
    console.error('[upload MusicXML]', err)
    alert(err?.message || '读取文件失败')
  } finally {
    e.target.value = ''
  }
}

async function onExportPdf() {
  if (!currentXml.value || exporting.value) return
  exporting.value = true
  try {
    await exportA4Pdf(currentXml.value, { title: currentTitle.value })
  } catch (err) {
    console.error('[export PDF]', err)
    alert(err?.message || '导出 PDF 失败')
  } finally {
    exporting.value = false
  }
}

/* ---------- 指针：捏合 + 横向拖动（纵向交给原生滚动） ---------- */
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

function onPointerDown(e) {
  if (!viewport.value) return
  const pt = viewportPoint(e)
  activePointers.set(e.pointerId, pt)

  if (activePointers.size === 2) {
    isPanning = false
    panAxis = null
    isPinching.value = true
    atFitScale.value = false
    capturePointer(e)
    const pts = [...activePointers.values()]
    pinchStartDist = pointerDistance(pts[0], pts[1]) || 1
    pinchStartScale = scale.value
    return
  }

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

  if (activePointers.size >= 2) {
    e.preventDefault()
    const pts = [...activePointers.values()]
    const dist = pointerDistance(pts[0], pts[1]) || 1
    const mid = pointerMidpoint(pts[0], pts[1])
    const next = pinchStartScale * (dist / pinchStartDist)
    setScaleAtPoint(next, mid.x)
    return
  }

  if (!isPanning || activePointers.size !== 1) return

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
  }
  // panAxis === 'y'：不 preventDefault、不改 transform，交给 touch-action: pan-y
}

function onPointerUp(e) {
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
  const pt = viewportPoint(e)
  const factor = Math.exp(-e.deltaY * 0.01)
  setScaleAtPoint(scale.value * factor, pt.x)
}

let resizeObserver = null

onMounted(() => {
  loadSelectedExample()
  const el = viewport.value
  if (el) {
    // 非 passive，才能在 Ctrl/触控板捏合时 preventDefault
    el.addEventListener('wheel', onWheel, { passive: false })
  }
  if (typeof ResizeObserver !== 'undefined' && el) {
    let rafId = 0
    resizeObserver = new ResizeObserver(() => {
      // 延后到下一帧，避免「ResizeObserver loop completed with undelivered notifications」
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = 0
        updateFitScaleOnResize()
      })
    })
    resizeObserver.observe(el)
  } else {
    window.addEventListener('resize', updateFitScaleOnResize)
  }
})

onBeforeUnmount(() => {
  viewport.value?.removeEventListener('wheel', onWheel)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateFitScaleOnResize)
})
</script>

<style scoped>
.page-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 不强制高度，交给内容决定；让页面整体滚动 */
}

.toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.btn {
  padding: 8px 12px;
  border: 1px solid #dcdcdc;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: .15s;
  font-size: 14px;
}
.btn:hover:not(:disabled) { background: #f7f7f7; }
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.file-btn {
  position: relative;
  display: inline-block;
  overflow: hidden;
}

/* 覆盖在按钮上：兼容 iOS Safari（hidden 会导致无法唤起选择器） */
.file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 16px; /* 避免部分 WebKit 缩放异常 */
}

.select-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.select-label {
  color: #555;
  white-space: nowrap;
}

/* 与 .btn 分离：Safari 对带自定义按钮样式的原生 select 渲染易错位/截断 */
.select {
  box-sizing: border-box;
  min-width: 220px;
  max-width: min(360px, 70vw);
  height: 36px;
  padding: 0 32px 0 12px;
  border: 1px solid #dcdcdc;
  border-radius: 8px;
  color: #222;
  font-size: 14px;
  line-height: 34px;
  background-color: #fff;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23666' d='M1.4.6 6 5.2 10.6.6 12 2 6 8 0 2z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px 8px;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}
.select:hover {
  background-color: #f7f7f7;
}
.select:focus {
  outline: 2px solid #c8c8c8;
  outline-offset: 1px;
}

.canvas-wrap {
  width: 100%;
  overflow-x: hidden;
  overflow-y: visible;
}

.canvas-spacer {
  overflow: visible;
}

.canvas-stage {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

.canvas-wrap:active .canvas-stage {
  cursor: grabbing;
}

/* 使用 SVG 自身 width/height 像素，由外层 transform 缩放 */
.score-svg {
  display: block;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}
</style>
