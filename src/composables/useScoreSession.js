import { ref, nextTick } from "vue";
import initApp, { applyFirstColumnHeaderH } from "../components/MusicXMLViewer.js";
import { exportPdf } from "../utils/exportPdf.js";
import {
  NOTATION_STAFF,
  NOTATION_JIANPU,
  NOTATION_MODES,
  clearElement,
  destroyStaffPreview,
  renderStaffPreview,
  resolveMusicXml,
} from "../utils/osmdRenderer.js";
import { mountJianpuPlayheads } from "../utils/scoreHighlight.js";
import { showToast, hideToast } from "../utils/toast.js";
import { isTauri } from "../utils/platform.js";
import {
  SCORE_LIBRARY_DIR,
  clearScoreRoot,
  defaultLibraryScoreId,
  mkdirScoreDir,
  prepareScoreLibrary,
  removeScoreDir,
  readScoreText,
  scanScoreTree,
  writeScoreInto,
} from "../utils/scoreLibrary.js";
import {
  needsManualSaveGuide as checkNeedsManualSaveGuide,
  needsPdfPopupGuard,
  openPdfPopupGuard,
} from "../utils/savePdf.js";
import { ensureScoreFont } from "../utils/scoreFont.js";
import { clampScoreFontSize } from "../utils/scoreMetrics.js";
import { applyTheme, persistTheme, THEME_VALUES } from "../utils/theme.js";
import {
  SCORE_PAD_X,
  PAPER_SIZES,
  getPageLayout,
  isDevicePaperSize,
  isExportPaperSize,
} from "../utils/pageLayout.js";
import {
  overviewReservePx,
  scoreBodyFitWidth,
  shouldUseScoreOverview,
} from "../utils/scoreOverview.js";
import {
  LINE_BREAK_VALUES,
  PAPER_SIZE_VALUES,
  persistExportPaperSize,
  persistLineBreak,
  persistNotationMode,
  persistPaperSize,
  persistScoreFontSize,
  persistSelectedExample,
  persistUploadDir,
  readStoredExportPaperSize,
  readStoredUploadDir,
} from "../utils/viewerPrefs.js";
import { TRANSPOSE_LIMIT } from "../components/viewer/TransposePanel.vue";

export function useScoreSession(deps) {
  const {
    bridge,
    contentW,
    contentH,
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
    pageEl,
    overviewActive,
  } = deps;

  function metaDom() {
    const node = metaEl.value;
    if (!node) return null;
    return node.$el || node;
  }

  const overviewEpoch = ref(0);
  /** 最近一次排版的正文宽度，窗口只改尺寸时用它重判总览/缩放 */
  let lastBodyFitW = 0;
  /** 模式切换后的那一次重排不再改模式，避免来回翻转 */
  let overviewDecisionLocked = false;
  /** 加锁时的正文宽度；字号等导致宽度变化后允许重新判定 */
  let overviewLockBodyW = 0;

  function readFullContentWidth() {
    const page = pageEl?.value;
    if (!page) return bridge.getViewportWidth();
    const cs = getComputedStyle(page);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    let inner = page.clientWidth - padL - padR;
    if (overviewActive?.value) inner += overviewReservePx();
    return Math.max(1, Math.round(inner));
  }

  /** 排版用的谱面容器宽：总览打开时扣掉右侧栏，不依赖画布是否已经重排 */
  function layoutViewportWidth() {
    const full = readFullContentWidth();
    if (!overviewActive?.value) return full;
    return Math.max(120, Math.round(full - overviewReservePx()));
  }

  function currentSvgWidth() {
    if (isDevicePaperSize(paperSize.value)) {
      const vw = layoutViewportWidth();
      return Math.max(120, Math.round(vw - 2 * FIT_SIDE_PAD));
    }
    return getPageLayout(paperSize.value).svgWidth;
  }

  function wantedOverview(bodyFitW) {
    return shouldUseScoreOverview({
      paperSize: paperSize.value,
      lineBreak: lineBreak.value,
      viewportContentW: readFullContentWidth(),
      bodyFitW,
      sidePad: FIT_SIDE_PAD,
    });
  }

  /**
   * 排版结束后决定总览或缩放。宽度不一致时只再排一次。
   * @returns {boolean} 是否已经排进待重绘队列
   */
  function finishOverview(bodyFitW, _opts, didMeasure) {
    if (
      overviewDecisionLocked &&
      didMeasure &&
      Math.abs(bodyFitW - overviewLockBodyW) > 1
    ) {
      overviewDecisionLocked = false;
    }
    if (didMeasure) lastBodyFitW = bodyFitW;
    if (didMeasure && !overviewDecisionLocked && overviewActive) {
      const want = wantedOverview(bodyFitW);
      if (want !== overviewActive.value) {
        overviewActive.value = want;
        overviewDecisionLocked = true;
        overviewLockBodyW = bodyFitW;
        pendingRenderOpts = mergeRenderOpts(pendingRenderOpts, {
          preferPitchUpdate: false,
          overviewSettle: true,
        });
        return true;
      }
    }
    if (overviewDecisionLocked) overviewDecisionLocked = false;
    if (overviewActive?.value) overviewEpoch.value += 1;
    return false;
  }

  const firstColumnX = ref(0);
  const firstColumnW = ref(currentSvgWidth());
  const bodyMetaX = ref(0);
  const bodyMetaW = ref(currentSvgWidth());
  const slotMetaX = ref(0);
  const slotMetaW = ref(currentSvgWidth());
  const bodyScale = ref(1);
  const metaStackMood = ref(false);
  const metaStackAuthors = ref(false);
  const metaWrapAuthors = ref(false);
  const columnCount = ref(1);
  const exporting = ref(false);
  let exportRunId = 0;
  const exportPaperDialogOpen = ref(false);
  const needsManualSaveGuide = checkNeedsManualSaveGuide();
  const legacyPdfGuideOpen = ref(false);
  const lastExportPaperSize = ref(readStoredExportPaperSize());
  const exportPaperOptions = [PAPER_SIZES.a4, PAPER_SIZES.a3];
  const scoreFiles = ref([]);
  const scoreDirs = ref([""]);
  const uploadDestOpen = ref(false);
  const uploadDir = ref("");
  const uploadBusy = ref(false);
let lastRenderViewportW = 0
let lastRenderViewportH = 0
let renderInFlight = false
/** 进行中的渲染结束后要补画的最新选项；全量重排优先于移调快路径 */
let pendingRenderOpts = null
let renderRafId = 0
/** 已测到的调号区高度；多列时传给排版，避免第 1 列与 HTML 重叠 */
let measuredMetaH = 0

function estimateMetaHeight(meta) {
  if (!meta) return 48
  const fs = scoreFontSize.value * bodyScale.value
  const s = fs / 16
  const padTop = 4 * s
  const padBottom = 8 * s
  const rowH = Math.max(22 * s, fs * 1.2)
  const authorCount = meta.authorLines?.length || 0
  const authorH = authorCount
    ? authorCount * fs * 1.3 + Math.max(0, authorCount - 1) * 4 * s
    : 0
  const moodH = meta.tempo || meta.expression ? rowH : 0
  const leftH = moodH ? rowH + 8 * s + moodH : rowH
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
    viewportWidth: layoutViewportWidth(),
    viewportHeight: bridge.getRenderViewportHeight(),
    maxColumnWidth: currentSvgWidth(),
    contentPadX: SCORE_PAD_X,
    lineBreak: lineBreak.value,
    fontSize: scoreFontSize.value,
    firstColumnHeaderH: resolveFirstColumnHeaderH(),
    readableLineUnits:
      isDevicePaperSize(paperSize.value) && lineBreak.value === 'auto',
    fixedDo: fixedDo.value,
    transposeSemitones: transposeSemitones.value,
    // 移动端强制单列
    ...(desktop ? {} : { columns: 1 }),
  }
}


function rememberRenderViewport() {
  lastRenderViewportW = layoutViewportWidth()
  lastRenderViewportH = bridge.getRenderViewportHeight()
  bridge.syncViewportWidth()
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
    columnCount.value > 1 ? 0 : metaDom()?.offsetHeight || 0
  contentW.value = svgWidth || 1
  contentH.value = metaH + (svgHeight || 1)
  bridge.applyFitScale()
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
  const nextBodyScale = Number(result.layout?.bodyScale)
  bodyScale.value =
    Number.isFinite(nextBodyScale) && nextBodyScale > 0 ? nextBodyScale : 1
  metaStackMood.value = false
  metaStackAuthors.value = false
  metaWrapAuthors.value = false
  // 先铺纸张列槽，量完再决定是否改回正文宽
  firstColumnX.value = slotMetaX.value
  firstColumnW.value = slotMetaW.value
  const cols = result.layout?.columns || 1
  columnCount.value = cols
  return cols
}

function metaClusterGap() {
  return Math.round(scoreFontSize.value * bodyScale.value)
}

function clusterMinWidth(el) {
  if (!el) return 0
  const prevWrap = el.style.flexWrap
  const prevWidth = el.style.width
  const prevWhiteSpace = el.style.whiteSpace
  el.style.flexWrap = 'nowrap'
  el.style.width = 'max-content'
  el.style.whiteSpace = 'nowrap'
  const w = Math.ceil(el.scrollWidth)
  el.style.flexWrap = prevWrap
  el.style.width = prevWidth
  el.style.whiteSpace = prevWhiteSpace
  return w
}

function measureMetaNeeded() {
  const root = metaDom()
  if (!root) return Infinity
  const left = root.querySelector('.score-meta-left')
  const authors = root.querySelector('.score-meta-authors')
  const leftW = clusterMinWidth(left)
  const authorW = clusterMinWidth(authors)
  if (!authorW) return leftW
  if (metaStackAuthors.value) return Math.max(leftW, authorW)
  return leftW + metaClusterGap() + authorW
}

function applyMetaBodyWidth() {
  firstColumnX.value = bodyMetaX.value
  firstColumnW.value = bodyMetaW.value
}

function applyMetaSlotWidth() {
  firstColumnX.value = slotMetaX.value
  firstColumnW.value = slotMetaW.value
}

async function syncMetaWidth() {
  await nextTick()
  metaStackMood.value = false
  metaStackAuthors.value = false
  metaWrapAuthors.value = false
  await nextTick()
  const needed = measureMetaNeeded()
  const bodyW = bodyMetaW.value
  const slotW = slotMetaW.value
  if (needed <= bodyW + 1) {
    applyMetaBodyWidth()
  } else {
    applyMetaSlotWidth()
  }
  if (needed > slotW + 1) {
    applyMetaSlotWidth()
    metaStackMood.value = true
    await nextTick()
    if (measureMetaNeeded() > slotW + 1) {
      metaStackAuthors.value = true
      await nextTick()
      if (measureMetaNeeded() > slotW + 1) {
        metaWrapAuthors.value = true
      }
    }
  }
  await nextTick()
  if (columnCount.value <= 1 && svg.value) {
    const metaH = metaDom()?.offsetHeight || 0
    const svgH = Number(svg.value.getAttribute('height')) || 1
    contentH.value = metaH + svgH
  }
}

async function syncFirstColumnHeader(usedHeaderH, cols) {
  if (cols <= 1) return
  await nextTick()
  const measured = metaDom()?.offsetHeight || 0
  if (measured < 1) return
  measuredMetaH = measured
  if (Math.abs(measured - usedHeaderH) <= 1) return
  if (!svg.value) return
  if (applyFirstColumnHeaderH(svg.value, measured)) {
    await fitSvgSize(svg.value)
  }
}

function buildStaffRenderOptions(overrides = {}) {
  return {
    width: currentSvgWidth(),
    fontSize: scoreFontSize.value,
    lineBreak: lineBreak.value,
    drawTitle: overrides.drawTitle === true,
    drawComposer: true,
    drawLyricist: true,
    pageFormat: overrides.pageFormat || 'Endless',
    transposeSemitones: fixedDo.value ? transposeSemitones.value : 0,
  }
}

async function renderStaffScore(source, opts = {}) {
  const host = osmdHost.value
  if (!host) return
  let staffBodyFitW = 0
  let staffDidMeasure = false
  renderInFlight = true
  try {
    await ensureScoreFont()
    const xmlString = await resolveMusicXml(source)
    host.style.width = `${currentSvgWidth()}px`
    const result = await renderStaffPreview(
      host,
      xmlString,
      buildStaffRenderOptions()
    )
    currentXml.value = result.xmlString
    if (result.title) currentTitle.value = result.title
    columnCount.value = 1
    bodyScale.value = 1
    contentW.value = result.size.width
    contentH.value = result.size.height
    rememberRenderViewport()
    bridge.applyFitScale()
    bridge.syncNoteHighlight()
    staffBodyFitW = scoreBodyFitWidth({
      notation: NOTATION_STAFF,
      staffBodyWidth: result.bodyWidth || result.size.width,
      paperSize: paperSize.value,
    })
    staffDidMeasure = true
  } catch (err) {
    console.error('[OSMD]', err)
    destroyStaffPreview()
    bridge.syncNoteHighlight()
    if (host) {
      clearElement(host)
      const msg = document.createElement('div')
      msg.className = 'osmd-host-error'
      msg.textContent = err?.message || '五线谱渲染失败'
      host.appendChild(msg)
    }
  } finally {
    renderInFlight = false
  }
  bridge.scheduleFitScaleRetries()
  finishOverview(staffBodyFitW, opts, staffDidMeasure)
  if (pendingRenderOpts) {
    const next = pendingRenderOpts
    pendingRenderOpts = null
    scheduleScoreRender(next)
  }
}

async function renderWithUrl(url) {
  await renderScore(url, { preferPitchUpdate: false })
}

async function renderWithXmlString(xmlString, opts = {}) {
  await renderScore(xmlString, opts)
}

function mergeRenderOpts(prev, next) {
  const merged = { ...(prev || {}), ...(next || {}) }
  if (prev && prev.preferPitchUpdate === false) {
    merged.preferPitchUpdate = false
  }
  if (next && next.preferPitchUpdate === false) {
    merged.preferPitchUpdate = false
  }
  return merged
}

function scheduleScoreRender(opts = {}) {
  pendingRenderOpts = mergeRenderOpts(pendingRenderOpts, opts)
  if (renderRafId) return
  renderRafId = requestAnimationFrame(() => {
    renderRafId = 0
    const next = pendingRenderOpts
    pendingRenderOpts = null
    void runQueuedRender(next || {})
  })
}

async function runQueuedRender(opts) {
  if (renderInFlight) {
    pendingRenderOpts = mergeRenderOpts(pendingRenderOpts, opts)
    return
  }
  await rerenderCurrent(opts)
}

async function renderScore(source, opts = {}) {
  if (notationMode.value === NOTATION_STAFF) {
    await nextTick()
    await renderStaffScore(source, opts)
    return
  }
  if (!svg.value) return
  const usedHeaderH = resolveFirstColumnHeaderH()
  let cols = 1
  let skipLayoutSync = false
  let bodyFitW = 0
  let didMeasure = false
  let aborted = false
  renderInFlight = true
  try {
    if (!opts.preferPitchUpdate) {
      await ensureScoreFont()
    }
    const result = await initApp(svg.value, source, {
      ...buildRenderOptions(),
      preferPitchUpdate: !!opts.preferPitchUpdate,
    })
    if (!result) {
      aborted = true
    } else if (result.pitchUpdated) {
      if (result.meta) scoreMeta.value = result.meta
      skipLayoutSync = true
    } else {
      cols = applyLayoutResult(result)
      rememberRenderViewport()
      await fitSvgSize(svg.value)
      bodyFitW = scoreBodyFitWidth({
        notation: NOTATION_JIANPU,
        naturalColumnW: result.layout?.naturalColumnW,
        paperSize: paperSize.value,
      })
      didMeasure = bodyFitW > 0
    }
  } finally {
    renderInFlight = false
  }
  if (aborted) {
    if (opts.overviewSettle) overviewDecisionLocked = false
    return
  }
  mountJianpuPlayheads(svg.value)
  bridge.syncNoteHighlight()
  if (!skipLayoutSync) {
    await syncMetaWidth()
    await syncFirstColumnHeader(usedHeaderH, cols)
    bridge.scheduleFitScaleRetries()
  }
  finishOverview(bodyFitW, opts, didMeasure)
  if (pendingRenderOpts) {
    const next = pendingRenderOpts
    pendingRenderOpts = null
    scheduleScoreRender(next)
  }
}

async function rerenderCurrent(opts = {}) {
  if (!currentXml.value) return
  if (notationMode.value === NOTATION_STAFF) {
    if (!osmdHost.value) return
  } else if (!svg.value) return
  if (renderInFlight) {
    pendingRenderOpts = mergeRenderOpts(pendingRenderOpts, opts)
    return
  }
  await renderWithXmlString(currentXml.value, opts)
}

function onNotationModeUpdate(value) {
  if (!NOTATION_MODES.includes(value) || value === notationMode.value) return
  bridge.freezeHeaderInsetsIfToolbarVisible()
  notationMode.value = value
  persistNotationMode(value)
  if (!currentXml.value) return
  scheduleScoreRender({ preferPitchUpdate: false })
}

function cancelActiveExport() {
  exportRunId += 1
  exporting.value = false
  hideToast()
}

function loadSelectedExample() {
  cancelActiveExport();
  if (isTauri()) {
    void loadLibrarySelection();
    return;
  }
  const item = examples.find((e) => e.id === selectedExample.value);
  if (!item) return;
  clearTransposeState();
  renderWithUrl(item.url);
}

async function loadLibrarySelection() {
  let target = selectedExample.value;
  if (!scoreFiles.value.includes(target)) {
    target = defaultLibraryScoreId(scoreFiles.value);
    selectedExample.value = target;
    persistSelectedExample(target);
  }
  if (!target) {
    clearRenderedScore();
    return;
  }
  try {
    const text = await readScoreText(target);
    clearTransposeState();
    await renderWithXmlString(text);
  } catch (err) {
    console.error("[load score]", err);
    showToast(err?.message || "读取曲谱失败", { type: "error" });
  }
}

async function rescanLibrary() {
  const tree = await scanScoreTree();
  scoreFiles.value = tree.files;
  scoreDirs.value = tree.dirs;
  if (uploadDir.value && !tree.dirs.includes(uploadDir.value)) uploadDir.value = "";
}

async function prepareLibrary() {
  await prepareScoreLibrary();
  await rescanLibrary();
  if (!scoreFiles.value.includes(selectedExample.value)) {
    const next = defaultLibraryScoreId(scoreFiles.value);
    selectedExample.value = next;
    persistSelectedExample(next);
  }
}

async function bootstrapScores() {
  if (isTauri()) {
    try {
      showToast("正在准备曲谱…", { type: "info", duration: 0 });
      await prepareLibrary();
      hideToast();
    } catch (err) {
      console.error("[score library]", err);
      showToast(err?.message || "无法准备曲谱目录", { type: "error" });
      return;
    }
  }
  loadSelectedExample();
}

async function beforeScoreMenu() {
  if (!isTauri()) return true;
  try {
    await rescanLibrary();
    return true;
  } catch (err) {
    console.error("[scan scores]", err);
    showToast(err?.message || "扫描曲谱目录失败", { type: "error" });
    return false;
  }
}

function onSelectedExampleUpdate(value) {
  selectedExample.value = value
  persistSelectedExample(value)
}

function onLineBreakUpdate(value) {
  if (!LINE_BREAK_VALUES.includes(value)) return
  lineBreak.value = value
  persistLineBreak(value)
  rerenderCurrent({ preferPitchUpdate: false })
  if (!isDesktop.value) bridge.closeSheet()
}

function onPaperSizeUpdate(value) {
  if (!PAPER_SIZE_VALUES.includes(value)) return
  paperSize.value = value
  persistPaperSize(value)
  rerenderCurrent({ preferPitchUpdate: false })
  if (!isDesktop.value) bridge.closeSheet()
}

function onFontSizeStep(delta) {
  const next = clampScoreFontSize(scoreFontSize.value + (Number(delta) || 0))
  if (next === scoreFontSize.value) return
  scoreFontSize.value = next
  persistScoreFontSize(next)
  measuredMetaH = 0
  rerenderCurrent({ preferPitchUpdate: false })
}

function onThemeUpdate(value) {
  if (!THEME_VALUES.includes(value)) return
  theme.value = value
  persistTheme(value)
  void applyTheme(value).then(() => {
    rerenderCurrent({ preferPitchUpdate: false })
  })
}

function onExampleChange() {
  if (!selectedExample.value) return
  loadSelectedExample()
  if (!isDesktop.value) bridge.closeSheet()
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

async function onNativeFileOpen() {
  cancelActiveExport();
  try {
    await rescanLibrary();
    const stored = readStoredUploadDir();
    uploadDir.value = !stored || scoreDirs.value.includes(stored) ? stored : "";
    uploadDestOpen.value = true;
    if (!isDesktop.value) bridge.closeSheet();
  } catch (err) {
    console.error("[upload MusicXML]", err);
    showToast(err?.message || "打开上传失败", { type: "error" });
  }
}

function cancelUploadDest() {
  if (uploadBusy.value) return;
  uploadDestOpen.value = false;
}

function selectUploadDir(dir) {
  uploadDir.value = dir || "";
}

async function createUploadDir(name, done) {
  if (uploadBusy.value) return;
  uploadBusy.value = true;
  try {
    const rel = await mkdirScoreDir(uploadDir.value, name);
    await rescanLibrary();
    uploadDir.value = rel;
    if (typeof done === "function") done();
  } catch (err) {
    console.error("[mkdir score]", err);
    showToast(err?.message || "新建目录失败", { type: "error" });
  } finally {
    uploadBusy.value = false;
  }
}

async function removeUploadDir(relative) {
  if (uploadBusy.value || relative == null) return;
  uploadBusy.value = true;
  try {
    if (!relative) await clearScoreRoot();
    else await removeScoreDir(relative);
    const selected = uploadDir.value;
    const removed =
      !relative ||
      selected === relative ||
      selected.startsWith(`${relative}/`);
    await rescanLibrary();
    if (removed) uploadDir.value = "";
    await settleAfterDelete();
    showToast(relative ? `已删除「${String(relative).split("/").pop()}」` : `已清空「${SCORE_LIBRARY_DIR}」`);
  } catch (err) {
    console.error("[remove score dir]", err);
    showToast(err?.message || "删除目录失败", { type: "error" });
  } finally {
    uploadBusy.value = false;
  }
}

async function settleAfterDelete() {
  if (scoreFiles.value.includes(selectedExample.value)) return;
  const next = defaultLibraryScoreId(scoreFiles.value);
  selectedExample.value = next;
  persistSelectedExample(next);
  if (next) {
    await loadLibrarySelection();
    return;
  }
  clearRenderedScore();
}

function clearRenderedScore() {
  currentXml.value = "";
  currentTitle.value = "";
  scoreMeta.value = null;
  clearTransposeState();
  destroyStaffPreview();
  const host = osmdHost?.value;
  if (host) clearElement(host);
  const svgEl = svg?.value;
  if (svgEl) {
    svgEl.replaceChildren();
    svgEl.setAttribute("width", "1");
    svgEl.setAttribute("height", "1");
  }
  contentW.value = 1;
  contentH.value = 1;
    lastBodyFitW = 0;
    overviewDecisionLocked = false;
    overviewLockBodyW = 0;
    if (overviewActive) overviewActive.value = false;
}

async function confirmUploadDest(files, done) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length || uploadBusy.value) return;
  uploadBusy.value = true;
  const written = [];
  let lastRel = "";
  let lastText = "";
  try {
    for (const file of list) {
      lastRel = await writeScoreInto(uploadDir.value, file.name, file.text);
      lastText = file.text;
      written.push(file.name);
    }
    persistUploadDir(uploadDir.value);
    uploadDestOpen.value = false;
    await rescanLibrary();
    selectedExample.value = lastRel;
    persistSelectedExample(lastRel);
    clearTransposeState();
    await renderWithXmlString(lastText);
    const place = uploadDir.value
      ? `${SCORE_LIBRARY_DIR} › ${uploadDir.value.split("/").join(" › ")}`
      : SCORE_LIBRARY_DIR;
    showToast(`已保存 ${written.length} 个文件到 ${place}`);
    if (!isDesktop.value) bridge.closeSheet();
  } catch (err) {
    if (typeof done === "function") done(written);
    console.error("[save score]", err);
    showToast(err?.message || "保存曲谱失败", { type: "error" });
  } finally {
    uploadBusy.value = false;
  }
}

async function onFileChange(e) {
  cancelActiveExport()
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
    clearTransposeState()
    await renderWithXmlString(text)
    if (!isDesktop.value) bridge.closeSheet()
  } catch (err) {
    console.error('[upload MusicXML]', err)
    alert(err?.message || '读取文件失败')
  } finally {
    e.target.value = ''
  }
}

async function onExportPdf() {
  if (!currentXml.value || exporting.value) return
  if (!isExportPaperSize(paperSize.value)) {
    exportPaperDialogOpen.value = true
    if (!isDesktop.value) bridge.closeSheet()
    return
  }
  if (!isTauri() && needsManualSaveGuide) {
    legacyPdfGuideOpen.value = true
    if (!isDesktop.value) bridge.closeSheet()
    return
  }
  await runExportPdf(paperSize.value)
}

async function runExportPdf(size) {
  if (!currentXml.value || exporting.value) return
  const previewWindow =
    !isTauri() && needsPdfPopupGuard() ? openPdfPopupGuard() : null
  const runId = ++exportRunId
  exporting.value = true
  showToast('正在导出 PDF…', { type: 'info', duration: 0, dismissible: true })
  try {
    const result = await exportPdf(currentXml.value, {
      title: currentTitle.value,
      lineBreak: lineBreak.value,
      paperSize: size,
      fontSize: scoreFontSize.value,
      fixedDo: fixedDo.value,
      transposeSemitones: transposeSemitones.value,
      notationMode: notationMode.value,
      previewWindow,
    })
    if (runId !== exportRunId) return
    if (result?.saved) {
      showToast('PDF 已保存', { type: 'success' })
    } else {
      showToast('已取消导出', { type: 'info' })
    }
  } catch (err) {
    if (runId !== exportRunId) return
    if (previewWindow && !previewWindow.closed) previewWindow.close()
    console.error('[export PDF]', err)
    showToast((err?.message ?? String(err)) || '导出 PDF 失败', { type: 'error' })
  } finally {
    if (runId === exportRunId) exporting.value = false
  }
}

function cancelExportPaperDialog() {
  exportPaperDialogOpen.value = false
}

function cancelLegacyPdfGuide() {
  legacyPdfGuideOpen.value = false
}

async function confirmLegacyPdfGuide() {
  if (exporting.value) return
  legacyPdfGuideOpen.value = false
  await runExportPdf(paperSize.value)
}

async function confirmExportPaper(size) {
  if (!isExportPaperSize(size) || exporting.value) return
  persistExportPaperSize(size)
  lastExportPaperSize.value = size
  exportPaperDialogOpen.value = false
  await runExportPdf(size)
}

function setTranspose(value) {
  const next = Math.max(
    -TRANSPOSE_LIMIT,
    Math.min(TRANSPOSE_LIMIT, Math.round(Number(value) || 0))
  )
  if (fixedDo.value && next === transposeSemitones.value) return
  if (!fixedDo.value && next === 0) return
  fixedDo.value = true
  transposeSemitones.value = next
  scheduleScoreRender({ preferPitchUpdate: true })
  bridge.scheduleScoreAudioReload()
}

function resetTranspose() {
  const changed = fixedDo.value || transposeSemitones.value !== 0
  fixedDo.value = false
  transposeSemitones.value = 0
  if (changed) scheduleScoreRender({ preferPitchUpdate: true })
  if (changed) bridge.scheduleScoreAudioReload()
}

function clearTransposeState() {
  transposeOpen.value = false
  fixedDo.value = false
  transposeSemitones.value = 0
  bridge.resetScoreAudio()
}

function onViewportResize() {
  bridge.syncViewportWidth()
  const vw = layoutViewportWidth()
  // 用窗口可用高度，不用画布内容高度，避免重绘撑高后再次触发
  const vh = bridge.getRenderViewportHeight()
  const widthChanged = Math.abs(vw - lastRenderViewportW) >= 1
  const heightChanged = Math.abs(vh - lastRenderViewportH) >= 1

  // 固定纸宽不重排正文时，窗口变了也要重判总览/缩放
  if (
    currentXml.value &&
    lastBodyFitW > 0 &&
    !overviewDecisionLocked &&
    overviewActive
  ) {
    const want = wantedOverview(lastBodyFitW)
    if (want !== overviewActive.value) {
      overviewActive.value = want
      rerenderCurrent({ preferPitchUpdate: false })
      return
    }
  }

  const deviceLayout = isDevicePaperSize(paperSize.value)
  const staffMode = notationMode.value === NOTATION_STAFF
  // 五线谱：无多列，仅设备宽度变化需重排
  const shouldRerender =
    !!currentXml.value &&
    (staffMode
      ? deviceLayout && widthChanged
      : isDesktop.value
        ? widthChanged || heightChanged
        : deviceLayout && widthChanged)

  if (shouldRerender) {
    lastRenderViewportW = vw
    lastRenderViewportH = vh
    rerenderCurrent({ preferPitchUpdate: false })
    return
  }
  bridge.updateFitScaleOnResize()
}

  function disposeSession() {
    if (renderRafId) {
      cancelAnimationFrame(renderRafId);
      renderRafId = 0;
    }
    pendingRenderOpts = null;
    overviewDecisionLocked = false;
    overviewLockBodyW = 0;
  }

  return {
    firstColumnX,
    firstColumnW,
    bodyMetaX,
    bodyMetaW,
    slotMetaX,
    slotMetaW,
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
    loadSelectedExample,
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
    clearTransposeState,
    rerenderCurrent,
    scheduleScoreRender,
    onViewportResize,
    overviewEpoch,
    disposeSession,
  };
}
