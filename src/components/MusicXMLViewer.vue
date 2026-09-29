<template>
  <div class="page-wrap" ref="pageEl" :style="pageWrapStyle" @click="onPageClick">
    <header
      class="score-header"
      ref="headerEl"
      @mouseenter="onHeaderEnter"
      @mouseleave="onHeaderLeave"
    >
      <div
        class="score-title"
        role="heading"
        aria-level="1"
      >
        {{ currentTitle }}
      </div>

      <div
        v-if="isDesktop"
        class="header-actions header-actions--start"
        :style="headerStartActionsStyle"
      >
        <div
          v-show="headerHovered || transposeOpen"
          class="transpose-anchor"
          @click.stop
        >
          <button
            type="button"
            class="menu-btn"
            :class="{ 'menu-btn--active': transposeDirty }"
            :aria-expanded="transposeOpen"
            aria-label="固定调移调"
            @click="toggleTranspose"
          >
            <TransposeIcon />
          </button>
          <div
            v-if="transposeOpen"
            class="toolbar-panel toolbar-panel--sheet toolbar-panel--sheet-start toolbar-panel--transpose"
          >
            <TransposePanel
              :original-key-name="originalKeyName"
              :transpose-semitones="fixedDo ? transposeSemitones : 0"
              :fixed-do="transposePanelFixedDo"
              :audio-ready="audioReady"
              :audio-playing="audioPlaying"
              :audio-progress="audioProgress"
              :audio-loading="audioLoading"
              :audio-instrument="audioInstrument"
              :audio-instrument-loading="audioInstrumentLoading"
              :audio-events="audioEvents"
              :audio-duration="audioDuration"
              @set="setTranspose"
              @reset="resetTranspose"
              @audio-toggle="onAudioToggle"
              @audio-stop="onAudioStop"
              @audio-seek="onAudioSeek"
              @audio-instrument="onAudioInstrument"
            />
          </div>
        </div>
        <!-- PC 左侧：记谱切换 + 上传 + 内置示例 -->
        <div v-show="headerHovered || headerMenuOpen" class="toolbar-inline">
          <NotationSwitch
            :model-value="notationMode"
            @update:model-value="onNotationModeUpdate"
          />
          <ScoreToolbarControls
            group="start"
            :root-examples="rootExamples"
            :album-groups="albumGroups"
            :selected-example="selectedExample"
            :line-break="lineBreak"
            :paper-size="paperSize"
            :score-font-size="scoreFontSize"
            :theme="theme"
            :current-xml="currentXml"
            :exporting="exporting"
            :score-files="scoreFiles"
            :before-score-menu="beforeScoreMenu"
            @update:selected-example="onSelectedExampleUpdate"
            @update:line-break="onLineBreakUpdate"
            @update:paper-size="onPaperSizeUpdate"
            @update:theme="onThemeUpdate"
            @font-size-step="onFontSizeStep"
            @example-change="onExampleChange"
            @file-change="onFileChange"
            @native-file-open="onNativeFileOpen"
            @export-pdf="onExportPdf"
            @select-menu-open="onSelectMenuOpen"
            @select-menu-close="onSelectMenuClose"
          />
        </div>
      </div>

      <div
        v-if="isDesktop"
        class="header-actions header-actions--end"
        :style="headerActionsStyle"
      >
        <!-- PC 右侧：字号/主题 + 纸张、换行、导出 -->
        <div v-show="headerHovered || headerMenuOpen" class="toolbar-inline">
          <ScoreToolbarControls
            group="end"
            :root-examples="rootExamples"
            :album-groups="albumGroups"
            :selected-example="selectedExample"
            :line-break="lineBreak"
            :paper-size="paperSize"
            :score-font-size="scoreFontSize"
            :theme="theme"
            :current-xml="currentXml"
            :exporting="exporting"
            :score-files="scoreFiles"
            :before-score-menu="beforeScoreMenu"
            @update:selected-example="onSelectedExampleUpdate"
            @update:line-break="onLineBreakUpdate"
            @update:paper-size="onPaperSizeUpdate"
            @update:theme="onThemeUpdate"
            @font-size-step="onFontSizeStep"
            @example-change="onExampleChange"
            @file-change="onFileChange"
            @native-file-open="onNativeFileOpen"
            @export-pdf="onExportPdf"
            @select-menu-open="onSelectMenuOpen"
            @select-menu-close="onSelectMenuClose"
          />
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
          <ScoreMeta
            v-if="scoreMeta && notationMode === 'jianpu'"
            ref="metaEl"
            :score-meta="scoreMeta"
            :column-count="columnCount"
            :meta-stack-mood="metaStackMood"
            :meta-stack-authors="metaStackAuthors"
            :meta-wrap-authors="metaWrapAuthors"
            :meta-style="metaStyle"
          />
          <svg
            v-show="notationMode === 'jianpu'"
            ref="svg"
            class="score-svg"
          ></svg>
          <div
            v-show="notationMode === 'staff'"
            ref="osmdHost"
            class="osmd-host"
          />
        </div>
      </div>
      <div v-if="libraryEmpty" class="score-empty">
        <p>还没有曲谱</p>
        <button type="button" @click="onNativeFileOpen">上传曲谱</button>
      </div>
    </div>
  </div>

  <MobileScoreMenu
    v-if="!isDesktop"
    :fab-visible="fabVisible"
    :sheet-open="sheetOpen"
    :transpose-open="transposeOpen"
    :transpose-dirty="transposeDirty"
    :original-key-name="originalKeyName"
    :transpose-semitones="transposeSemitones"
    :fixed-do="fixedDo"
    :transpose-panel-fixed-do="transposePanelFixedDo"
    :audio-ready="audioReady"
    :audio-playing="audioPlaying"
    :audio-progress="audioProgress"
    :audio-loading="audioLoading"
    :audio-instrument="audioInstrument"
    :audio-instrument-loading="audioInstrumentLoading"
    :audio-events="audioEvents"
    :audio-duration="audioDuration"
    :root-examples="rootExamples"
    :album-groups="albumGroups"
    :selected-example="selectedExample"
    :line-break="lineBreak"
    :paper-size="paperSize"
    :score-font-size="scoreFontSize"
    :theme="theme"
    :current-xml="currentXml"
    :exporting="exporting"
    :notation-mode="notationMode"
    :score-files="scoreFiles"
    :before-score-menu="beforeScoreMenu"
    @toggle-transpose="toggleTranspose"
    @toggle-sheet="toggleSheet"
    @set-transpose="setTranspose"
    @reset-transpose="resetTranspose"
    @audio-toggle="onAudioToggle"
    @audio-stop="onAudioStop"
    @audio-seek="onAudioSeek"
    @audio-instrument="onAudioInstrument"
    @update:selected-example="onSelectedExampleUpdate"
    @update:line-break="onLineBreakUpdate"
    @update:paper-size="onPaperSizeUpdate"
    @update:theme="onThemeUpdate"
    @font-size-step="onFontSizeStep"
    @example-change="onExampleChange"
    @file-change="onFileChange"
    @native-file-open="onNativeFileOpen"
    @export-pdf="onExportPdf"
    @update:notation-mode="onNotationModeUpdate"
  />

  <ExportPdfDialog
    :open="exportPaperDialogOpen"
    mode="paper"
    :papers="exportPaperOptions"
    :last-paper-id="lastExportPaperSize"
    :exporting="exporting"
    :show-guide="needsManualSaveGuide"
    @cancel="cancelExportPaperDialog"
    @confirm="confirmExportPaper"
  />
  <ExportPdfDialog
    :open="legacyPdfGuideOpen"
    mode="legacy"
    :exporting="exporting"
    show-guide
    @cancel="cancelLegacyPdfGuide"
    @confirm="confirmLegacyPdfGuide"
  />
  <UploadDestDialog
    :open="uploadDestOpen"
    :dirs="scoreDirs"
    :files="scoreFiles"
    :selected="uploadDir"
    :busy="uploadBusy"
    @cancel="cancelUploadDest"
    @confirm="confirmUploadDest"
    @select="selectUploadDir"
    @create="createUploadDir"
    @remove="removeUploadDir"
  />

  <Teleport to="body">
    <AboutEntry
      v-if="!aboutOpen || aboutPopover"
      :visible="aboutEntryVisible"
      :dot="showUpdateDot"
      :raised="aboutOpen && aboutPopover"
      @open="onAboutEntryOpen"
      @hover="aboutHover = $event"
    />
  </Teleport>
  <Teleport to="body">
    <AboutPage v-if="aboutOpen" :popover="aboutPopover" @close="closeAbout" />
  </Teleport>
</template>

<script setup>
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
} from 'vue'
import { clearPageZoomBlock } from '../utils/pageZoomBlock.js'
import NotationSwitch from './viewer/NotationSwitch.vue'
import ScoreToolbarControls from './viewer/ScoreToolbarControls.vue'
import TransposePanel, { TransposeIcon } from './viewer/TransposePanel.vue'
import ScoreMeta from './viewer/ScoreMeta.vue'
import ExportPdfDialog from './viewer/ExportPdfDialog.vue'
import UploadDestDialog from './viewer/UploadDestDialog.vue'
import MobileScoreMenu from './viewer/MobileScoreMenu.vue'
import {
  NOTATION_JIANPU,
  NOTATION_STAFF,
  destroyStaffPreview,
} from '../utils/osmdRenderer.js'
import {
  bindSchemeListenersWhenReady,
  onThemeSchemeApplied,
  readStoredTheme,
} from '../utils/theme.js'
import {
  bindTauriWindowResized,
  unbindTauriWindowListeners,
} from '../utils/tauriWindow.js'
import AboutEntry from './AboutEntry.vue'
import AboutPage from './AboutPage.vue'
import { isTauri } from '../utils/platform.js'
import { checkForUpdate, showUpdateDot } from '../utils/appUpdate.js'
import { examples, rootExamples, albumGroups } from '../utils/scoreCatalog.js'
import {
  readStoredExampleId,
  readStoredLineBreak,
  readStoredNotationMode,
  readStoredPaperSize,
  readStoredScoreFontSize,
} from '../utils/viewerPrefs.js'
import { useCanvasViewport } from '../composables/useCanvasViewport.js'
import { useScoreAudio } from '../composables/useScoreAudio.js'
import { useScoreSession } from '../composables/useScoreSession.js'



const svg = ref(null)
const osmdHost = ref(null)
const pageEl = ref(null)
const viewport = ref(null)
const headerEl = ref(null)
const metaEl = ref(null)

const currentXml = ref('')
const currentTitle = ref('')
const scoreMeta = ref(null)
const paperSize = ref(readStoredPaperSize())
const scoreFontSize = ref(readStoredScoreFontSize())
const theme = ref(readStoredTheme())
/** 适配宽度时左右留白，避免谱面贴边 */
const FIT_SIDE_PAD = 16

const selectedExample = ref(readStoredExampleId())
const lineBreak = ref(readStoredLineBreak())
const notationMode = ref(readStoredNotationMode())


const FAB_HIDE_MS = 6000
/** 标题栏收起后，底部「关于」再停留一会儿，指针才能从顶栏移过去 */
const ABOUT_LINGER_MS = 1000
/** 触控下约等于系统的 regular 宽度：iPad 对半及更宽用气泡，三分之一分屏和手机竖屏仍用底部面板 */
const REGULAR_WIDTH_QUERY = '(min-width: 500px)'
const OUTSIDE_TAP_DEBOUNCE_MS = 400

const isDesktop = ref(false)
const regularWidth = ref(readRegularWidth())
const headerHovered = ref(false)
const fabVisible = ref(false)
const sheetOpen = ref(false)
const fixedDo = ref(false)
const transposeSemitones = ref(0)
const transposeOpen = ref(false)

const bridge = {}
const viewportApi = useCanvasViewport({
  bridge,
  svg,
  osmdHost,
  pageEl,
  viewport,
  headerEl,
  notationMode,
  isDesktop,
  fitSidePad: FIT_SIDE_PAD,
})
Object.assign(bridge, viewportApi)
const audioApi = useScoreAudio({
  bridge,
  svg,
  transposeOpen,
  currentXml,
  fixedDo,
  transposeSemitones,
})
Object.assign(bridge, audioApi)
const sessionApi = useScoreSession({
  bridge,
  contentW: viewportApi.contentW,
  contentH: viewportApi.contentH,
  svg,
  osmdHost,
  metaEl,
  currentXml,
  currentTitle,
  scoreMeta,
  paperSize,
  scoreFontSize,
  theme,
  lineBreak,
  notationMode,
  selectedExample,
  fixedDo,
  transposeSemitones,
  transposeOpen,
  isDesktop,
  examples,
  fitSidePad: FIT_SIDE_PAD,
})
Object.assign(bridge, sessionApi)

const {
  contentW,
  scale,
  tx,
  viewportW,
  wrapStyle,
  spacerStyle,
  stageStyle,
  getViewportWidth,
  syncViewportWidth,
  bindFollowScroll,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onGestureBlock,
  disposeViewport,
} = viewportApi
const {
  audioReady,
  audioPlaying,
  audioProgress,
  audioLoading,
  audioInstrument,
  audioInstrumentLoading,
  audioEvents,
  audioDuration,
  ensureScoreAudioLoaded,
  onAudioToggle,
  onAudioStop,
  onAudioInstrument,
  onAudioSeek,
  disposeAudio,
} = audioApi
const {
  firstColumnX,
  firstColumnW,
  bodyScale,
  metaStackMood,
  metaStackAuthors,
  metaWrapAuthors,
  columnCount,
  exporting,
  exportPaperDialogOpen,
  needsManualSaveGuide,
  legacyPdfGuideOpen,
  lastExportPaperSize,
  exportPaperOptions,
  scoreFiles,
  scoreDirs,
  uploadDestOpen,
  uploadDir,
  uploadBusy,
  bootstrapScores,
  beforeScoreMenu,
  cancelUploadDest,
  selectUploadDir,
  createUploadDir,
  removeUploadDir,
  confirmUploadDest,
  onNotationModeUpdate,
  onSelectedExampleUpdate,
  onLineBreakUpdate,
  onPaperSizeUpdate,
  onFontSizeStep,
  onThemeUpdate,
  onExampleChange,
  onNativeFileOpen,
  onFileChange,
  onExportPdf,
  cancelExportPaperDialog,
  cancelLegacyPdfGuide,
  confirmLegacyPdfGuide,
  confirmExportPaper,
  setTranspose,
  resetTranspose,
  rerenderCurrent,
  scheduleScoreRender,
  onViewportResize,
  disposeSession,
} = sessionApi

const libraryEmpty = computed(() => isTauri() && scoreFiles.value.length === 0)

bridge.onCanvasTap = () => {
  skipPageClick = true
  onMobileOutsideTap()
  if (skipPageClickTimer) clearTimeout(skipPageClickTimer)
  skipPageClickTimer = setTimeout(() => {
    skipPageClick = false
    skipPageClickTimer = null
  }, OUTSIDE_TAP_DEBOUNCE_MS)
}
bridge.closeSheet = () => closeSheet()
bridge.closeTransposePanel = () => closeTransposePanel()
bridge.freezeHeaderInsetsIfToolbarVisible = () => freezeHeaderInsetsIfToolbarVisible()

/** 桌面端原生 select 下拉打开时锁定工具栏，避免 mouseleave 收起 */
const headerMenuOpen = ref(false)
/** 指针是否还在标题栏上（桌面 6s 提示结束时，悬停则不收起） */
let headerPointerInside = false
/** 关掉关于页后，指针落在标题栏上会误触 mouseenter，直到指针离开再承认悬停 */
let ignoreHeaderEnter = false
let fabHideTimer = null
let desktopMql = null
let regularWidthMql = null


const pageWrapStyle = computed(() => ({
  ...wrapStyle.value,
  '--font-size-score-meta': `${scoreFontSize.value * bodyScale.value}px`,
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

const originalKeyName = computed(
  () => scoreMeta.value?.originalKeyName || scoreMeta.value?.keyName || 'C'
)

const transposeDirty = computed(() => {
  if (!fixedDo.value) return false
  if (notationMode.value === NOTATION_STAFF) {
    return transposeSemitones.value !== 0
  }
  return originalKeyName.value !== 'C' || transposeSemitones.value !== 0
})

/** 五线谱半音为 0 时不把面板装成已在 C，避免误点还原清掉简谱固定调 */
const transposePanelFixedDo = computed(() => {
  if (notationMode.value === NOTATION_STAFF) {
    return fixedDo.value && transposeSemitones.value !== 0
  }
  return fixedDo.value
})


/**
 * 功能区贴边：空白大时贴视口（FIT_SIDE_PAD），谱面近满宽时贴正文边缘。
 * 左右共用，避免改一侧漏一侧。
 */
function headerSideInset(insetPx) {
  const vw = viewportW.value || getViewportWidth()
  const inset = Math.max(0, Math.round(insetPx))
  return inset > vw * 0.12 ? FIT_SIDE_PAD : inset
}

function liveHeaderInsets() {
  const vw = viewportW.value || getViewportWidth()
  const scaledW = contentW.value * scale.value
  return {
    left: headerSideInset(tx.value),
    right: headerSideInset(vw - (tx.value + scaledW)),
  }
}

/** 悬停中切换记谱时冻结；工具栏隐藏后丢掉，下次出现再按现规则算 */
const frozenHeaderInset = ref(null)

function isDesktopToolbarVisible() {
  return (
    isDesktop.value &&
    (headerHovered.value || headerMenuOpen.value || transposeOpen.value)
  )
}

function freezeHeaderInsetsIfToolbarVisible() {
  if (frozenHeaderInset.value || !isDesktopToolbarVisible()) return
  frozenHeaderInset.value = liveHeaderInsets()
}

const aboutOpen = ref(false)
const aboutHover = ref(false)
const aboutLinger = ref(false)
let aboutLingerTimer = null

function clearAboutLingerTimer() {
  if (!aboutLingerTimer) return
  clearTimeout(aboutLingerTimer)
  aboutLingerTimer = null
}

function openAbout() {
  aboutHover.value = false
  aboutOpen.value = true
}

function onAboutEntryOpen() {
  if (aboutOpen.value && aboutPopover.value) {
    closeAbout()
    return
  }
  openAbout()
}

function closeAbout() {
  aboutOpen.value = false
  aboutHover.value = false
  aboutLinger.value = false
  clearAboutLingerTimer()
  ignoreHeaderEnter = true
}

const aboutPopover = computed(() => !isDesktop.value && regularWidth.value)

const aboutEntryVisible = computed(() => {
  if (aboutOpen.value) return aboutPopover.value
  if (isDesktop.value) {
    return (
      headerHovered.value ||
      headerMenuOpen.value ||
      aboutHover.value ||
      aboutLinger.value
    )
  }
  return fabVisible.value || sheetOpen.value || transposeOpen.value
})

watch(headerHovered, (visible) => {
  if (!visible) frozenHeaderInset.value = null
  if (!isDesktop.value) return
  if (visible || headerMenuOpen.value) {
    aboutLinger.value = false
    clearAboutLingerTimer()
    return
  }
  aboutLinger.value = true
  clearAboutLingerTimer()
  aboutLingerTimer = setTimeout(() => {
    aboutLinger.value = false
    aboutLingerTimer = null
  }, ABOUT_LINGER_MS)
})

const headerActionsStyle = computed(() => {
  const right = frozenHeaderInset.value
    ? frozenHeaderInset.value.right
    : liveHeaderInsets().right
  return { right: `${right}px` }
})

const headerStartActionsStyle = computed(() => {
  const left = frozenHeaderInset.value
    ? frozenHeaderInset.value.left
    : liveHeaderInsets().left
  return { left: `${left}px` }
})


function onExportPaperDialogKeydown(e) {
  if (e.key !== 'Escape') return
  if (exportPaperDialogOpen.value) {
    e.preventDefault()
    cancelExportPaperDialog()
    return
  }
  if (legacyPdfGuideOpen.value) {
    e.preventDefault()
    cancelLegacyPdfGuide()
    return
  }
  if (uploadDestOpen.value) {
    e.preventDefault()
    cancelUploadDest()
    return
  }
  if (transposeOpen.value) {
    e.preventDefault()
    closeTransposePanel()
  }
}

/* ---------- PC / Mobile chrome ---------- */
function readRegularWidth() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(REGULAR_WIDTH_QUERY).matches
}

function syncDesktopFlag() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    isDesktop.value = true
    return
  }
  isDesktop.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

function syncRegularWidth() {
  regularWidth.value = readRegularWidth()
}

function onHeaderEnter() {
  if (!isDesktop.value || ignoreHeaderEnter) return
  headerPointerInside = true
  headerHovered.value = true
}

function releaseIgnoredHeaderEnter(event) {
  if (!ignoreHeaderEnter) return
  const header = headerEl.value
  if (header && event.target instanceof Node && header.contains(event.target)) return
  ignoreHeaderEnter = false
}

function onHeaderLeave() {
  if (!isDesktop.value) return
  ignoreHeaderEnter = false
  headerPointerInside = false
  // 进入页 6s 提示未结束时，移出标题栏也不收起
  if (fabHideTimer) return
  if (transposeOpen.value || headerMenuOpen.value) return
  headerHovered.value = false
}

function onSelectMenuOpen() {
  headerMenuOpen.value = true
  headerHovered.value = true
}

function onSelectMenuClose() {
  headerMenuOpen.value = false
  if (!headerPointerInside && !fabHideTimer && !transposeOpen.value) {
    headerHovered.value = false
  }
}

function clearFabTimer() {
  if (fabHideTimer) {
    clearTimeout(fabHideTimer)
    fabHideTimer = null
  }
}

/** 进入页先露出功能区 6s；之后移动端点空白、桌面端悬停标题栏才会再出现 */
function showFabTemporarily() {
  clearFabTimer()
  if (isDesktop.value) {
    headerHovered.value = true
    fabHideTimer = setTimeout(() => {
      fabHideTimer = null
      if (!headerPointerInside && !headerMenuOpen.value) headerHovered.value = false
    }, FAB_HIDE_MS)
    return
  }
  fabVisible.value = true
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
let lastOutsideTapAt = 0

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
  const now = performance.now()
  if (now - lastOutsideTapAt < OUTSIDE_TAP_DEBOUNCE_MS) return
  lastOutsideTapAt = now
  if (transposeOpen.value) {
    closeTransposePanel()
    return
  }
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
  if (skipPageClick) return
  if (isDesktop.value) {
    if (transposeOpen.value) closeTransposePanel()
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
  transposeOpen.value = false
  sheetOpen.value = true
  fabVisible.value = true
  clearFabTimer()
}

function closeTransposePanel() {
  if (!transposeOpen.value) return
  transposeOpen.value = false
  if (isDesktop.value) {
    if (!headerPointerInside && !fabHideTimer && !headerMenuOpen.value) {
      headerHovered.value = false
    }
    return
  }
  showFabTemporarily()
}

function toggleTranspose() {
  if (transposeOpen.value) {
    closeTransposePanel()
    return
  }
  sheetOpen.value = false
  transposeOpen.value = true
  if (isDesktop.value) {
    headerHovered.value = true
  } else {
    fabVisible.value = true
    clearFabTimer()
  }
  // 简谱且原谱不是 1=C：进固定调重写唱名。五线谱 0 半音无外观变化，只开面板。
  if (
    notationMode.value === NOTATION_JIANPU &&
    !fixedDo.value &&
    originalKeyName.value !== 'C'
  ) {
    fixedDo.value = true
    transposeSemitones.value = 0
    scheduleScoreRender({ preferPitchUpdate: true })
  }
  void ensureScoreAudioLoaded()
}




function onDesktopMqChange() {
  const prev = isDesktop.value
  syncDesktopFlag()
  if (prev === isDesktop.value) return
  headerHovered.value = false
  headerMenuOpen.value = false
  headerPointerInside = false
  sheetOpen.value = false
  fabVisible.value = false
  clearFabTimer()
  showFabTemporarily()
  if (currentXml.value) rerenderCurrent({ preferPitchUpdate: false })
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
  onThemeSchemeApplied(() => {
    if (!currentXml.value) return
    rerenderCurrent({ preferPitchUpdate: false })
  })
  void bindSchemeListenersWhenReady()
  void bindTauriWindowResized(scheduleViewportResize)
  syncDesktopFlag()
  syncRegularWidth()
  syncViewportWidth()
  if (typeof window !== 'undefined' && window.matchMedia) {
    desktopMql = window.matchMedia('(hover: hover) and (pointer: fine)')
    desktopMql.addEventListener?.('change', onDesktopMqChange)
    desktopMql.addListener?.(onDesktopMqChange)
    regularWidthMql = window.matchMedia(REGULAR_WIDTH_QUERY)
    regularWidthMql.addEventListener?.('change', syncRegularWidth)
    regularWidthMql.addListener?.(syncRegularWidth)
  }

  bootstrapScores()
  showFabTemporarily()
  void checkForUpdate()
  window.addEventListener('keydown', onExportPaperDialogKeydown)
  window.addEventListener('pointermove', releaseIgnoredHeaderEnter)

  bindFollowScroll()

  const el = viewport.value
  if (el) {
    // 非 passive，才能在 Ctrl/触控板捏合时 preventDefault
    el.addEventListener('wheel', onWheel, { passive: false })
  }
  const page = pageEl.value
  if (page) {
    // iOS Safari 必须用 Touch Events 才能收到第二指；passive:false 才能 preventDefault
    page.addEventListener('touchstart', onTouchStart, { passive: false })
    page.addEventListener('touchmove', onTouchMove, { passive: false })
    page.addEventListener('touchend', onTouchEnd)
    page.addEventListener('touchcancel', onTouchEnd)
    page.addEventListener('gesturestart', onGestureBlock, { passive: false })
    page.addEventListener('gesturechange', onGestureBlock, { passive: false })
    page.addEventListener('gestureend', onGestureBlock, { passive: false })
  }
  // 窗口 resize：捕获高度变化（画布 RO 往往只跟内容高度走）
  window.addEventListener('resize', scheduleViewportResize)
  window.addEventListener('orientationchange', scheduleViewportResize)
  window.visualViewport?.addEventListener('resize', scheduleViewportResize)
  if (typeof ResizeObserver !== 'undefined' && el) {
    resizeObserver = new ResizeObserver(() => {
      // 延后到下一帧，避免「ResizeObserver loop completed with undelivered notifications」
      scheduleViewportResize()
    })
    resizeObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  disposeViewport()
  disposeSession()
  disposeAudio()
  clearFabTimer()
  clearAboutLingerTimer()
  clearSkipPageClick()
  if (resizeRafId) cancelAnimationFrame(resizeRafId)
  viewport.value?.removeEventListener('wheel', onWheel)
  pageEl.value?.removeEventListener('touchstart', onTouchStart)
  pageEl.value?.removeEventListener('touchmove', onTouchMove)
  pageEl.value?.removeEventListener('touchend', onTouchEnd)
  pageEl.value?.removeEventListener('touchcancel', onTouchEnd)
  pageEl.value?.removeEventListener('gesturestart', onGestureBlock)
  pageEl.value?.removeEventListener('gesturechange', onGestureBlock)
  pageEl.value?.removeEventListener('gestureend', onGestureBlock)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleViewportResize)
  window.removeEventListener('orientationchange', scheduleViewportResize)
  window.visualViewport?.removeEventListener('resize', scheduleViewportResize)
  window.removeEventListener('keydown', onExportPaperDialogKeydown)
  window.removeEventListener('pointermove', releaseIgnoredHeaderEnter)
  clearPageZoomBlock()
  if (desktopMql) {
    desktopMql.removeEventListener?.('change', onDesktopMqChange)
    desktopMql.removeListener?.(onDesktopMqChange)
  }
  if (regularWidthMql) {
    regularWidthMql.removeEventListener?.('change', syncRegularWidth)
    regularWidthMql.removeListener?.(syncRegularWidth)
  }
  void unbindTauriWindowListeners()
  destroyStaffPreview()
})
</script>

<style scoped>
.page-wrap {
  display: flex;
  flex-direction: column;
  flex: 1 0 auto;
  min-height: 100%;
  box-sizing: border-box;
  padding-top: 12px;
  padding-right: calc(16px + var(--safe-area-right, env(safe-area-inset-right, 0px)));
  padding-bottom: 24px;
  padding-left: calc(16px + var(--safe-area-left, env(safe-area-inset-left, 0px)));
  color: var(--color-text-primary);
  /* 禁止系统捏合（iOS 会只放大标题）；双指缩放由 JS 处理 */
  touch-action: pan-y;
}

.page-wrap > .canvas-wrap {
  margin-top: 8px;
}

.score-header {
  position: relative;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  min-height: 36px;
  flex-shrink: 0;
  padding: 0 52px;
  box-sizing: border-box;
  overflow: visible;
}

.score-title {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--font-size-title);
  font-weight: 400;
  line-height: 36px;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
  text-align: center;
  position: relative;
  flex: 0 1 auto;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 1;
  /* iOS 12 只认 100%，none 会被忽略并放大标题 */
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

.header-actions {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 36px;
  z-index: 2;
}

.header-actions--start {
  justify-content: flex-start;
}

.header-actions--start > * + * {
  margin-left: var(--menu-gap);
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

.toolbar-inline > * + * {
  margin-left: var(--menu-gap);
}

.toolbar-panel--sheet {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: var(--menu-width);
  max-width: calc(100vw - 32px);
  z-index: 60;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

.toolbar-panel--sheet-start {
  right: auto;
  left: 0;
}

.toolbar-panel--transpose {
  width: 380px;
  max-width: calc(100vw - 32px);
}

.transpose-anchor {
  position: relative;
}
.canvas-wrap {
  position: relative;
  width: 100%;
  /* 不可用 overflow-x:hidden：另一轴 visible 会算成 auto，和 #app 叠出双滚动条 */
  overflow: visible;
  flex: 1 0 auto;
}

.score-empty {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  pointer-events: auto;
}

.score-empty p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 15px;
}

.score-empty button {
  height: 36px;
  padding: 0 18px;
  border: none;
  border-radius: 8px;
  background: var(--color-accent);
  color: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  touch-action: manipulation;
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
  align-items: flex-start;
  overflow: visible;
}

.canvas-wrap:active .canvas-stage {
  cursor: grabbing;
}

/* 使用 SVG 自身 width/height 像素，由外层 transform 缩放 */
.score-svg {
  display: block;
  flex-shrink: 0;
  font-family: var(--font-score);
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
  fill: var(--color-text-primary);
  color: var(--color-text-primary);
}

.osmd-host {
  align-self: flex-start;
  flex-shrink: 0;
  overflow: visible;
  pointer-events: none;
  color: var(--color-text-primary);
}

.osmd-host :deep(svg) {
  display: block;
  max-width: none;
  fill: var(--color-text-primary);
  color: var(--color-text-primary);
}

.osmd-host-error {
  padding: 16px;
  color: var(--color-error);
  font-family: var(--font-ui);
  font-size: 14px;
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
  touch-action: manipulation;
}

.menu-btn.menu-btn--active {
  background: var(--color-accent);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(10, 132, 255, 0.35);
}

.menu-icon {
  display: block;
}
</style>
