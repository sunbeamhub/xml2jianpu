<template>
  <div class="page-wrap" ref="pageEl" :style="pageWrapStyle" @click="onPageClick">
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
        <div class="canvas-stage" ref="stageEl" :style="stageStyle">
          <ScoreMeta
            v-if="scoreMeta && notationMode === 'jianpu'"
            ref="metaEl"
            :score-meta="scoreMeta"
            :playback-bpm="playbackBpm"
            :score-bpm="scoreBpm"
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
    <ScoreOverview
      v-if="overviewActive"
      :stage-el="stageEl"
      :page-el="pageEl"
      :content-w="contentW"
      :content-h="contentH"
      :epoch="overviewEpoch"
    />
  </div>

  <ScoreDock
    :visible="dockVisible"
    :transpose-dirty="transposeDirty"
    :tempo-dirty="tempoDirty"
    :transpose-open="transposeOpen"
    :score-open="sheetOpen"
    :about-open="aboutOpen"
    :update-dot="showUpdateDot"
    @hover="onDockHover"
    @toggle-transpose="toggleTranspose"
    @toggle-score="toggleSheet"
    @open-about="openAbout"
  />
  <PerformOverlay
    v-if="transposeOpen"
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
    :instrument-options="audioInstrumentOptions"
    :midi-supported="midiSupported"
    :midi-phase="midiPhase"
    :midi-status-text="midiStatusText"
    :midi-has-device="midiHasDevice"
    :midi-follow="midiFollow"
    :playback-bpm="playbackBpm"
    :score-bpm="scoreBpm"
    :follow-rhythm="followRhythm"
    :follow-rhythm-tolerance="followRhythmTolerance"
    :follow-onset="followOnset"
    :follow-onset-tolerance="followOnsetTolerance"
    :follow-countdown="followCountdown"
    :follow-hud-style="followHudStyle"
    :measure-count="measureCount"
    :follow-start-measure="followStartMeasure"
    :follow-end-measure="followEndMeasure"
    @close="closeTransposePanel"
    @set-transpose="setTranspose"
    @reset-transpose="resetTranspose"
    @engage-transpose="engageTranspose"
    @audio-toggle="onAudioToggle"
    @audio-stop="onAudioStop"
    @audio-seek="onAudioSeek"
    @audio-instrument="onAudioInstrument"
    @midi-connect="onMidiConnect"
    @midi-disconnect="onMidiDisconnect"
    @midi-follow="onMidiFollow"
    @playback-bpm="onPlaybackBpm"
    @follow-rhythm="onFollowRhythm"
    @follow-rhythm-tolerance="onFollowRhythmTolerance"
    @follow-onset="onFollowOnset"
    @follow-onset-tolerance="onFollowOnsetTolerance"
    @follow-hud-style="onFollowHudStyle"
    @follow-range="onFollowRange"
  />
  <ScoreMenuOverlay
    v-if="sheetOpen"
    :root-examples="rootExamples"
    :album-groups="albumGroups"
    :selected-example="selectedExample"
    :line-break="lineBreak"
    :paper-size="paperSize"
    :score-font-size="scoreFontSize"
    :theme="theme"
    :skin="skin"
    :current-xml="currentXml"
    :exporting="exporting"
    :notation-mode="notationMode"
    :before-score-menu="beforeScoreMenu"
    :picker-open="scorePickerOpen"
    @close="closeSheet"
    @update:selected-example="onSelectedExampleUpdate"
    @update:line-break="onLineBreakUpdate"
    @update:paper-size="onPaperSizeUpdate"
    @update:theme="onThemeUpdate"
    @update:skin="onSkinUpdate"
    @font-size-step="onFontSizeStep"
    @example-change="onExampleChange"
    @file-change="onFileChange"
    @native-file-open="onNativeFileOpen"
    @export-pdf="onExportPdf"
    @update:notation-mode="onNotationModeUpdate"
    @open-picker="openScorePicker"
  />

  <ExportPdfDialog
    :open="legacyPdfGuideOpen"
    :exporting="exporting"
    @cancel="cancelLegacyPdfGuide"
    @confirm="confirmLegacyPdfGuide"
  />
  <ScorePickerDialog
    v-if="scorePickerOpen"
    :entries="scorePickerEntries"
    :selected="selectedExample"
    :root-label="scorePickerRoot"
    @close="closeScorePicker"
    @select="onScorePick"
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
    <DurationHud
      v-if="midiFollow && (followOnset || followRhythm)"
      :show-onset="followOnset"
      :show-duration="followRhythm"
      :onset-percent="followOnsetPercent"
      :duration-percent="followRhythmPercent"
      :onset-cue="followOnsetCue"
      :duration-cue="followDurationCue"
      :variant="followHudStyle"
    />
  </Teleport>
  <Teleport to="body">
    <div
      v-if="followCountdown > 0"
      class="follow-countdown"
      role="status"
      aria-live="polite"
    >
      {{ followCountdown }}
    </div>
  </Teleport>

  <AboutPage v-if="aboutOpen" @close="closeAbout" />
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
import { clampPlaybackBpm } from '../utils/musicXmlSchedule.js'
import { FOLLOW_RHYTHM_TOLERANCES } from '../utils/viewerPrefs.js'
import ScoreMeta from './viewer/ScoreMeta.vue'
import DurationHud from './viewer/DurationHud.vue'
import ExportPdfDialog from './viewer/ExportPdfDialog.vue'
import UploadDestDialog from './viewer/UploadDestDialog.vue'
import ScorePickerDialog from './viewer/ScorePickerDialog.vue'
import ScoreDock from './viewer/ScoreDock.vue'
import PerformOverlay from './viewer/PerformOverlay.vue'
import ScoreMenuOverlay from './viewer/ScoreMenuOverlay.vue'
import ScoreOverview from './viewer/ScoreOverview.vue'
import { overviewReservePx } from '../utils/scoreOverview.js'
import {
  NOTATION_JIANPU,
  NOTATION_STAFF,
  destroyStaffPreview,
} from '../utils/osmdRenderer.js'
import { readStoredSkin } from '../utils/skin.js'
import {
  bindSchemeListenersWhenReady,
  onThemeSchemeApplied,
  readStoredTheme,
} from '../utils/theme.js'
import {
  bindTauriWindowResized,
  unbindTauriWindowListeners,
} from '../utils/tauriWindow.js'
import AboutPage from './AboutPage.vue'
import { isTauri } from '../utils/platform.js'
import { checkForUpdate, showUpdateDot } from '../utils/appUpdate.js'
import { examples, rootExamples, albumGroups } from '../utils/scoreCatalog.js'
import { SCORE_LIBRARY_DIR, scoreFileLabel } from '../utils/scoreLibrary.js'
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
const metaEl = ref(null)
const stageEl = ref(null)
/** 总览与缩放互斥：true 时右侧显示整谱总览，并锁住捏合缩放 */
const overviewActive = ref(false)

const currentXml = ref('')
const currentTitle = ref('')
const scoreMeta = ref(null)
const paperSize = ref(readStoredPaperSize())
const scoreFontSize = ref(readStoredScoreFontSize())
const theme = ref(readStoredTheme())
const skin = ref(readStoredSkin())
/** 适配宽度时左右留白，避免谱面贴边 */
const FIT_SIDE_PAD = 16

const selectedExample = ref(readStoredExampleId())
const lineBreak = ref(readStoredLineBreak())
const notationMode = ref(readStoredNotationMode())


const FAB_HIDE_MS = 6000
const OUTSIDE_TAP_DEBOUNCE_MS = 400

const isDesktop = ref(false)
const fabVisible = ref(false)
const dockHovered = ref(false)
const aboutOpen = ref(false)
const sheetOpen = ref(false)
const scorePickerOpen = ref(false)
const scorePickerRoot = isTauri() ? SCORE_LIBRARY_DIR : '曲谱'
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
  notationMode,
  isDesktop,
  fitSidePad: FIT_SIDE_PAD,
  overviewActive,
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
  skin,
  lineBreak,
  notationMode,
  selectedExample,
  fixedDo,
  transposeSemitones,
  playbackBpm: audioApi.playbackBpm,
  scoreBpm: audioApi.scoreBpm,
  transposeOpen,
  isDesktop,
  examples,
  fitSidePad: FIT_SIDE_PAD,
  pageEl,
  overviewActive,
})
Object.assign(bridge, sessionApi)

const {
  contentW,
  contentH,
  wrapStyle,
  spacerStyle,
  stageStyle,
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
  audioInstrumentOptions,
  midiSupported,
  midiPhase,
  midiStatusText,
  midiHasDevice,
  midiFollow,
  playbackBpm,
  scoreBpm,
  followRhythm,
  followRhythmTolerance,
  followOnset,
  followOnsetTolerance,
  followHudStyle,
  followDurationCue,
  followOnsetCue,
  followCountdown,
  measureCount,
  followStartMeasure,
  followEndMeasure,
  onPlaybackBpm,
  onFollowRhythm,
  onFollowRhythmTolerance,
  onFollowOnset,
  onFollowOnsetTolerance,
  onFollowHudStyle,
  onFollowRange,
  onMidiConnect,
  onMidiDisconnect,
  onMidiFollow,
  onAudioInstrument,
  onAudioSeek,
  disposeAudio,
} = audioApi
const followRhythmPercent = computed(() => {
  const found = FOLLOW_RHYTHM_TOLERANCES.find(
    (item) => item.value === followRhythmTolerance.value
  )
  return found ? found.percent : 16
})
const followOnsetPercent = computed(() => {
  const found = FOLLOW_RHYTHM_TOLERANCES.find(
    (item) => item.value === followOnsetTolerance.value
  )
  return found ? found.percent : 16
})
const {
  firstColumnX,
  firstColumnW,
  metaTop,
  bodyScale,
  metaStackMood,
  metaStackAuthors,
  metaWrapAuthors,
  columnCount,
  exporting,
  legacyPdfGuideOpen,
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
  onSkinUpdate,
  onExampleChange,
  onNativeFileOpen,
  onFileChange,
  onExportPdf,
  cancelLegacyPdfGuide,
  confirmLegacyPdfGuide,
  setTranspose,
  resetTranspose,
  engageTranspose,
  rerenderCurrent,
  scheduleScoreRender,
  onViewportResize,
  overviewEpoch,
  disposeSession,
} = sessionApi

const libraryEmpty = computed(() => isTauri() && scoreFiles.value.length === 0)

const scorePickerEntries = computed(() => {
  if (isTauri()) {
    return scoreFiles.value.map((id) => ({ id, name: scoreFileLabel(id) }))
  }
  const items = rootExamples.map((item) => ({ id: item.id, name: item.name }))
  for (const album of albumGroups) {
    for (const song of album.songs) items.push({ id: song.id, name: song.name })
  }
  return items
})

watch(sheetOpen, (open) => {
  if (!open) scorePickerOpen.value = false
})

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

let fabHideTimer = null
let desktopMql = null


const pageWrapStyle = computed(() => {
  const style = {
    ...wrapStyle.value,
    '--font-size-score-meta': `${scoreFontSize.value * bodyScale.value}px`,
  }
  if (overviewActive.value) {
    style.paddingRight = `calc(16px + ${overviewReservePx()}px + var(--safe-area-right, env(safe-area-inset-right, 0px)))`
  }
  return style
})

watch(overviewActive, (on) => {
  const root = document.documentElement
  if (on) root.style.setProperty('--score-overview-reserve', `${overviewReservePx()}px`)
  else root.style.removeProperty('--score-overview-reserve')
}, { immediate: true })


const metaStyle = computed(() => {
  const width = `${Math.max(1, firstColumnW.value)}px`
  const left = Math.max(0, firstColumnX.value)
  return {
    width,
    position: 'absolute',
    top: `${Math.max(0, metaTop.value)}px`,
    left: `${left}px`,
    marginLeft: '0',
    zIndex: 1,
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

const tempoDirty = computed(
  () => playbackBpm.value !== clampPlaybackBpm(scoreBpm.value)
)

/** 五线谱半音为 0 时不把面板装成已在 C，避免误点还原清掉简谱固定调 */
const transposePanelFixedDo = computed(() => {
  if (notationMode.value === NOTATION_STAFF) {
    return fixedDo.value && transposeSemitones.value !== 0
  }
  return fixedDo.value
})


const dockVisible = computed(
  () =>
    fabVisible.value ||
    dockHovered.value ||
    sheetOpen.value ||
    transposeOpen.value
)

function openAbout() {
  sheetOpen.value = false
  transposeOpen.value = false
  aboutOpen.value = true
  clearFabTimer()
}

function closeAbout() {
  if (!aboutOpen.value) return
  aboutOpen.value = false
  showFabTemporarily()
}

function onExportPaperDialogKeydown(e) {
  if (e.key !== 'Escape') return
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
  if (scorePickerOpen.value) {
    e.preventDefault()
    closeScorePicker()
    return
  }
  if (transposeOpen.value) {
    e.preventDefault()
    closeTransposePanel()
    return
  }
  if (sheetOpen.value) {
    e.preventDefault()
    closeSheet()
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

function clearFabTimer() {
  if (fabHideTimer) {
    clearTimeout(fabHideTimer)
    fabHideTimer = null
  }
}

/** 进入页先露出 dock 6 秒；之后移动端点空白、桌面端移动指针再出现 */
function showFabTemporarily() {
  clearFabTimer()
  fabVisible.value = true
  if (sheetOpen.value || transposeOpen.value) return
  if (isDesktop.value && dockHovered.value) return
  fabHideTimer = setTimeout(() => {
    fabHideTimer = null
    if (sheetOpen.value || transposeOpen.value) return
    if (isDesktop.value && dockHovered.value) return
    fabVisible.value = false
  }, FAB_HIDE_MS)
}

function hideFab() {
  fabVisible.value = false
  clearFabTimer()
}

function onDockHover(hovering) {
  if (!isDesktop.value) return
  dockHovered.value = hovering
  if (hovering) {
    fabVisible.value = true
    clearFabTimer()
    return
  }
  if (sheetOpen.value || transposeOpen.value || aboutOpen.value) return
  showFabTemporarily()
}

function pointerOnDock(event) {
  const el = event.target
  return el instanceof Element && !!el.closest('.score-dock')
}

function onDesktopPointerMove(event) {
  if (!isDesktop.value || aboutOpen.value) return
  if (event.pointerType === 'touch') return
  if (pointerOnDock(event)) {
    dockHovered.value = true
    fabVisible.value = true
    clearFabTimer()
    return
  }
  if (dockHovered.value) dockHovered.value = false
  if (sheetOpen.value || transposeOpen.value) {
    fabVisible.value = true
    clearFabTimer()
    return
  }
  showFabTemporarily()
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
  if (isDesktop.value) return
  onMobileOutsideTap()
}

function closeSheet() {
  scorePickerOpen.value = false
  if (!sheetOpen.value) return
  sheetOpen.value = false
  showFabTemporarily()
}

function openScorePicker() {
  scorePickerOpen.value = true
}

function closeScorePicker() {
  scorePickerOpen.value = false
}

function onScorePick(id) {
  onSelectedExampleUpdate(id)
  onExampleChange()
}

function toggleSheet() {
  if (sheetOpen.value) {
    closeSheet()
    return
  }
  transposeOpen.value = false
  aboutOpen.value = false
  sheetOpen.value = true
  fabVisible.value = true
  clearFabTimer()
}

function closeTransposePanel() {
  if (!transposeOpen.value) return
  transposeOpen.value = false
  showFabTemporarily()
}

function toggleTranspose() {
  if (transposeOpen.value) {
    closeTransposePanel()
    return
  }
  sheetOpen.value = false
  aboutOpen.value = false
  transposeOpen.value = true
  fabVisible.value = true
  clearFabTimer()
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
  dockHovered.value = false
  sheetOpen.value = false
  transposeOpen.value = false
  aboutOpen.value = false
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
  syncViewportWidth()
  if (typeof window !== 'undefined' && window.matchMedia) {
    desktopMql = window.matchMedia('(hover: hover) and (pointer: fine)')
    desktopMql.addEventListener?.('change', onDesktopMqChange)
    desktopMql.addListener?.(onDesktopMqChange)
  }

  bootstrapScores()
  showFabTemporarily()
  void checkForUpdate()
  window.addEventListener('keydown', onExportPaperDialogKeydown)
  window.addEventListener('pointermove', onDesktopPointerMove)

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
  document.documentElement.style.removeProperty('--score-overview-reserve')
  disposeViewport()
  disposeSession()
  disposeAudio()
  clearFabTimer()
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
  window.removeEventListener('pointermove', onDesktopPointerMove)
  clearPageZoomBlock()
  if (desktopMql) {
    desktopMql.removeEventListener?.('change', onDesktopMqChange)
    desktopMql.removeListener?.(onDesktopMqChange)
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
  padding-bottom: 112px;
  padding-left: calc(16px + var(--safe-area-left, env(safe-area-inset-left, 0px)));
  color: var(--color-text-primary);
  /* 禁止系统捏合；双指缩放由 JS 处理 */
  touch-action: pan-y;
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

.follow-countdown {
  position: fixed;
  z-index: 140;
  left: 50%;
  top: calc(16px + var(--safe-area-top, env(safe-area-inset-top, 0px)));
  transform: translateX(-50%);
  box-sizing: border-box;
  min-width: 64px;
  height: 64px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: var(--color-surface);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-overlay);
  font-size: 32px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
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
</style>
