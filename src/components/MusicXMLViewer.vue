<template>
  <div class="page-wrap" @click="onPageClick">
    <header
      class="score-header"
      ref="headerEl"
      @mouseenter="onHeaderEnter"
      @mouseleave="onHeaderLeave"
    >
      <h1 class="score-title">
        {{ currentTitle }}
      </h1>

      <div class="header-actions" :style="headerActionsStyle">
        <!-- PC：悬停时一字排开，无外框 / 无 label -->
        <div
          v-show="isDesktop && headerHovered"
          class="toolbar-inline"
        >
          <ScoreToolbarControls
            :hide-labels="true"
            :root-examples="rootExamples"
            :album-groups="albumGroups"
            :selected-example="selectedExample"
            :line-break="lineBreak"
            :current-xml="currentXml"
            :exporting="exporting"
            @update:selected-example="onSelectedExampleUpdate"
            @update:line-break="onLineBreakUpdate"
            @example-change="onExampleChange"
            @file-change="onFileChange"
            @export-pdf="onExportPdf"
          />
        </div>

        <!-- Mobile：右上角菜单，与标题垂直居中 -->
        <div
          v-if="!isDesktop"
          class="menu-anchor"
          :class="{ 'menu-anchor--visible': fabVisible || sheetOpen }"
        >
          <div
            v-if="sheetOpen"
            class="fab-backdrop"
            @click="closeSheet"
          />
          <div v-if="sheetOpen" class="toolbar-panel toolbar-panel--sheet">
            <ScoreToolbarControls
              layout="stack"
              :root-examples="rootExamples"
              :album-groups="albumGroups"
              :selected-example="selectedExample"
              :line-break="lineBreak"
              :current-xml="currentXml"
              :exporting="exporting"
              @update:selected-example="onSelectedExampleUpdate"
              @update:line-break="onLineBreakUpdate"
              @example-change="onExampleChange"
              @file-change="onFileChange"
              @export-pdf="onExportPdf"
            />
          </div>
          <button
            type="button"
            class="menu-btn"
            :aria-expanded="sheetOpen"
            aria-label="打开功能菜单"
            @click="toggleSheet"
          >
            <svg
              class="menu-icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M4 7h16v2H4V7zm0 4h16v2H4v-2zm0 4h16v2H4v-2z"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>

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
          <div
            v-if="scoreMeta"
            ref="metaEl"
            class="score-meta"
            :style="metaStyle"
          >
            <div class="score-meta-left">
              <div class="score-meta-keytime">
                <span class="score-key">
                  1=<template v-if="keyAccidental"><span class="score-accidental">{{ keyAccidental }}</span></template>{{ keyLetter }}
                </span>
                <span
                  v-if="scoreMeta.beats"
                  class="score-time"
                  :aria-label="`${scoreMeta.beats}/${scoreMeta.beatType}`"
                >
                  <span class="score-time-num">{{ scoreMeta.beats }}</span>
                  <span class="score-time-bar" />
                  <span class="score-time-num">{{ scoreMeta.beatType }}</span>
                </span>
              </div>
              <div
                v-if="scoreMeta.tempo || scoreMeta.expression"
                class="score-meta-mood"
              >
                <span v-if="scoreMeta.tempo" class="score-tempo">
                  <svg
                    class="score-tempo-note"
                    viewBox="0 0 12 18"
                    width="12"
                    height="18"
                    aria-hidden="true"
                  >
                    <ellipse
                      cx="5"
                      cy="14.5"
                      rx="5"
                      ry="3.6"
                      transform="rotate(-25 5 14.5)"
                      fill="currentColor"
                    />
                    <line
                      x1="9.2"
                      y1="14.5"
                      x2="9.2"
                      y2="0.5"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                  </svg>
                  ={{ scoreMeta.tempo }}
                </span>
                <span v-if="scoreMeta.expression" class="score-expression">{{
                  scoreMeta.expression
                }}</span>
              </div>
            </div>
            <div
              v-if="scoreMeta.authorLines?.length"
              class="score-meta-authors"
            >
              <div
                v-for="(line, i) in scoreMeta.authorLines"
                :key="i"
                class="score-author-line"
              >
                {{ line }}
              </div>
            </div>
          </div>
          <svg ref="svg" class="score-svg"></svg>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  nextTick,
  defineComponent,
  h,
} from 'vue'
import initApp from './MusicXMLViewer.js'
import { exportA4Pdf } from '../utils/exportA4Pdf.js'
import { A4_SVG_WIDTH, SCORE_PAD_X } from '../utils/a4Layout.js'

/** 可复用功能区（上传 / 示例 / 导出） */
const ScoreToolbarControls = defineComponent({
  name: 'ScoreToolbarControls',
  props: {
    layout: { type: String, default: 'row' },
    hideLabels: { type: Boolean, default: false },
    rootExamples: { type: Array, required: true },
    albumGroups: { type: Array, required: true },
    selectedExample: { type: String, default: '' },
    lineBreak: { type: String, default: 'auto' },
    currentXml: { type: String, default: '' },
    exporting: { type: Boolean, default: false },
  },
  emits: [
    'update:selectedExample',
    'update:lineBreak',
    'example-change',
    'file-change',
    'export-pdf',
  ],
  setup(props, { emit }) {
    return () => {
      const stacked = props.layout === 'stack'
      const hideLabels = props.hideLabels
      const exampleOptions = [
        h('option', { value: '', disabled: true }, '请选择曲谱'),
        ...props.rootExamples.map((item) =>
          h('option', { key: item.id, value: item.id }, item.name)
        ),
      ]
      for (const album of props.albumGroups) {
        exampleOptions.push(
          h(
            'option',
            {
              key: `__album__${album.name}`,
              value: `__album__${album.name}`,
              disabled: true,
            },
            `—— ${album.name} ——`
          )
        )
        for (const item of album.songs) {
          exampleOptions.push(
            h('option', { key: item.id, value: item.id }, item.name)
          )
        }
      }

      const uploadChildren = [
        h('span', { class: 'btn file-btn' }, [
          h('input', {
            type: 'file',
            class: 'file-input',
            accept:
              '.musicxml,.xml,text/xml,application/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,*/*',
            onChange: (e) => emit('file-change', e),
          }),
          '选择 MusicXML',
        ]),
      ]
      if (!hideLabels) {
        uploadChildren.unshift(h('span', { class: 'select-label' }, '上传曲谱'))
      }

      const exampleChildren = [
        h(
          'select',
          {
            class: 'select',
            value: props.selectedExample,
            onChange: (e) => {
              emit('update:selectedExample', e.target.value)
              emit('example-change')
            },
          },
          exampleOptions
        ),
      ]
      if (!hideLabels) {
        exampleChildren.unshift(
          h('span', { class: 'select-label' }, '内置示例')
        )
      }

      const lineBreakOptions = [
        h('option', { value: 'auto', selected: props.lineBreak === 'auto' }, '自动'),
        h(
          'option',
          { value: 'musicxml', selected: props.lineBreak === 'musicxml' },
          '原谱换行'
        ),
        ...['2', '3', '4', '5', '6'].map((n) =>
          h(
            'option',
            { value: n, selected: props.lineBreak === n },
            `每行${n}小节`
          )
        ),
      ]
      const lineBreakChildren = [
        h(
          'select',
          {
            class: 'select',
            value: props.lineBreak,
            onChange: (e) => emit('update:lineBreak', e.target.value),
          },
          lineBreakOptions
        ),
      ]
      if (!hideLabels) {
        lineBreakChildren.unshift(h('span', { class: 'select-label' }, '换行'))
      }

      return h(
        'div',
        {
          class: [
            'toolbar-controls',
            stacked ? 'toolbar-controls--stack' : 'toolbar-controls--row',
            hideLabels ? 'toolbar-controls--compact' : null,
          ],
        },
        [
          h('label', { class: 'select-wrap' }, uploadChildren),
          h('label', { class: 'select-wrap' }, exampleChildren),
          h('label', { class: 'select-wrap' }, lineBreakChildren),
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: !props.currentXml || props.exporting,
              onClick: () => emit('export-pdf'),
            },
            props.exporting ? '导出中…' : '导出 PDF'
          ),
        ]
      )
    }
  },
})

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

const SELECTED_EXAMPLE_KEY = 'xml2jianpu:selectedExample'
const LINE_BREAK_KEY = 'xml2jianpu:lineBreak'
const LINE_BREAK_VALUES = ['auto', 'musicxml', '2', '3', '4', '5', '6']

function readStoredExampleId() {
  try {
    const id = localStorage.getItem(SELECTED_EXAMPLE_KEY)
    if (id && examples.some((e) => e.id === id)) return id
  } catch {
    /* private mode / unavailable */
  }
  return defaultExampleId
}

function persistSelectedExample(id) {
  if (!id) return
  try {
    localStorage.setItem(SELECTED_EXAMPLE_KEY, id)
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredLineBreak() {
  try {
    const value = localStorage.getItem(LINE_BREAK_KEY)
    if (value && LINE_BREAK_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return 'auto'
}

function persistLineBreak(value) {
  if (!LINE_BREAK_VALUES.includes(value)) return
  try {
    localStorage.setItem(LINE_BREAK_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

const svg = ref(null)
const viewport = ref(null)
const headerEl = ref(null)
const metaEl = ref(null)
const currentXml = ref('')
const currentTitle = ref('')
const scoreMeta = ref(null)
const firstColumnX = ref(0)
const firstColumnW = ref(A4_SVG_WIDTH)
const exporting = ref(false)
const selectedExample = ref(readStoredExampleId())
const lineBreak = ref(readStoredLineBreak())

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
const FAB_HIDE_MS = 6000
const TAP_MOVE_PX = 10

const isDesktop = ref(false)
const headerHovered = ref(false)
const fabVisible = ref(false)
const sheetOpen = ref(false)
let fabHideTimer = null
let desktopMql = null

/** 捏合中禁用浏览器手势；其余情况保留纵向原生滚动 */
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

const metaStyle = computed(() => ({
  width: `${Math.max(1, firstColumnW.value)}px`,
  marginLeft: `${Math.max(0, firstColumnX.value)}px`,
}))

const keyAccidental = computed(() => {
  const name = scoreMeta.value?.keyName || ''
  if (name.startsWith('b') || name.startsWith('#')) return name[0]
  return ''
})

const keyLetter = computed(() => {
  const name = scoreMeta.value?.keyName || ''
  if (name.startsWith('b') || name.startsWith('#')) return name.slice(1)
  return name
})

/** 视口宽度（响应式，供标题/功能区对齐） */
const viewportW = ref(1)

/**
 * A + 自适应（PC / Mobile 共用）：
 * - 正文始终居中
 * - 功能区：右侧空白大时靠近视口右；谱面接近满宽时贴正文右缘
 * - 两种情况下距屏幕右缘的留白统一为「贴正文右缘」时的侧边距（FIT_SIDE_PAD）
 */
const headerActionsStyle = computed(() => {
  const vw = viewportW.value || getViewportWidth()
  const scaledW = contentW.value * scale.value
  const scoreRight = tx.value + scaledW
  const scoreInset = Math.max(0, Math.round(vw - scoreRight))
  // 空白大：贴视口右，但保留与正文侧边相同的 inset，避免比「贴正文」更贴边
  if (scoreInset > vw * 0.12) {
    return { right: `${FIT_SIDE_PAD}px` }
  }
  return { right: `${scoreInset}px` }
})

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function getViewportWidth() {
  return viewport.value?.clientWidth || window.innerWidth || 1
}

function getRenderViewportHeight() {
  const headerH = headerEl.value?.offsetHeight || 56
  const vh = window.innerHeight || document.documentElement.clientHeight || 800
  return Math.max(120, vh - headerH - 24)
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
/** 上次触发布局重算的视口宽/高（高度用 window 可用高度，避免内容撑高导致死循环） */
let lastRenderViewportW = 0
let lastRenderViewportH = 0
let renderInFlight = false

function buildRenderOptions() {
  const desktop = isDesktop.value
  return {
    hideTitle: true,
    hideMeta: true,
    autoColumns: desktop,
    viewportWidth: getViewportWidth(),
    viewportHeight: getRenderViewportHeight(),
    maxColumnWidth: A4_SVG_WIDTH,
    contentPadX: SCORE_PAD_X,
    lineBreak: lineBreak.value,
    // 移动端强制单列
    ...(desktop ? {} : { columns: 1 }),
  }
}

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
  // 已手动放大：保持相对 fit 的倍率，并夹紧
  const ratio = prevFit > 0 ? scale.value / prevFit : 1
  const s = clamp(nextFit * ratio, nextFit, nextFit * MAX_ZOOM_RATIO)
  scale.value = s
  const pan = clampPan(tx.value, ty.value, s)
  tx.value = pan.x
  ty.value = pan.y
  atFitScale.value = Math.abs(s - nextFit) < FIT_EPS
}

function rememberRenderViewport() {
  lastRenderViewportW = getViewportWidth()
  lastRenderViewportH = getRenderViewportHeight()
  syncViewportWidth()
}

async function fitSvgSize(svgEl, padding = 16) {
  await nextTick()
  const bbox = svgEl.getBBox()
  const attrW = Number(svgEl.getAttribute('width')) || 0
  const attrH = Number(svgEl.getAttribute('height')) || 0
  // 宽度以排版结果为准（A4×N 硬画布）；勿用 bbox 撑破
  const svgWidth =
    attrW > 1
      ? attrW
      : Math.max(1, Math.ceil(Math.max(0, bbox.x) + bbox.width + padding))
  const svgHeight = Math.max(
    attrH,
    Math.ceil(Math.max(0, bbox.y) + bbox.height + padding)
  )
  svgEl.removeAttribute('viewBox')
  svgEl.setAttribute('width', String(svgWidth || 1))
  svgEl.setAttribute('height', String(svgHeight || 1))
  const metaH = metaEl.value?.offsetHeight || 0
  contentW.value = svgWidth || 1
  contentH.value = metaH + (svgHeight || 1)
  applyFitScale()
}

async function renderWithUrl(url) {
  if (!svg.value) return
  renderInFlight = true
  try {
    const result = await initApp(svg.value, url, buildRenderOptions())
    if (result) {
      currentXml.value = result.xmlString
      currentTitle.value = result.title || ''
      scoreMeta.value = result.meta || null
      firstColumnX.value = result.layout?.firstColumnX ?? 0
      firstColumnW.value = result.layout?.firstColumnW || A4_SVG_WIDTH
    }
    rememberRenderViewport()
    await fitSvgSize(svg.value)
  } finally {
    renderInFlight = false
  }
}

async function renderWithXmlString(xmlString) {
  if (!svg.value) return
  renderInFlight = true
  try {
    const result = await initApp(svg.value, xmlString, buildRenderOptions())
    if (result) {
      currentXml.value = result.xmlString
      currentTitle.value = result.title || ''
      scoreMeta.value = result.meta || null
      firstColumnX.value = result.layout?.firstColumnX ?? 0
      firstColumnW.value = result.layout?.firstColumnW || A4_SVG_WIDTH
    }
    rememberRenderViewport()
    await fitSvgSize(svg.value)
  } finally {
    renderInFlight = false
  }
}

async function rerenderCurrent() {
  if (!currentXml.value || !svg.value || renderInFlight) return
  await renderWithXmlString(currentXml.value)
}

function loadSelectedExample() {
  const item = examples.find((e) => e.id === selectedExample.value)
  if (!item) return
  renderWithUrl(item.url)
}

function onSelectedExampleUpdate(value) {
  selectedExample.value = value
  persistSelectedExample(value)
}

function onLineBreakUpdate(value) {
  lineBreak.value = value
  persistLineBreak(value)
  rerenderCurrent()
}

function onExampleChange() {
  if (!selectedExample.value) return
  loadSelectedExample()
  if (!isDesktop.value) closeSheet()
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
    if (!isDesktop.value) closeSheet()
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
    await exportA4Pdf(currentXml.value, {
      title: currentTitle.value,
      lineBreak: lineBreak.value,
    })
  } catch (err) {
    console.error('[export PDF]', err)
    alert(err?.message || '导出 PDF 失败')
  } finally {
    exporting.value = false
  }
}

/* ---------- PC / Mobile chrome ---------- */
function syncDesktopFlag() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    isDesktop.value = true
    return
  }
  isDesktop.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

function onHeaderEnter() {
  if (isDesktop.value) headerHovered.value = true
}

function onHeaderLeave() {
  headerHovered.value = false
}

function clearFabTimer() {
  if (fabHideTimer) {
    clearTimeout(fabHideTimer)
    fabHideTimer = null
  }
}

function showFabTemporarily() {
  if (isDesktop.value) return
  fabVisible.value = true
  clearFabTimer()
  if (sheetOpen.value) return
  fabHideTimer = setTimeout(() => {
    fabVisible.value = false
    fabHideTimer = null
  }, FAB_HIDE_MS)
}

/** Mobile：点击页面任意位置唤出菜单图标 */
function onPageClick() {
  if (isDesktop.value || sheetOpen.value) return
  showFabTemporarily()
}

function closeSheet() {
  sheetOpen.value = false
  showFabTemporarily()
}

function toggleSheet() {
  if (sheetOpen.value) {
    closeSheet()
    return
  }
  sheetOpen.value = true
  fabVisible.value = true
  clearFabTimer()
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
    if (wasTap && !isDesktop.value && !sheetOpen.value) {
      showFabTemporarily()
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
  const pt = viewportPoint(e)
  const factor = Math.exp(-e.deltaY * 0.01)
  setScaleAtPoint(scale.value * factor, pt.x)
}

function onViewportResize() {
  syncViewportWidth()
  const vw = getViewportWidth()
  // 用窗口可用高度，不用画布内容高度，避免重绘撑高后再次触发
  const vh = getRenderViewportHeight()
  const widthChanged = Math.abs(vw - lastRenderViewportW) >= 1
  const heightChanged = Math.abs(vh - lastRenderViewportH) >= 1

  // PC：宽或高变化都可能改变分栏数，需重绘
  if (isDesktop.value && currentXml.value && (widthChanged || heightChanged)) {
    lastRenderViewportW = vw
    lastRenderViewportH = vh
    rerenderCurrent()
    return
  }
  updateFitScaleOnResize()
}

function onDesktopMqChange() {
  const prev = isDesktop.value
  syncDesktopFlag()
  if (prev === isDesktop.value) return
  headerHovered.value = false
  sheetOpen.value = false
  clearFabTimer()
  if (!isDesktop.value) showFabTemporarily()
  if (currentXml.value) rerenderCurrent()
}

let resizeObserver = null
let resizeRafId = 0

function scheduleViewportResize() {
  if (resizeRafId) cancelAnimationFrame(resizeRafId)
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = 0
    onViewportResize()
  })
}

onMounted(() => {
  syncDesktopFlag()
  syncViewportWidth()
  if (typeof window !== 'undefined' && window.matchMedia) {
    desktopMql = window.matchMedia('(hover: hover) and (pointer: fine)')
    desktopMql.addEventListener?.('change', onDesktopMqChange)
    desktopMql.addListener?.(onDesktopMqChange)
  }

  loadSelectedExample()
  if (!isDesktop.value) showFabTemporarily()

  const el = viewport.value
  if (el) {
    // 非 passive，才能在 Ctrl/触控板捏合时 preventDefault
    el.addEventListener('wheel', onWheel, { passive: false })
  }
  // 窗口 resize：捕获高度变化（画布 RO 往往只跟内容高度走）
  window.addEventListener('resize', scheduleViewportResize)
  if (typeof ResizeObserver !== 'undefined' && el) {
    resizeObserver = new ResizeObserver(() => {
      // 延后到下一帧，避免「ResizeObserver loop completed with undelivered notifications」
      scheduleViewportResize()
    })
    resizeObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  clearFabTimer()
  if (resizeRafId) cancelAnimationFrame(resizeRafId)
  viewport.value?.removeEventListener('wheel', onWheel)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleViewportResize)
  if (desktopMql) {
    desktopMql.removeEventListener?.('change', onDesktopMqChange)
    desktopMql.removeListener?.(onDesktopMqChange)
  }
})
</script>

<style scoped>
.page-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100%;
  box-sizing: border-box;
  padding: 12px 16px 24px;
}

.score-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  flex-shrink: 0;
  /* 为右侧菜单留空，避免长标题与按钮重叠 */
  padding: 4px 52px;
  box-sizing: border-box;
}

.score-title {
  margin: 0;
  font-size: clamp(22px, 3.2vw, 32px);
  font-weight: 700;
  line-height: 1.35;
  color: #111;
  letter-spacing: 0.02em;
  text-align: center;
  position: relative;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  pointer-events: none;
  z-index: 1;
}

.header-actions {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
  min-height: 32px;
  z-index: 2;
  /* right 由 headerActionsStyle 控制（窄谱贴视口右，宽谱贴正文右缘） */
}

/* PC：无外框，紧凑一字排开 */
.toolbar-inline {
  display: flex;
  align-items: center;
}

.toolbar-panel {
  box-sizing: border-box;
  padding: 12px 14px;
  border: 1px solid #e2e2e2;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
}

.toolbar-panel--sheet {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: min(300px, calc(100vw - 32px));
  z-index: 60;
}

:deep(.toolbar-controls) {
  display: flex;
  gap: 12px;
  align-items: center;
}

:deep(.toolbar-controls--row) {
  flex-wrap: nowrap;
}

:deep(.toolbar-controls--stack) {
  flex-direction: column;
  align-items: stretch;
}

:deep(.toolbar-controls--compact) {
  gap: 8px;
}

:deep(.btn) {
  box-sizing: border-box;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dcdcdc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition: background-color 0.15s;
  font-size: 12px;
  line-height: 26px;
  white-space: nowrap;
}
:deep(.btn:hover:not(:disabled)) {
  background: #f7f7f7;
}
:deep(.btn:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

:deep(.file-btn) {
  position: relative;
  display: inline-block;
  overflow: hidden;
}

/* 覆盖在按钮上：兼容 iOS Safari（hidden 会导致无法唤起选择器） */
:deep(.file-input) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 16px; /* 避免部分 WebKit 缩放异常 */
}

:deep(.select-wrap) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin: 0;
}

:deep(.toolbar-controls--stack .select-wrap) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

:deep(.select-label) {
  color: #666;
  white-space: nowrap;
  font-size: 13px;
}

/* 与 .btn 分离：Safari 对带自定义按钮样式的原生 select 渲染易错位/截断 */
:deep(.select) {
  box-sizing: border-box;
  min-width: 140px;
  max-width: min(220px, 36vw);
  height: 28px;
  padding: 0 28px 0 10px;
  border: 1px solid #dcdcdc;
  border-radius: 6px;
  color: #222;
  font-size: 12px;
  line-height: 26px;
  background-color: #fff;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23666' d='M1.4.6 6 5.2 10.6.6 12 2 6 8 0 2z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 10px 7px;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  transition: background-color 0.15s;
}

:deep(.toolbar-controls--stack .select) {
  width: 100%;
  max-width: none;
  min-width: 0;
  height: 34px;
  font-size: 13px;
  line-height: 32px;
}

:deep(.toolbar-controls--stack .btn) {
  height: 34px;
  font-size: 13px;
  line-height: 32px;
}

:deep(.select:hover) {
  background-color: #f7f7f7;
}
:deep(.select:focus) {
  outline: none;
  border-color: #bdbdbd;
}

.canvas-wrap {
  width: 100%;
  overflow-x: hidden;
  overflow-y: visible;
  flex: 1 1 auto;
}

.canvas-spacer {
  overflow: visible;
}

.canvas-stage {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
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

.score-meta {
  box-sizing: border-box;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 4px 0 16px;
  color: #111;
  pointer-events: none;
  user-select: none;
}

.score-meta-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  min-width: 0;
}

.score-meta-keytime {
  display: flex;
  align-items: center;
  gap: 18px;
}

.score-key {
  font-size: 16px;
  line-height: 1;
  white-space: nowrap;
}

.score-accidental {
  font-size: 11px;
  vertical-align: 8px;
  margin-right: 1px;
}

.score-time {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  line-height: 1;
}

.score-time-num {
  font-size: 13px;
  font-weight: 600;
}

.score-time-bar {
  display: block;
  width: 18px;
  height: 1.2px;
  margin: 2px 0;
  background: #111;
}

.score-meta-mood {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 15px;
  line-height: 1;
}

.score-tempo {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.score-tempo-note {
  display: block;
  flex-shrink: 0;
}

.score-meta-authors {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  font-size: 14px;
  line-height: 1.3;
  text-align: right;
  flex-shrink: 0;
}

.score-author-line {
  white-space: nowrap;
}

.fab-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: transparent;
}

.menu-anchor {
  position: relative;
  display: flex;
  align-items: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.menu-anchor--visible {
  opacity: 1;
  pointer-events: auto;
}

.menu-btn {
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #333;
}

.menu-icon {
  display: block;
}
</style>
