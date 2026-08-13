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

      <div
        v-if="isDesktop"
        class="header-actions header-actions--start"
        :style="headerStartActionsStyle"
      >
        <!-- PC 左侧：上传 + 内置示例 -->
        <div v-show="headerHovered" class="toolbar-inline">
          <ScoreToolbarControls
            group="start"
            :hide-labels="true"
            :root-examples="rootExamples"
            :album-groups="albumGroups"
            :selected-example="selectedExample"
            :line-break="lineBreak"
            :paper-size="paperSize"
            :current-xml="currentXml"
            :exporting="exporting"
            @update:selected-example="onSelectedExampleUpdate"
            @update:line-break="onLineBreakUpdate"
            @update:paper-size="onPaperSizeUpdate"
            @example-change="onExampleChange"
            @file-change="onFileChange"
            @export-pdf="onExportPdf"
          />
        </div>
      </div>

      <div class="header-actions header-actions--end" :style="headerActionsStyle">
        <!-- PC 右侧：纸张、换行、导出 -->
        <div
          v-show="isDesktop && headerHovered"
          class="toolbar-inline"
        >
          <ScoreToolbarControls
            group="end"
            :hide-labels="true"
            :root-examples="rootExamples"
            :album-groups="albumGroups"
            :selected-example="selectedExample"
            :line-break="lineBreak"
            :paper-size="paperSize"
            :current-xml="currentXml"
            :exporting="exporting"
            @update:selected-example="onSelectedExampleUpdate"
            @update:line-break="onLineBreakUpdate"
            @update:paper-size="onPaperSizeUpdate"
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
          @click.stop
        >
          <div v-if="sheetOpen" class="toolbar-panel toolbar-panel--sheet">
            <ScoreToolbarControls
              layout="stack"
              :root-examples="rootExamples"
              :album-groups="albumGroups"
              :selected-example="selectedExample"
              :line-break="lineBreak"
              :paper-size="paperSize"
              :current-xml="currentXml"
              :exporting="exporting"
              @update:selected-example="onSelectedExampleUpdate"
              @update:line-break="onLineBreakUpdate"
              @update:paper-size="onPaperSizeUpdate"
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
            :class="{ 'score-meta--overlay': columnCount > 1 }"
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
import { exportPdf } from '../utils/exportPdf.js'
import {
  DEFAULT_PAPER_SIZE,
  PAPER_SIZES,
  SCORE_PAD_X,
  getPageLayout,
} from '../utils/pageLayout.js'

/** 可复用功能区（上传 / 示例 / 纸张 / 换行 / 导出） */
const ScoreToolbarControls = defineComponent({
  name: 'ScoreToolbarControls',
  props: {
    layout: { type: String, default: 'row' },
    /** start=上传+示例；end=纸张+换行+导出；all=全部 */
    group: { type: String, default: 'all' },
    hideLabels: { type: Boolean, default: false },
    rootExamples: { type: Array, required: true },
    albumGroups: { type: Array, required: true },
    selectedExample: { type: String, default: '' },
    lineBreak: { type: String, default: 'auto' },
    paperSize: { type: String, default: DEFAULT_PAPER_SIZE },
    currentXml: { type: String, default: '' },
    exporting: { type: Boolean, default: false },
  },
  emits: [
    'update:selectedExample',
    'update:lineBreak',
    'update:paperSize',
    'example-change',
    'file-change',
    'export-pdf',
  ],
  setup(props, { emit }) {
    const fileAccept =
      '.musicxml,.xml,text/xml,application/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,*/*'

    const menuIcon = (pathD, size = 18) =>
      h(
        'svg',
        {
          class: 'menu-row-icon',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': 'true',
        },
        [h('path', { fill: 'currentColor', d: pathD })]
      )

    const caretIcon = () =>
      h(
        'svg',
        {
          class: 'control-chip-caret',
          viewBox: '0 0 12 12',
          width: 10,
          height: 10,
          'aria-hidden': 'true',
        },
        [
          h('path', {
            d: 'M2.5 4.5 6 8l3.5-3.5',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.5,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        ]
      )

    const resolveExampleName = () => {
      const id = props.selectedExample
      if (!id) return '选择曲谱'
      const root = props.rootExamples.find((item) => item.id === id)
      if (root) return root.name
      for (const album of props.albumGroups) {
        const song = album.songs.find((item) => item.id === id)
        if (song) return song.name
      }
      return '选择曲谱'
    }

    const paperLabel = () =>
      Object.values(PAPER_SIZES).find((paper) => paper.id === props.paperSize)
        ?.label || props.paperSize

    const lineBreakLabel = () => {
      if (props.lineBreak === 'auto') return '自动'
      if (props.lineBreak === 'musicxml') return '原谱换行'
      return `每行${props.lineBreak}小节`
    }

    const overlaySelect = ({
      value,
      onChange,
      ariaLabel,
      options,
      label,
      className,
    }) =>
      h('label', { class: ['control-chip', className] }, [
        h('span', { class: 'control-chip-text' }, label),
        caretIcon(),
        h(
          'select',
          {
            class: 'menu-row-overlay',
            value,
            'aria-label': ariaLabel,
            onChange,
          },
          options
        ),
      ])

    return () => {
      const stacked = props.layout === 'stack'
      const showStart = props.group !== 'end'
      const showEnd = props.group !== 'start'
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

      const exampleSelect = (extraClass) =>
        h('label', { class: extraClass }, [
          h('span', { class: 'menu-row-label' }, resolveExampleName()),
          menuIcon(
            'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
          ),
          h(
            'select',
            {
              class: 'menu-row-overlay',
              value: props.selectedExample,
              'aria-label': '内置示例',
              onChange: (e) => {
                emit('update:selectedExample', e.target.value)
                emit('example-change')
              },
            },
            exampleOptions
          ),
        ])

      const uploadChip = (extraClass) =>
        h('label', { class: extraClass }, [
          h('span', { class: 'menu-row-label' }, '上传曲谱'),
          menuIcon(
            'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V9h5.5'
          ),
          h('input', {
            type: 'file',
            class: 'menu-row-overlay file-input',
            accept: fileAccept,
            'aria-label': '上传曲谱',
            onChange: (e) => emit('file-change', e),
          }),
        ])

      const paperSizeOptions = [
        h('option', { value: '', disabled: true }, '请选择纸张大小'),
        ...Object.values(PAPER_SIZES).map((paper) =>
          h(
            'option',
            { value: paper.id, selected: props.paperSize === paper.id },
            paper.optionLabel
          )
        ),
      ]
      const paperChip = overlaySelect({
        value: props.paperSize,
        onChange: (e) => emit('update:paperSize', e.target.value),
        ariaLabel: '纸张大小',
        options: paperSizeOptions,
        label: paperLabel(),
        className: 'control-chip--paper',
      })

      const lineBreakOptions = [
        h('option', { value: '', disabled: true }, '请选择换行方式'),
        h(
          'option',
          { value: 'auto', selected: props.lineBreak === 'auto' },
          '自动（按纸宽估算每行小节数）'
        ),
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
      const lineBreakChip = overlaySelect({
        value: props.lineBreak,
        onChange: (e) => emit('update:lineBreak', e.target.value),
        ariaLabel: '换行',
        options: lineBreakOptions,
        label: lineBreakLabel(),
        className: 'control-chip--linebreak',
      })

      const exportNode = h(
        'button',
        {
          type: 'button',
          class: 'btn btn--icon',
          disabled: !props.currentXml || props.exporting,
          title: '导出 PDF',
          'aria-label': props.exporting ? '导出中' : '导出 PDF',
          onClick: () => emit('export-pdf'),
        },
        [
          h(
            'svg',
            {
              class: 'export-icon',
              viewBox: '0 0 24 24',
              width: '18',
              height: '18',
              'aria-hidden': 'true',
            },
            [
              h('path', {
                fill: 'currentColor',
                d: 'M5 20h14v-2H5v2zm7-16v10.17l3.59-3.58L17 12l-5 5-5-5 1.41-1.41L11 14.17V4h2z',
              }),
            ]
          ),
        ]
      )

      const actionsSeg = h('div', { class: 'menu-seg menu-seg--actions' }, [
        h('div', { class: 'toolbar-actions-row' }, [
          paperChip,
          lineBreakChip,
          exportNode,
        ]),
      ])
      const exampleSeg = h('div', { class: 'menu-seg menu-seg--dark' }, [
        exampleSelect('menu-row'),
      ])
      const uploadSeg = h('div', { class: 'menu-seg menu-seg--light' }, [
        uploadChip('menu-row'),
      ])

      if (stacked) {
        return h(
          'div',
          { class: 'toolbar-controls toolbar-controls--stack' },
          [
            ...(showStart ? [exampleSeg, uploadSeg] : []),
            ...(showEnd ? [actionsSeg] : []),
          ]
        )
      }

      return h(
        'div',
        { class: 'toolbar-controls toolbar-controls--row' },
        [
          ...(showStart ? [uploadSeg, exampleSeg] : []),
          ...(showEnd ? [actionsSeg] : []),
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
const PAPER_SIZE_KEY = 'xml2jianpu:paperSize'
const PAPER_SIZE_VALUES = Object.keys(PAPER_SIZES)

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

function readStoredPaperSize() {
  try {
    const value = localStorage.getItem(PAPER_SIZE_KEY)
    if (value && PAPER_SIZE_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return DEFAULT_PAPER_SIZE
}

function persistPaperSize(value) {
  if (!PAPER_SIZE_VALUES.includes(value)) return
  try {
    localStorage.setItem(PAPER_SIZE_KEY, value)
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
const paperSize = ref(readStoredPaperSize())

function currentSvgWidth() {
  return getPageLayout(paperSize.value).svgWidth
}

const firstColumnX = ref(0)
const firstColumnW = ref(currentSvgWidth())
const bodyMetaX = ref(0)
const bodyMetaW = ref(currentSvgWidth())
const slotMetaX = ref(0)
const slotMetaW = ref(currentSvgWidth())
const columnCount = ref(1)
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

const metaStyle = computed(() => {
  const width = `${Math.max(1, firstColumnW.value)}px`
  const left = Math.max(0, firstColumnX.value)
  if (columnCount.value > 1) {
    return {
      width,
      position: 'absolute',
      top: '0',
      left: `${left}px`,
      marginLeft: '0',
    }
  }
  return {
    width,
    marginLeft: `${left}px`,
  }
})

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
 * 功能区贴边：空白大时贴视口（FIT_SIDE_PAD），谱面近满宽时贴正文边缘。
 * 左右共用，避免改一侧漏一侧。
 */
function headerSideInset(insetPx) {
  const vw = viewportW.value || getViewportWidth()
  const inset = Math.max(0, Math.round(insetPx))
  return inset > vw * 0.12 ? FIT_SIDE_PAD : inset
}

const headerActionsStyle = computed(() => {
  const vw = viewportW.value || getViewportWidth()
  const scaledW = contentW.value * scale.value
  const rightInset = vw - (tx.value + scaledW)
  return { right: `${headerSideInset(rightInset)}px` }
})

const headerStartActionsStyle = computed(() => ({
  left: `${headerSideInset(tx.value)}px`,
}))

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
/** 已测到的调号区高度；多列时传给排版，避免第 1 列与 HTML 重叠 */
let measuredMetaH = 0

function estimateMetaHeight(meta) {
  if (!meta) return 48
  const padTop = 4
  const padBottom = 8
  const rowH = 22
  const authorCount = meta.authorLines?.length || 0
  const authorH = authorCount
    ? authorCount * 18 + Math.max(0, authorCount - 1) * 4
    : 0
  const moodH = meta.tempo || meta.expression ? 22 : 0
  const leftH = moodH ? rowH + 8 + moodH : rowH
  return padTop + Math.max(leftH, authorH) + padBottom
}

function resolveFirstColumnHeaderH() {
  if (measuredMetaH > 0) return measuredMetaH
  return estimateMetaHeight(scoreMeta.value)
}

function buildRenderOptions() {
  const desktop = isDesktop.value
  return {
    hideTitle: true,
    hideMeta: true,
    autoColumns: desktop,
    viewportWidth: getViewportWidth(),
    viewportHeight: getRenderViewportHeight(),
    maxColumnWidth: currentSvgWidth(),
    contentPadX: SCORE_PAD_X,
    lineBreak: lineBreak.value,
    firstColumnHeaderH: resolveFirstColumnHeaderH(),
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
  // 宽度以排版结果为准（纸张列槽×N 硬画布）；勿用 bbox 撑破
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
  // 多列：调号区叠在 SVG 上，高度已计入第 1 列偏移
  const metaH =
    columnCount.value > 1 ? 0 : metaEl.value?.offsetHeight || 0
  contentW.value = svgWidth || 1
  contentH.value = metaH + (svgHeight || 1)
  applyFitScale()
}

function applyLayoutResult(result) {
  if (!result) return 1
  currentXml.value = result.xmlString
  currentTitle.value = result.title || ''
  scoreMeta.value = result.meta || null
  bodyMetaX.value = result.layout?.bodyMetaX ?? 0
  bodyMetaW.value = result.layout?.bodyMetaW || currentSvgWidth()
  slotMetaX.value = result.layout?.slotMetaX ?? 0
  slotMetaW.value = result.layout?.slotMetaW || currentSvgWidth()
  // 先铺纸张列槽，量完再决定是否改回正文宽
  firstColumnX.value = slotMetaX.value
  firstColumnW.value = slotMetaW.value
  const cols = result.layout?.columns || 1
  columnCount.value = cols
  return cols
}

const META_CLUSTER_GAP = 16

function clusterMinWidth(el) {
  if (!el) return 0
  const prevWrap = el.style.flexWrap
  const prevWidth = el.style.width
  el.style.flexWrap = 'nowrap'
  el.style.width = 'max-content'
  const w = Math.ceil(el.scrollWidth)
  el.style.flexWrap = prevWrap
  el.style.width = prevWidth
  return w
}

function measureMetaNeeded() {
  const root = metaEl.value
  if (!root) return Infinity
  const left = root.querySelector('.score-meta-left')
  const authors = root.querySelector('.score-meta-authors')
  const leftW = clusterMinWidth(left)
  const authorW = clusterMinWidth(authors)
  if (!authorW) return leftW
  return leftW + META_CLUSTER_GAP + authorW
}

async function syncMetaWidth() {
  await nextTick()
  const needed = measureMetaNeeded()
  if (needed <= bodyMetaW.value + 1) {
    firstColumnX.value = bodyMetaX.value
    firstColumnW.value = bodyMetaW.value
  } else {
    firstColumnX.value = slotMetaX.value
    firstColumnW.value = slotMetaW.value
  }
  await nextTick()
  if (columnCount.value <= 1 && svg.value) {
    const metaH = metaEl.value?.offsetHeight || 0
    const svgH = Number(svg.value.getAttribute('height')) || 1
    contentH.value = metaH + svgH
  }
}

async function syncFirstColumnHeader(usedHeaderH, cols) {
  if (cols <= 1) return
  await nextTick()
  const measured = metaEl.value?.offsetHeight || 0
  if (measured < 1) return
  measuredMetaH = measured
  if (Math.abs(measured - usedHeaderH) <= 1) return
  if (renderInFlight) return
  await rerenderCurrent()
}

async function renderWithUrl(url) {
  if (!svg.value) return
  renderInFlight = true
  const usedHeaderH = resolveFirstColumnHeaderH()
  let cols = 1
  try {
    const result = await initApp(svg.value, url, buildRenderOptions())
    cols = applyLayoutResult(result)
    rememberRenderViewport()
    await fitSvgSize(svg.value)
  } finally {
    renderInFlight = false
  }
  await syncMetaWidth()
  await syncFirstColumnHeader(usedHeaderH, cols)
}

async function renderWithXmlString(xmlString) {
  if (!svg.value) return
  renderInFlight = true
  const usedHeaderH = resolveFirstColumnHeaderH()
  let cols = 1
  try {
    const result = await initApp(svg.value, xmlString, buildRenderOptions())
    cols = applyLayoutResult(result)
    rememberRenderViewport()
    await fitSvgSize(svg.value)
  } finally {
    renderInFlight = false
  }
  await syncMetaWidth()
  await syncFirstColumnHeader(usedHeaderH, cols)
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
  if (!LINE_BREAK_VALUES.includes(value)) return
  lineBreak.value = value
  persistLineBreak(value)
  rerenderCurrent()
  if (!isDesktop.value) closeSheet()
}

function onPaperSizeUpdate(value) {
  if (!PAPER_SIZE_VALUES.includes(value)) return
  paperSize.value = value
  persistPaperSize(value)
  rerenderCurrent()
  if (!isDesktop.value) closeSheet()
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
    await exportPdf(currentXml.value, {
      title: currentTitle.value,
      lineBreak: lineBreak.value,
      paperSize: paperSize.value,
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

function hideFab() {
  fabVisible.value = false
  clearFabTimer()
}

/** 画布 pointerup 已处理时，忽略随后冒泡的 click，避免显隐互相抵消 */
let skipPageClick = false
let skipPageClickTimer = null

function clearSkipPageClick() {
  skipPageClick = false
  if (skipPageClickTimer) {
    clearTimeout(skipPageClickTimer)
    skipPageClickTimer = null
  }
}

/** Mobile：点空白唤出/收起；点菜单图标与浮窗本身不收起 */
function onMobileOutsideTap() {
  if (isDesktop.value) return
  if (sheetOpen.value) {
    closeSheet()
    return
  }
  if (fabVisible.value) {
    hideFab()
    return
  }
  showFabTemporarily()
}

function onPageClick() {
  if (skipPageClick) {
    skipPageClick = false
    return
  }
  onMobileOutsideTap()
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
    if (wasTap && !isDesktop.value) {
      // 部分移动浏览器点画布不发 click；pointerup 先处理，并吞掉随后的 click
      skipPageClick = true
      onMobileOutsideTap()
      if (skipPageClickTimer) clearTimeout(skipPageClickTimer)
      skipPageClickTimer = setTimeout(() => {
        skipPageClick = false
        skipPageClickTimer = null
      }, 400)
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
  clearSkipPageClick()
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
  color: var(--color-text-primary);
}

.score-header {
  position: relative;
  z-index: 2;
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
  font-size: var(--font-size-title);
  font-weight: 400;
  line-height: 1.35;
  color: var(--color-text-secondary);
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
  flex: 0 0 auto;
  min-height: 32px;
  z-index: 2;
}

.header-actions--start {
  justify-content: flex-start;
}

.header-actions--end {
  justify-content: flex-end;
  /* right 由 headerActionsStyle 控制（窄谱贴视口右，宽谱贴正文右缘） */
}

/* PC：无外框，紧凑一字排开 */
.toolbar-inline {
  display: flex;
  align-items: center;
}

.toolbar-panel--sheet {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: min(var(--menu-width), calc(100vw - 32px));
  z-index: 60;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

:deep(.toolbar-controls) {
  display: flex;
  align-items: center;
}

:deep(.toolbar-controls--row) {
  flex-wrap: nowrap;
  gap: var(--menu-gap);
}

:deep(.toolbar-controls--row .menu-seg--dark),
:deep(.toolbar-controls--row .menu-seg--light),
:deep(.toolbar-controls--row .menu-seg--actions) {
  flex: 0 0 auto;
}

:deep(.toolbar-controls--row .menu-seg--actions) {
  min-width: var(--menu-width);
}

:deep(.toolbar-controls--stack) {
  flex-direction: column;
  align-items: stretch;
  gap: var(--menu-gap);
}

:deep(.menu-seg) {
  border-radius: var(--menu-radius);
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

:deep(.menu-seg--dark) {
  background: var(--color-menu-dark-bg);
  color: var(--color-menu-dark-text);
}

:deep(.menu-seg--light),
:deep(.menu-seg--actions) {
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
}

:deep(.menu-row),
:deep(.control-chip) {
  position: relative;
  display: flex;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-menu);
  color: inherit;
  cursor: pointer;
}

:deep(.menu-row) {
  justify-content: space-between;
  gap: 12px;
  min-height: var(--menu-row-height);
  padding: 0 14px;
}

:deep(.control-chip) {
  justify-content: center;
  gap: 4px;
  min-height: var(--menu-row-height);
  padding: 0 12px;
}

:deep(.menu-row-label),
:deep(.control-chip-text) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

:deep(.toolbar-controls--row .menu-seg--dark .menu-row-label),
:deep(.toolbar-controls--row .menu-seg--dark .control-chip-text) {
  max-width: 12em;
}

:deep(.menu-row-icon),
:deep(.control-chip-caret) {
  flex-shrink: 0;
  display: block;
}

:deep(.control-chip-caret) {
  display: block;
  transform: translateY(0.5px);
}

:deep(.menu-row-overlay) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 16px; /* 避免部分 WebKit 缩放异常 */
  -webkit-appearance: none;
  appearance: none;
  border: none;
  background: transparent;
  z-index: 2;
}

:deep(.file-input) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 16px;
}

:deep(.toolbar-actions-row) {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: var(--menu-row-height);
  gap: 0;
}

:deep(.toolbar-actions-row > *) {
  position: relative;
  min-width: 0;
}

:deep(.toolbar-actions-row .control-chip--paper),
:deep(.toolbar-actions-row .control-chip--linebreak),
:deep(.toolbar-actions-row .btn) {
  min-width: 0;
  width: auto;
}

:deep(.toolbar-actions-row .control-chip--paper) {
  flex: 3 1 0;
  padding: 0 6px;
}

:deep(.toolbar-actions-row .control-chip--linebreak) {
  flex: 4 1 0;
  padding: 0 6px;
}

:deep(.toolbar-actions-row > * + *)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--color-menu-divider);
  pointer-events: none;
  z-index: 1;
}

:deep(.toolbar-actions-row .btn) {
  box-sizing: border-box;
  flex: 3 1 0;
  height: var(--menu-row-height);
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

:deep(.toolbar-actions-row .btn:hover:not(:disabled)),
:deep(.control-chip:hover) {
  background: var(--color-menu-divider);
}

:deep(.toolbar-actions-row .btn:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

:deep(.export-icon) {
  display: block;
}

.canvas-wrap {
  width: 100%;
  /* 不可用 overflow-x:hidden：另一轴 visible 会算成 auto，和 #app 叠出双滚动条 */
  overflow: visible;
  flex: 1 0 auto;
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
  fill: var(--color-text-primary);
  color: var(--color-text-primary);
}

.score-meta {
  box-sizing: border-box;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 4px 0 16px;
  color: var(--color-text-primary);
  pointer-events: none;
  user-select: none;
}

.score-meta--overlay {
  padding-bottom: 8px;
  z-index: 1;
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
  font-size: var(--font-size-score-key);
  line-height: 1;
  white-space: nowrap;
}

.score-accidental {
  font-size: var(--font-size-score-accidental);
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
  font-size: var(--font-size-score-time);
  font-weight: 600;
}

.score-time-bar {
  display: block;
  width: 18px;
  height: 1.2px;
  margin: 2px 0;
  background: var(--color-text-primary);
}

.score-meta-mood {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: var(--font-size-score-mood);
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
  font-size: var(--font-size-meta);
  line-height: 1.3;
  text-align: right;
  flex-shrink: 0;
}

.score-author-line {
  white-space: nowrap;
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
  border: none;
  border-radius: 12px;
  background: var(--color-menu-light-bg);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-primary);
}

.menu-icon {
  display: block;
}
</style>
