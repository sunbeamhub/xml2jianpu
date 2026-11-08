/* eslint-disable no-unused-vars */
import { select } from "d3-selection";
import { DEFAULT_SVG_WIDTH, SCORE_PAD_X } from "../utils/pageLayout.js";
import { SCORE_FONT_FAMILY } from "../utils/scoreFont.js";
import { fitScoreTitle, scoreTitleMaxWidth } from "../utils/fitScoreTitle.js";
import { makeScoreMetrics } from "../utils/scoreMetrics.js";
import { buildMeasureTimeline } from "../utils/musicXmlSchedule.js";
import { setJianpuBeatSegments } from "../utils/scoreHighlight.js";
import { normalizeScore } from "./parse.js";
import {
  appendAugmentationDot,
  appendJianpuBarline,
  appendNoteNumber,
  appendOctaveDots,
  appendPianoBrace,
  barlineYOffsets,
  computeLineAscentPad,
  groupUnderlineBeams,
  layerWithUpperOctaveLift,
  lowerOctaveDotCount,
  primaryBeatDuration,
  rightBarStyle,
  scanOctaveDotExtent,
  scoreError,
  scoreGuide,
  scoreHasTuplet,
  scoreInk,
  shownAugmentationDotCount,
  standardSlotWidth,
  underlineCount,
  underlineLayerY,
  upperOctaveDotCount,
} from "./glyphs.js";
import {
  applyColumnNaturalWidths,
  applyContentLineWidths,
  applyDualStaffLineWidths,
  assignChordStacks,
  assignStaffOnsets,
  buildAlignedStaffColumns,
  buildStaffNoteColumns,
  COLUMN_GAP,
  collectMeasureTimeStops,
  collectLyricSpans,
  columnsContentWidth,
  detectStaffCount,
  groupMeasureColumnsIntoLines,
  hasMusicXmlSystemBreaks,
  makeWrapProxyColumns,
  melodyNoteColumns,
  noteMidi,
  packReadableLineLayout,
  padTimeStopsForExtends,
  parseLineBreakOption,
  resolveColumnCount,
  resolveScoreWidth,
  sameStaffNeighborIndex,
  SCORE_SIDE_PAD,
  staffNoteIndices,
  staffNumberOf,
  unifyDualColumnWidths,
  widenLyricSpans,
} from "./layout.js";
import { appendTempoNote, drawScoreMeta, extractMeta, findMeasureMetronome } from "./meta.js";
import { note2number, setPitchPaint } from "./pitch.js";
import {
  appendCoda,
  appendJumpText,
  appendSegno,
  appendVolta,
  hasRepeatDecor,
  readRepeatMarks,
  repeatBarStyle,
  repeatDecorY,
} from "./repeats.js";

const d3 = { select };

export function showParseError(svgElement, err) {
  const message = err?.message || "文件可能不完整或格式无效";
  d3.select(svgElement)
    .attr("width", 640)
    .attr("height", 80)
    .append("text")
    .attr("x", 16)
    .attr("y", 36)
    .attr("fill", scoreError())
    .attr("font-size", 16)
    .text(`MusicXML 解析失败：${message}`);
}

/**
 * 只改第 1 列让头高度，避免为调号区测高再全量重绘。
 */
export function applyFirstColumnHeaderH(svgElement, headerH) {
  const col0 = svgElement?.querySelector?.(".score-col-0");
  if (!col0) return false;
  const h = Math.max(0, Number(headerH) || 0);
  const current = col0.getAttribute("transform") || "";
  const m = current.match(
    /translate\(\s*([^,\s]+)\s*,\s*([^)]+?)\s*\)\s*scale\(\s*([^)]+?)\s*\)/
  );
  if (!m) return false;
  const x = Number(m[1]);
  const s = Number(m[3]);
  if (!Number.isFinite(x) || !Number.isFinite(s)) return false;
  col0.setAttribute("transform", `translate(${x},${h}) scale(${s})`);
  return true;
}

export function jianpu(musicJson, svgElement, options = {}) {
  const ink = options.forceLight
    ? "#1C1C1E"
    : scoreInk();
  const guide = options.forceLight ? "#d0d0d0" : scoreGuide();
  const metrics = makeScoreMetrics(options.fontSize);
  const { score, measures, partAttr } = normalizeScore(musicJson);
  if (!partAttr) {
    throw new Error("缺少 attributes（调号/拍号/divisions）");
  }

  const meta = extractMeta(score, partAttr, measures, options);
  const height =
    window.innerHeight ||
    document.documentElement.clientHeight ||
    document.body.clientHeight;
  const svg = d3.select(svgElement || "svg");
  svg.attr("font-family", SCORE_FONT_FAMILY).attr("font-size", metrics.bodySize);
  // 先算正文所需宽度，再决定排版宽（窄屏不压缩，交由横向滚动）
  const g = svg
    .append("g")
    .attr("fill", ink)
    .attr("font-family", SCORE_FONT_FAMILY)
    .attr("font-size", metrics.bodySize);

  // 排版：按唱名/歌词自然宽从左排布；换行方式只决定断点
  let LAYER = { ...metrics.LAYER };
  const staffCount = detectStaffCount(measures, partAttr);
  const isGrand = staffCount > 1;
  var lyricOffset = LAYER.lyric; // 组内：唱名基线 → 歌词
  var eachHeight = isGrand ? metrics.eachHeightDual : metrics.eachHeight;
  let staffGap = isGrand ? metrics.staffGap : 0;
  if (isGrand) lyricOffset = staffGap + LAYER.lyric;
  var titleY = metrics.titleY;
  var titleFontSize = metrics.titleSize;
  var sectionGap = metrics.sectionGap; // 标题↔元信息、元信息↔正文（视觉等距）
  var marginTop = 110; // 首行唱名基线（正文定位后回写）
  function createPhraseState() {
    return { open: new Map(), seq: 0 };
  }
  const tiePhrase = createPhraseState();
  const slurPhrase = createPhraseState();

  /** notations 里某种记号（tied/slur）的 type 集合；同一音可同时 stop+start */
  function markTypes(note, name) {
    const types = new Set();
    for (const n of asList(note?.notations)) {
      for (const mark of asList(n?.[name])) {
        types.add(String(mark?.["@_type"] ?? mark?.type ?? ""));
      }
    }
    return types;
  }
  function asList(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  /**
   * 按 key 配对弧线起止（延音线 key = 谱表+音高，连音线 key = 谱表+编号），
   * 和弦里的多条延音线各自成对；跨行时两端各画半弧。
   */
  function advancePhrase(state, el, cx, y, key, lineKey, types, linkHighlight) {
    const legacy = !types.has("start") && !types.has("stop");
    const open = state.open.get(key);
    if (open && (types.has("stop") || legacy)) {
      state.open.delete(key);
      if (linkHighlight && open.el !== el) {
        const tieId = open.el.getAttribute("data-tie") || `t${++state.seq}`;
        open.el.setAttribute("data-tie", tieId);
        el.setAttribute("data-tie", tieId);
      }
      const host = d3.select(el);
      const arc = (p) =>
        host
          .append("path")
          .attr("fill", "none")
          .attr("stroke", ink)
          .attr("stroke-width", metrics.tieStroke)
          .attr("d", pathTied(p));
      if (open.lineKey === lineKey) {
        const top = Math.min(open.y, y);
        arc([open.x, top, cx, top]);
      } else {
        arc([open.x, open.y, open.x + metrics.tieHookPx, open.y]);
        arc([cx - metrics.tieHookPx, y, cx, y]);
      }
      if (legacy) return;
    }
    if (types.has("start") || (legacy && !open)) {
      state.open.set(key, { x: cx, y, el, lineKey });
    }
  }
  const divisions = Number(partAttr.divisions) || 1;
  const repeatInfo = readRepeatMarks(measures);
  const repeatMarks = repeatInfo.marks;

  // —— Pass1：先按小节收集列并量宽，再按 lineBreak 断行 ——
  const measureHost = g.append("g").attr("visibility", "hidden");
  const measureColumns = [];
  const noteLayout = []; // noteLayout[measureIdx][noteIdx] = { cx, lineIndex, extendCxs }

  const measureLayouts = [];
  for (let j = 0; j < measures.length; j++) {
    noteLayout[j] = [];
    const notes = measures[j].note;
    const barCol = {
      kind: "bar",
      measureIdx: j,
      style: rightBarStyle(measures[j], j === measures.length - 1),
    };
    if (isGrand) {
      const byStaff = Array.from({ length: staffCount }, () => []);
      for (let i = 0; i < notes.length; i++) {
        const s = Math.min(staffCount, staffNumberOf(notes[i]));
        byStaff[s - 1].push({ d: notes[i], i });
      }
      for (const entries of byStaff) assignStaffOnsets(entries);
      const timeStops = padTimeStopsForExtends(
        byStaff,
        collectMeasureTimeStops(byStaff),
        divisions
      );
      const staves = byStaff.map((entries) =>
        buildAlignedStaffColumns(
          entries,
          timeStops,
          j,
          partAttr,
          options,
          divisions,
          noteLayout[j]
        )
      );
      measureLayouts[j] = { staves, bar: barCol, measureIdx: j };
      measureColumns.push(staves[0] ? staves[0].concat([barCol]) : [barCol]);
    } else {
      const cols = buildStaffNoteColumns(
        notes.map((d, i) => ({ d, i })),
        j,
        partAttr,
        options,
        divisions,
        noteLayout[j]
      );
      cols.push(barCol);
      // 前反复先占一个小节线位；断行后不在行首的再并到上一小节线
      if (repeatMarks[j]?.forward) {
        cols.unshift({ kind: "bar", lead: true, measureIdx: j, style: "repeat-start" });
      }
      measureColumns.push(cols);
    }
  }

  const slotW = standardSlotWidth(measureHost, metrics);
  const lyricSpans = collectLyricSpans(
    melodyNoteColumns(measureColumns, measureLayouts, isGrand)
  );
  if (isGrand) {
    for (const ml of measureLayouts) {
      for (const cols of ml.staves) {
        applyColumnNaturalWidths(cols, measureHost, metrics, slotW, divisions);
      }
    }
  } else {
    for (const cols of measureColumns) {
      applyColumnNaturalWidths(cols, measureHost, metrics, slotW, divisions);
    }
  }
  widenLyricSpans(lyricSpans, measureHost, metrics);
  if (isGrand) {
    for (const ml of measureLayouts) {
      unifyDualColumnWidths(ml.staves, slotW);
      ml.bar.w = slotW;
      const sharedCols = ml.staves[0] || [];
      ml.wrapWidth = columnsContentWidth(sharedCols) + slotW;
      ml.wrapUnits = sharedCols.length + 1;
    }
  }
  measureHost.remove();

  const extentColumns = isGrand
    ? measureLayouts.flatMap((ml) => ml.staves)
    : measureColumns;
  const { maxUpper: maxUpperDots, maxLower: maxLowerDots } =
    scanOctaveDotExtent(extentColumns);
  LAYER = layerWithUpperOctaveLift(
    LAYER,
    maxUpperDots,
    metrics.octaveDotStep
  );
  let lineAscentPad = computeLineAscentPad(
    LAYER,
    metrics,
    maxUpperDots,
    scoreHasTuplet(extentColumns, divisions)
  );
  const barYUpper = barlineYOffsets(
    isGrand ? measureLayouts.map((ml) => ml.staves[0] || []) : measureColumns,
    divisions,
    LAYER,
    metrics
  );
  const barYLower = isGrand
    ? barlineYOffsets(
        measureLayouts.map((ml) => ml.staves[1] || []),
        divisions,
        LAYER,
        metrics
      )
    : barYUpper;
  // 和弦竖排后多出的高度：上谱表顶部和两谱表之间各自加宽
  const stackLift = assignChordStacks(
    extentColumns,
    noteLayout,
    metrics,
    maxUpperDots
  );
  if (isGrand) {
    staffGap += stackLift[2];
    eachHeight += stackLift[1] + stackLift[2];
    lyricOffset = staffGap + LAYER.lyric;
  } else {
    eachHeight += stackLift[1];
  }
  lineAscentPad += stackLift[1];
  const barY = isGrand
    ? { yTop: barYUpper.yTop, yBottom: staffGap + barYLower.yBottom }
    : barYUpper;
  // 房子与 D.C./Segno 等画在最高记号之上，行首和行距都要让出这块高度
  const hasDecor = hasRepeatDecor(repeatInfo);
  const decorY = repeatDecorY(LAYER, metrics, barY.yTop) - stackLift[1];
  const jumpBaseY = decorY - 2 * metrics.s;
  if (hasDecor) {
    const hasSymbol = repeatMarks.some((m) => m.segno || m.coda);
    const hasText = repeatMarks.some((m) => m.endTexts.length || m.startTexts.length);
    let decorTop = decorY - metrics.s;
    if (hasText) decorTop = Math.min(decorTop, jumpBaseY - metrics.jumpTextSize * 0.8);
    if (hasSymbol) decorTop = Math.min(decorTop, jumpBaseY - metrics.jumpSymbolSize);
    lineAscentPad = Math.max(lineAscentPad, -decorTop);
    const needLineH = -decorTop + lyricOffset + 6 * metrics.s;
    if (eachHeight < needLineH) eachHeight = Math.ceil(needLineH);
  }

  const hideMeta = !!options.hideMeta;
  const fitPad =
    options.contentPadX != null ? Number(options.contentPadX) : SCORE_PAD_X;
  const colCap =
    options.maxColumnWidth != null && Number(options.maxColumnWidth) > 0
      ? Number(options.maxColumnWidth)
      : options.width
        ? Number(options.width)
        : null;
  const breakCap = colCap || DEFAULT_SVG_WIDTH;
  const breakInnerW = Math.max(1, breakCap - 2 * fitPad);

  let lineBreakMode = parseLineBreakOption(options.lineBreak);
  if (lineBreakMode === "musicxml" && !hasMusicXmlSystemBreaks(measures)) {
    lineBreakMode = "auto";
  }
  const useReadableUnits =
    !!options.readableLineUnits && lineBreakMode === "auto";

  const wrapColumns = isGrand
    ? measureLayouts.map(makeWrapProxyColumns)
    : measureColumns;

  let scoreLines;
  let measureLineIndex;
  let readableColumnCount = null;
  let readableColumnSlotW = null;
  if (useReadableUnits) {
    const packed = packReadableLineLayout(
      wrapColumns,
      measures,
      options,
      breakCap,
      fitPad,
      eachHeight,
      slotW,
      svgElement
    );
    scoreLines = packed.scoreLines;
    measureLineIndex = packed.measureLineIndex;
    readableColumnCount = packed.columnCount;
    readableColumnSlotW = packed.columnSlotW;
  } else {
    const grouped = groupMeasureColumnsIntoLines(
      wrapColumns,
      measures,
      lineBreakMode,
      breakInnerW
    );
    scoreLines = grouped.scoreLines;
    measureLineIndex = grouped.measureLineIndex;
  }
  if (!isGrand) {
    for (const line of scoreLines) {
      line.columns = line.columns.filter(
        (c) =>
          !c.lead ||
          c.measureIdx === 0 ||
          measureLineIndex[c.measureIdx - 1] !== measureLineIndex[c.measureIdx]
      );
    }
  }

  for (let j = 0; j < measures.length; j++) {
    const lineIndex = measureLineIndex[j] ?? 0;
    for (const layout of noteLayout[j] || []) {
      if (!layout) continue;
      layout.lineIndex = lineIndex;
      if (layout.noteCol) layout.noteCol.lineIndex = lineIndex;
    }
  }

  let dualLines = null;
  let contentWidth;
  if (isGrand) {
    const dualPacked = applyDualStaffLineWidths(
      measureLayouts,
      measureLineIndex,
      measures.length,
      metrics,
      slotW,
      (j) => (repeatMarks[j]?.forward ? metrics.repeatLeadW : 0)
    );
    dualLines = dualPacked.dualLines;
    contentWidth = dualPacked.maxWidth;
  } else {
    contentWidth = applyContentLineWidths(scoreLines, metrics.layoutMinGap);
  }
  // 正文宽 = 最长行；列槽内整体居中，行内仍左对齐
  const targetWidth = contentWidth;

  // 回填音符与延音线中心坐标
  for (let j = 0; j < measures.length; j++) {
    for (let i = 0; i < (noteLayout[j] || []).length; i++) {
      const layout = noteLayout[j][i];
      if (!layout) continue;
      const cxSrc = layout.slotCol || layout.noteCol;
      layout.cx = cxSrc.cx;
      if (layout.noteCol && layout.noteCol !== cxSrc) layout.noteCol.cx = cxSrc.cx;
      layout.extendCxs = (layout.extendCols || []).map((c) => c.cx);
    }
  }

  const naturalColumnW = targetWidth;
  const columnSlotW =
    readableColumnSlotW != null
      ? readableColumnSlotW
      : colCap || naturalColumnW;
  const columnCount =
    readableColumnCount != null
      ? readableColumnCount
      : resolveColumnCount(
          options,
          scoreLines.length,
          columnSlotW,
          eachHeight,
          svgElement
        );
  const linesPerCol = Math.max(1, Math.ceil(scoreLines.length / columnCount));

  function linePlacement(lineIndex) {
    const col = Math.min(
      columnCount - 1,
      Math.floor(lineIndex / linesPerCol)
    );
    const localLine = lineIndex - col * linesPerCol;
    return { col, localLine };
  }

  let width;
  let bodyScale = 1;
  const useSlotLayout = colCap != null || readableColumnSlotW != null;
  if (useSlotLayout) {
    width =
      columnCount * columnSlotW + Math.max(0, columnCount - 1) * COLUMN_GAP;
    const innerW = Math.max(1, columnSlotW - 2 * fitPad);
    bodyScale =
      naturalColumnW > 0 ? Math.min(1, innerW / naturalColumnW) : 1;
  } else {
    const totalNatural =
      columnCount * naturalColumnW +
      Math.max(0, columnCount - 1) * COLUMN_GAP;
    width = resolveScoreWidth(
      svgElement,
      options,
      totalNatural + 2 * SCORE_SIDE_PAD
    );
  }

  const scaledColW = naturalColumnW * bodyScale;
  const innerW = useSlotLayout
    ? Math.max(1, columnSlotW - 2 * fitPad)
    : scaledColW;
  const colContentPad = useSlotLayout
    ? fitPad + (innerW - scaledColW) / 2
    : Math.max(0, (width - scaledColW) / 2);
  const bodyMetaX = colContentPad;
  const bodyMetaW = scaledColW;
  const slotMetaX = useSlotLayout ? fitPad : 0;
  const slotMetaW = innerW;

  svg.attr("width", width).attr("height", height);

  const scoreCenterX = width / 2;

  /** 行内局部 cx → 列组自然坐标（列组上再 scale） */
  function bodyXY(lineIndex, localCx) {
    const { localLine } = linePlacement(lineIndex);
    return {
      x: localCx,
      y: localLine * eachHeight,
    };
  }

  /** 倚音：主音左上方的小号唱名，带短下划线与指向主音的小连线 */
  function drawGraceNote(el, layout, number, note, cx, baseCy) {
    const ratio = metrics.graceSize / metrics.bodySize;
    const host = layout.slotCol;
    const hostTopDy =
      noteLayout[host.measureIdx]?.[host.noteIdx]?.stackTopDy || 0;
    const { index, count } = layout.grace;
    const mainHalf = metrics.bodySize * 0.3;
    const gx =
      cx -
      mainHalf -
      metrics.graceGap -
      (count - 1 - index + 0.5) * metrics.graceStep;
    const gy = baseCy + hostTopDy - metrics.graceLift;
    const sel = d3.select(el);
    appendNoteNumber(
      el,
      gx,
      gy,
      number,
      {
        ...metrics,
        bodySize: metrics.graceSize,
        accidentalDy: metrics.accidentalDy * ratio,
        naturalDy: metrics.naturalDy * ratio,
      },
      { note: 0 }
    ).classed("jianpu-grace", true);

    const ascent = metrics.noteAscent * ratio;
    const dotStep = metrics.octaveDotStep * ratio;
    const dotR = metrics.octaveDotR * ratio;
    const lines = underlineCount(note, 0, divisions);
    const lineStep = metrics.underlineStep * ratio;
    const lineTop = gy + LAYER.underline1 * ratio;
    const half = metrics.graceStep / 2;
    for (let k = 0; k < lines; k++) {
      const y = lineTop + k * lineStep;
      sel
        .append("line")
        .attr("class", "jianpu-underline")
        .attr("x1", gx - half)
        .attr("x2", gx + half)
        .attr("y1", y)
        .attr("y2", y)
        .attr("stroke", ink)
        .attr("stroke-width", metrics.barlineStroke * ratio);
    }
    const upDots = upperOctaveDotCount(number.octave);
    const downDots = lowerOctaveDotCount(number.octave);
    for (let k = 0; k < upDots + downDots; k++) {
      const y =
        upDots > 0
          ? gy - ascent - (k + 1) * dotStep
          : lineTop + Math.max(0, lines - 1) * lineStep + (k + 1) * dotStep;
      sel
        .append("circle")
        .attr("cx", gx)
        .attr("cy", y)
        .attr("r", dotR)
        .attr("fill", ink);
    }
    if (index === count - 1) {
      // 从倚音组下方弯到主音左侧腰部
      const first = gx - (count - 1) * metrics.graceStep;
      const x1 = first;
      const y1 = lineTop + Math.max(0, lines - 1) * lineStep + dotStep;
      const x2 = cx - mainHalf - metrics.graceGap / 2;
      const y2 = baseCy + hostTopDy - metrics.noteAscent * 0.35;
      const bend = metrics.tieCurve;
      sel
        .append("path")
        .attr("class", "jianpu-grace-slur")
        .attr("fill", "none")
        .attr("stroke", ink)
        .attr("stroke-width", metrics.tieStroke)
        .attr(
          "d",
          `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.max(y1, y2) + bend} ${x2} ${y2}`
        );
    }
  }

  // —— 标题（屏幕与 PDF 同一段） ——
  let titleEl = null;
  let titleBaseline = titleY;
  if (meta.title) {
    titleEl = g
      .append("text")
      .attr("transform", `translate(${scoreCenterX},${titleY})`)
      .attr("font-weight", "bold")
      .attr("text-anchor", "middle")
      .attr("font-size", titleFontSize)
      .text(meta.title);
    titleEl.append("title").text(meta.title);
    const fitted = fitScoreTitle(titleEl.node(), {
      fontSize: titleFontSize,
      baseline: titleY,
      maxWidth: scoreTitleMaxWidth(width),
    });
    if (fitted.scale < 1) {
      titleFontSize = fitted.fontSize;
      titleBaseline = fitted.baseline;
      titleEl
        .attr("font-size", titleFontSize)
        .attr("transform", `translate(${scoreCenterX},${titleBaseline})`);
    }
  }

  // HTML 调号区叠在标题下方：第 1 列让出这块高度，其余列与调号区顶对齐
  const firstColumnHeaderH = hideMeta
    ? Math.max(0, Number(options.firstColumnHeaderH) || 0)
    : 0;

  // 正文画在独立分组；每列一组均匀缩放，避免只压 x 导致叠字
  const bodyG = g.append("g").attr("class", "score-body");
  const colGroups = [];
  for (let c = 0; c < columnCount; c++) {
    const colX = c * (columnSlotW + COLUMN_GAP) + colContentPad;
    const colY = c === 0 ? firstColumnHeaderH : 0;
    colGroups[c] = bodyG
      .append("g")
      .attr("class", `score-col score-col-${c}`)
      .attr("transform", `translate(${colX},${colY}) scale(${bodyScale})`);
  }

  /** 小节 j 右侧小节线所在列（单行谱不含行首前反复列） */
  function rightBarColOf(j) {
    if (isGrand) return measureLayouts[j]?.bar || null;
    const line = scoreLines[measureLineIndex[j]];
    return (
      line?.columns.find((c) => c.kind === "bar" && !c.lead && c.measureIdx === j) ||
      null
    );
  }
  /** 小节 j 在行首时的前反复列 */
  function leadBarColOf(j) {
    const line = scoreLines[measureLineIndex[j]];
    return line?.columns.find((c) => c.lead && c.measureIdx === j) || null;
  }
  /** 小节 j 左缘（上一小节线 / 行首前反复线 / 行首） */
  function measureLeftX(j) {
    const li = measureLineIndex[j];
    if (j > 0 && measureLineIndex[j - 1] === li) {
      const prev = rightBarColOf(j - 1);
      if (prev && Number.isFinite(prev.cx)) return prev.cx;
    }
    if (isGrand) {
      if (repeatMarks[j]?.forward && dualLines?.[li]) return grandLeadRepeatX(li);
      return dualLines?.[li]?.leftBarX ?? 0;
    }
    const lead = leadBarColOf(j);
    if (lead && Number.isFinite(lead.cx)) return lead.cx;
    return 0;
  }
  /** 钢琴双行行首前反复 ‖: 的位置：系统竖线右侧，粗线离开花括号竖线 */
  function grandLeadRepeatX(li) {
    return (
      (dualLines?.[li]?.leftBarX ?? 0) + 3.5 * metrics.s + metrics.barlineFinalOffsetR
    );
  }
  function measureRightX(j) {
    const bar = rightBarColOf(j);
    return bar && Number.isFinite(bar.cx) ? bar.cx : measureLeftX(j);
  }

  const timeline = buildMeasureTimeline(measures);
  // 反复时同一音符/小节会奏多遍，按演奏先后各存一份
  const slotsByKey = new Map();
  for (const slot of timeline.slots) {
    const key = `${slot.measureIndex}-${slot.noteIndex}`;
    if (!slotsByKey.has(key)) slotsByKey.set(key, []);
    slotsByKey.get(key).push(slot);
  }
  for (const list of slotsByKey.values()) list.sort((a, b) => a.time - b.time);
  const measurePassesByIdx = new Map();
  for (const m of timeline.measures) {
    if (!measurePassesByIdx.has(m.measureIndex)) measurePassesByIdx.set(m.measureIndex, []);
    measurePassesByIdx.get(m.measureIndex).push(m);
  }

  /** @type {Array<{ measureIndex: number, startSec: number, endSec: number, x0: number, x1: number, yTop: number, yBottom: number, colIndex: number, lineIndex: number }>} */
  const beatSegments = [];

  const noteEls = [];
  for (var j = 0; j < measures.length; j++) {
    const lineIndex = measureLineIndex[j];
    const { col: lineCol, localLine } = linePlacement(lineIndex);
    const notes = measures[j].note;
    const length = notes.length;
    const durList = notes.map(
      (d, i) => noteLayout[j][i]?.noteCol?.number?.dur || 0
    );

    colGroups[lineCol]
      .selectAll(`.note-m${j}`)
      .data(notes)
      .enter()
      .append("g")
      .attr("class", `note note-m${j}`)
      .attr("data-note", (d, i) => `${j}-${i}`)
      .attr("data-onset", (d, i) => {
        const slot = slotsByKey.get(`${j}-${i}`)?.[0];
        return slot?.time == null ? null : slot.time.toFixed(4);
      })
      .attr("data-end", (d, i) => {
        const slot = slotsByKey.get(`${j}-${i}`)?.[0];
        if (slot?.time == null || slot.duration == null) return null;
        // 跟弹用下一音的精确 onset 当“现在”，并一直保持到再下一步。
        // 结束时间若只留 4 位小数，四舍五入可能晚于这个 onset，
        // 上一音就会整步不灭。八分音符因此会亮到这一拍结束。
        // 高亮比较的余量是 1e-6，这里留 6 位，误差更小。
        return (slot.time + slot.duration).toFixed(6);
      })
      // 每遍的 onset:end，空格分隔；onset 与跟弹步骤 key 同为 4 位小数
      .attr("data-times", (d, i) => {
        const list = slotsByKey.get(`${j}-${i}`);
        if (!list || list.length < 2) return null;
        return list
          .filter((s) => s.time != null && s.duration != null)
          .map((s) => `${s.time.toFixed(4)}:${(s.time + s.duration).toFixed(6)}`)
          .join(" ");
      })
      .each(function (d, i) {
        const layout = noteLayout[j][i];
        if (!layout) return;
        const number = layout.noteCol.number;
        const pos = bodyXY(lineIndex, layout.cx);
        const cx = pos.x;
        const staffN = staffNumberOf(d);
        const baseCy = pos.y + (isGrand ? (staffN - 1) * staffGap : 0);
        if (layout.grace) {
          drawGraceNote(this, layout, number, d, cx, baseCy);
          return;
        }
        const stacked = layout.stackTopDy != null;
        const isBase = !stacked || layout.stackIndex === 0;
        const isMain = !layout.slotCol;
        const cy = baseCy + (layout.stackDy || 0);
        const hostCol = layout.slotCol || layout.noteCol;
        const underlineN = isBase
          ? underlineCount(hostCol.note, hostCol.number.dur, divisions)
          : 0;
        noteEls.push({
          el: this,
          j,
          i,
          cx,
          cy,
          underlineN,
        });

        const noteNumberIs = appendNoteNumber(
          this,
          cx,
          cy,
          number,
          metrics,
          LAYER
        );

        const augCount = shownAugmentationDotCount(
          d,
          number.dur,
          divisions
        );
        if (augCount > 0) {
          appendAugmentationDot(
            this,
            cx,
            cy,
            noteNumberIs,
            metrics,
            LAYER,
            ink,
            augCount
          );
        }

        const lyric = layout.noteCol.lyric;
        const spanned = (layout.noteCol.lyricSpanCount || 1) > 1;
        if (lyric && isMain && !spanned && (!isGrand || staffN === 1)) {
          d3.select(this)
            .append("text")
            .attr("class", "jianpu-lyric")
            .attr("text-anchor", "middle")
            .attr("font-weight", "bold")
            .attr("font-size", metrics.bodySize)
            .attr("transform", `translate(${cx},${baseCy + LAYER.lyric})`)
            .text(lyric);
        }

        if (isMain && number.dur > divisions) {
          const isRestExtend = number.text === "0";
          for (let k = 0; k < layout.extendCxs.length; k++) {
            const exX = bodyXY(lineIndex, layout.extendCxs[k]).x;
            if (isRestExtend) {
              d3.select(this)
                .append("text")
                .attr("transform", `translate(${exX},${baseCy + LAYER.note})`)
                .attr("font-weight", "normal")
                .attr("font-size", metrics.bodySize)
                .attr("text-anchor", "middle")
                .text("0");
              continue;
            }
            const slot = Number(layout.extendCols[k]?.w) || metrics.layoutMinGap;
            const half = (slot * metrics.extendDashRatio) / 2;
            const y = baseCy + LAYER.note - metrics.extendDashY;
            d3.select(this)
              .append("line")
              .attr("class", "extend-dash")
              .attr("x1", exX - half)
              .attr("x2", exX + half)
              .attr("y1", y)
              .attr("y2", y)
              .attr("stroke", ink)
              .attr("stroke-width", metrics.extendDashStroke)
              .attr("stroke-linecap", "round");
          }
        }

        appendOctaveDots(
          this,
          cx,
          cy,
          number.octave,
          LAYER,
          metrics,
          ink,
          noteNumberIs,
          underlineN
        );

        // 和弦上的弧线统一画在最高音上方
        const arcY = baseCy + (layout.stackTopDy || 0) + LAYER.tie;
        const lineKey = `${lineIndex}`;
        const phraseStaff = isGrand ? staffN : 0;
        if (number.tied) {
          advancePhrase(
            tiePhrase,
            this,
            cx,
            arcY,
            `${phraseStaff}:${noteMidi(d)}`,
            lineKey,
            markTypes(d, "tied"),
            true
          );
        }
        if (number.slur) {
          advancePhrase(
            slurPhrase,
            this,
            cx,
            arcY,
            `${phraseStaff}`,
            lineKey,
            markTypes(d, "slur"),
            false
          );
        }

        if (
          isMain &&
          (number.dur == divisions / 3 || number.dur == divisions * 2 / 3)
        ) {
          const tupletCy = baseCy + (layout.stackTopDy || 0);
          const mainNeighbor = (delta) => {
            let k = sameStaffNeighborIndex(notes, i, delta);
            while (k >= 0 && noteLayout[j][k]?.slotCol) {
              k = sameStaffNeighborIndex(notes, k, delta);
            }
            return k;
          };
          const prevI = mainNeighbor(-1);
          const nextI = mainNeighbor(1);
          if (
            prevI >= 0 &&
            nextI >= 0 &&
            durList[prevI] == number.dur &&
            number.dur == durList[nextI]
          ) {
            const leftX = bodyXY(lineIndex, noteLayout[j][prevI].cx).x - cx;
            const rightX = bodyXY(lineIndex, noteLayout[j][nextI].cx).x - cx;
            d3.select(this)
              .append("path")
              .attr("fill", "none")
              .attr("stroke", ink)
              .attr("stroke-width", metrics.tieStroke)
              .attr("transform", `translate(${cx},${tupletCy})`)
              .attr(
                "d",
                `M ${leftX} ${LAYER.tupletLeg} L ${leftX} ${LAYER.tupletTop} L ${rightX} ${LAYER.tupletTop} L ${rightX} ${LAYER.tupletLeg}`
              );
            d3.select(this)
              .append("text")
              .attr("font-size", metrics.bodySize)
              .attr("text-anchor", "middle")
              .attr("x", 0)
              .attr("y", LAYER.tupletLeg)
              .attr("transform", `translate(${cx},${tupletCy})`)
              .text("3");
          }
        }
      });

    // 同一拍内有下划线的音符/休止符连成一组（双行按谱表分开）
    const measureAttr = measures[j].attributes || partAttr;
    const beatDur = primaryBeatDuration(
      Number(measureAttr.divisions) || divisions,
      measureAttr
    );
    const staffLoop = isGrand
      ? Array.from({ length: staffCount }, (_, s) => s + 1)
      : [1];
    for (const staffN of staffLoop) {
      // 和弦音、倚音不占拍，只按主列累加时值
      const origIdxs = (
        isGrand ? staffNoteIndices(notes, staffN) : notes.map((_, i) => i)
      ).filter((i) => !noteLayout[j][i]?.slotCol);
      const subset = origIdxs.map((i) => notes[i]);
      const subsetDurs = origIdxs.map((i) => durList[i] || 0);
      const underlineGroups = groupUnderlineBeams(
        subset,
        subsetDurs,
        beatDur,
        Number(measureAttr.divisions) || divisions
      );
      underlineGroups.forEach((levelGroups, levelIdx) => {
        const y = underlineLayerY(levelIdx + 1, LAYER, metrics.underlineStep);
        for (const localIdxs of levelGroups) {
          const xs = [];
          let cy = 0;
          for (const local of localIdxs) {
            const i = origIdxs[local];
            const layout = noteLayout[j][i];
            if (!layout) continue;
            const pos = bodyXY(lineIndex, layout.cx);
            xs.push(pos.x);
            cy = pos.y + (isGrand ? (staffN - 1) * staffGap : 0);
          }
          if (!xs.length) continue;
          const x1 = Math.min(...xs) - metrics.underlineHalf;
          const x2 = Math.max(...xs) + metrics.underlineHalf;
          colGroups[lineCol]
            .append("line")
            .attr("class", "jianpu-underline")
            .attr("x1", x1)
            .attr("x2", x2)
            .attr("y1", cy + y)
            .attr("y2", cy + y)
            .attr("stroke", ink)
            .attr("stroke-width", metrics.barlineStroke);
        }
      });
    }

    // 小节竖线：取该小节 bar 列中心；全曲末为终止线；反复线带两点
    const staffYs = isGrand ? [0, staffGap] : [0];
    const barCol = rightBarColOf(j);
    if (barCol) {
      const barPos = bodyXY(lineIndex, barCol.cx);
      appendJianpuBarline(
        colGroups[lineCol],
        barPos.x,
        barPos.y,
        repeatBarStyle(
          repeatMarks,
          j,
          barCol.style || "regular",
          measureLineIndex[j + 1] === lineIndex
        ),
        ink,
        barY.yTop,
        barY.yBottom,
        metrics,
        staffYs
      );
    }
    const leadCol = isGrand ? null : leadBarColOf(j);
    if (leadCol) {
      const leadPos = bodyXY(lineIndex, leadCol.cx);
      appendJianpuBarline(
        colGroups[lineCol],
        leadPos.x,
        leadPos.y,
        "repeat-start",
        ink,
        barY.yTop,
        barY.yBottom,
        metrics,
        staffYs
      );
    }

    const mPasses = (measurePassesByIdx.get(j) || []).filter(
      (p) => p.endSec > p.startSec
    );
    const mTime = mPasses[0];
    if (mTime) {
      const mDiv = Math.max(1, Number(mTime.divisions) || divisions);
      const mAttr = measures[j].attributes || partAttr;
      const mBeatType = Math.max(1, Number(mAttr?.time?.["beat-type"]) || 4);
      const beatDivs = mDiv * (4 / mBeatType);
      const beatsCount = Math.max(1, Math.round(Number(mTime.beats) || 1));
      const anchorMap = new Map();
      if (isGrand) {
        for (const col of measureLayouts[j]?.staves?.[0] || []) {
          if (col.kind === "spacer" || !Number.isFinite(col.cx)) continue;
          const onsetDiv = Number(col.onset);
          if (Number.isFinite(onsetDiv) && !anchorMap.has(onsetDiv)) {
            anchorMap.set(onsetDiv, col.cx);
          }
        }
      } else {
        let curDiv = 0;
        let lastOnsetDiv = 0;
        for (let i = 0; i < notes.length; i++) {
          const d = notes[i];
          const layout = noteLayout[j][i];
          if (!layout || !Number.isFinite(layout.cx)) continue;
          const isChord = d != null && d.chord != null && d.chord !== false;
          const dur = Math.max(0, Number(layout.noteCol?.number?.dur) || 0);
          const noteOnsetDiv = isChord ? lastOnsetDiv : curDiv;
          if (!isChord) {
            lastOnsetDiv = curDiv;
            curDiv += dur;
          }
          if (!anchorMap.has(noteOnsetDiv)) {
            anchorMap.set(noteOnsetDiv, layout.cx);
          }
          for (let k = 0; k < (layout.extendCxs || []).length; k++) {
            const extOnsetDiv = noteOnsetDiv + (k + 1) * mDiv;
            const extCx = layout.extendCxs[k];
            if (Number.isFinite(extCx) && !anchorMap.has(extOnsetDiv)) {
              anchorMap.set(extOnsetDiv, extCx);
            }
          }
        }
      }
      const totalDivs = beatsCount * beatDivs;
      const barCx = Number.isFinite(barCol?.cx) ? barCol.cx : null;
      const prevBarCol =
        j > 0 && measureLineIndex[j - 1] === lineIndex
          ? isGrand
            ? measureLayouts[j - 1]?.bar
            : rightBarColOf(j - 1)
          : null;
      const startFallbackX = Number.isFinite(prevBarCol?.cx)
        ? prevBarCol.cx
        : isGrand && dualLines?.[lineIndex]
          ? dualLines[lineIndex].leftBarX
          : 0;
      const sortedAnchors = [...anchorMap.entries()].sort((a, b) => a[0] - b[0]);
      if (!sortedAnchors.length || sortedAnchors[0][0] > 1e-4) {
        sortedAnchors.unshift([
          0,
          sortedAnchors.length ? sortedAnchors[0][1] : startFallbackX,
        ]);
      }
      const lastAnchorX = sortedAnchors[sortedAnchors.length - 1][1];
      const endX = barCx != null ? barCx : lastAnchorX + slotW;
      sortedAnchors.push([totalDivs, endX]);

      const interpMeasureX = (targetDiv) => {
        if (targetDiv <= sortedAnchors[0][0]) return sortedAnchors[0][1];
        for (let idx = 0; idx < sortedAnchors.length - 1; idx++) {
          const [d0, x0] = sortedAnchors[idx];
          const [d1, x1] = sortedAnchors[idx + 1];
          if (targetDiv <= d1 + 1e-6) {
            if (d1 <= d0 + 1e-6) return x0;
            const ratio = Math.max(0, Math.min(1, (targetDiv - d0) / (d1 - d0)));
            return x0 + (x1 - x0) * ratio;
          }
        }
        return sortedAnchors[sortedAnchors.length - 1][1];
      };

      const lineY = localLine * eachHeight;
      const lineOverhang = Math.max(8, Math.round(10 * metrics.s));
      for (const pass of mPasses) {
        const beatSec = (pass.endSec - pass.startSec) / beatsCount;
        for (let b = 0; b < beatsCount; b++) {
          const bStartSec = pass.startSec + b * beatSec;
          const bEndSec =
            b === beatsCount - 1 ? pass.endSec : pass.startSec + (b + 1) * beatSec;
          const x0 = interpMeasureX(b * beatDivs);
          const x1 = interpMeasureX((b + 1) * beatDivs);
          beatSegments.push({
            measureIndex: j,
            startSec: bStartSec,
            endSec: bEndSec,
            x0,
            x1: Math.max(x0, x1),
            yTop: lineY + barY.yTop - lineOverhang,
            yBottom: lineY + barY.yBottom + lineOverhang,
            colIndex: lineCol,
            lineIndex,
          });
        }
      }
    }
    if (j > 0) {
      const mm = findMeasureMetronome(measures[j]);
      if (mm) {
        const firstI = isGrand ? (staffNoteIndices(notes, 1)[0] ?? 0) : 0;
        const layout = noteLayout[j][firstI];
        if (layout) {
          const pos = bodyXY(lineIndex, layout.cx);
          const tempoG = colGroups[lineCol]
            .append("g")
            .attr("class", "measure-tempo")
            .attr(
              "transform",
              `translate(${pos.x},${pos.y + LAYER.tupletTop})`
            );
          const noteAdvance = appendTempoNote(tempoG, 0, 0, metrics, ink);
          const tempoFs = metrics.metaSize * 0.85;
          tempoG
            .append("text")
            .attr("text-anchor", "start")
            .attr("font-size", tempoFs)
            .attr("font-style", "italic")
            .attr("x", noteAdvance)
            .attr("y", tempoFs * 0.36)
            .attr("data-score-bpm", String(mm).replace(/[^\d.]/g, ""))
            .text(`=${mm}`);
        }
      }
    }
    if (isGrand && dualLines?.[lineIndex] && !dualLines[lineIndex].braceDrawn) {
      dualLines[lineIndex].braceDrawn = true;
      const lineY = bodyXY(lineIndex, 0).y;
      appendJianpuBarline(
        colGroups[lineCol],
        dualLines[lineIndex].leftBarX,
        lineY,
        "regular",
        ink,
        barY.yTop,
        barY.yBottom,
        metrics
      );
      if (repeatMarks[j]?.forward) {
        appendJianpuBarline(
          colGroups[lineCol],
          grandLeadRepeatX(lineIndex),
          lineY,
          "repeat-start",
          ink,
          barY.yTop,
          barY.yBottom,
          metrics,
          [0, staffGap]
        );
      }
      appendPianoBrace(
        colGroups[lineCol],
        dualLines[lineIndex].leftBarX,
        lineY + barY.yTop,
        lineY + barY.yBottom,
        ink,
        metrics
      );
    }
  }

  drawSpannedLyrics(lyricSpans);
  if (hasDecor) drawRepeatDecor();

  /** 房子括线（跨行时每行一段）与 Segno/Coda/D.C./Fine 等 */
  function drawRepeatDecor() {
    const inset = 1.5 * metrics.s;
    const baseDecorY = decorY + stackLift[1];
    /** 小节内音符（含高音点、弧线）实际最高处，相对行基线；量不到时用全曲上限 */
    const measureTopY = (j) => {
      const li = measureLineIndex[j];
      const lineY = bodyXY(li, 0).y;
      let top = Infinity;
      colGroups[linePlacement(li).col]
        .selectAll(`.note-m${j}`)
        .each(function () {
          try {
            const box = this.getBBox();
            if (box.width > 0 || box.height > 0) top = Math.min(top, box.y - lineY);
          } catch {
            /* 未挂载时量不到 */
          }
        });
      return Number.isFinite(top) ? top : decorY + metrics.voltaGap;
    };
    /** 一段小节上方记号的高度：不低于常规位置，也不压到实际音符 */
    const decorYFor = (j0, j1) => {
      let top = Infinity;
      for (let j = j0; j <= j1; j++) top = Math.min(top, measureTopY(j));
      return Math.max(decorY, Math.min(baseDecorY, top - metrics.voltaGap));
    };
    for (const ending of repeatInfo.endings) {
      let segStart = ending.start;
      for (let j = ending.start; j <= ending.end; j++) {
        const lastOfSeg =
          j === ending.end || measureLineIndex[j + 1] !== measureLineIndex[j];
        if (!lastOfSeg) continue;
        const li = measureLineIndex[j];
        const { col } = linePlacement(li);
        const lineY = bodyXY(li, 0).y;
        appendVolta(
          colGroups[col],
          measureLeftX(segStart) + inset,
          measureRightX(j) - inset,
          lineY + decorYFor(segStart, j),
          {
            label: ending.label,
            hookStart: segStart === ending.start,
            hookEnd: j === ending.end && ending.closed,
          },
          ink,
          metrics
        );
        segStart = j + 1;
      }
    }
    for (let j = 0; j < measures.length; j++) {
      const mark = repeatMarks[j];
      if (
        !mark ||
        !(mark.segno || mark.coda || mark.startTexts.length || mark.endTexts.length)
      ) {
        continue;
      }
      const li = measureLineIndex[j];
      const { col } = linePlacement(li);
      const host = colGroups[col];
      const y = bodyXY(li, 0).y + decorYFor(j, j) - (decorY - jumpBaseY);
      let x = measureLeftX(j) + 2 * metrics.s;
      const gap = 3 * metrics.s;
      if (mark.segno) x += appendSegno(host, x, y, ink, metrics) + gap;
      if (mark.coda) x += appendCoda(host, x, y, ink, metrics) + gap;
      for (const text of mark.startTexts) {
        const el = appendJumpText(host, x, y, text, "start", ink, metrics);
        x += (el.node()?.getComputedTextLength?.() || 0) + gap;
      }
      if (mark.endTexts.length) {
        appendJumpText(
          host,
          measureRightX(j),
          y,
          mark.endTexts.join("  "),
          "end",
          ink,
          metrics
        );
      }
    }
  }

  function drawSpannedLyrics(spans) {
    for (const span of spans || []) {
      const text = span[0]?.lyric;
      if (!text) continue;
      const lineIndex = span[0].lineIndex;
      if (lineIndex == null) continue;
      const onLine = span.filter(
        (col) => col.lineIndex === lineIndex && Number.isFinite(col.cx)
      );
      if (!onLine.length) continue;
      const first = onLine[0];
      const last = onLine[onLine.length - 1];
      const mid = (first.cx + last.cx) / 2;
      const pos = bodyXY(lineIndex, mid);
      const { col: lineCol } = linePlacement(lineIndex);
      const host = colGroups[lineCol];
      if (!host) continue;
      host
        .append("text")
        .attr("class", "jianpu-lyric")
        .attr("text-anchor", "middle")
        .attr("font-weight", "bold")
        .attr("font-size", metrics.bodySize)
        .attr("transform", `translate(${pos.x},${pos.y + LAYER.lyric})`)
        .text(text);
    }
  }

  // —— 列间分隔：仅画在相邻两列的间隙（最后一列右侧不加） ——
  const columnRulesG =
    columnCount > 1 ? bodyG.append("g").attr("class", "column-rules") : null;

  const bodyBox = bodyG.node().getBBox();

  if (columnRulesG) {
    for (let c = 1; c < columnCount; c++) {
      const leftLines = Math.min(
        linesPerCol,
        Math.max(0, scoreLines.length - (c - 1) * linesPerCol)
      );
      const rightLines = Math.min(
        linesPerCol,
        Math.max(0, scoreLines.length - c * linesPerCol)
      );
      const usedLines = Math.max(leftLines, rightLines, 1);
      const ruleTop = bodyBox.y + metrics.columnRulePad;
      const ruleBottom = Math.min(
        bodyBox.y + bodyBox.height - metrics.columnRulePad,
        ((usedLines - 1) * eachHeight + lyricOffset + metrics.lyricRuleExtra) *
          bodyScale
      );
      if (ruleBottom <= ruleTop) continue;

      const x = c * (columnSlotW + COLUMN_GAP) - COLUMN_GAP / 2;
      columnRulesG
        .append("line")
        .attr("class", "column-rule")
        .attr("x1", x)
        .attr("x2", x)
        .attr("y1", ruleTop)
        .attr("y2", ruleBottom)
        .attr("stroke", guide)
        .attr("stroke-width", metrics.columnRuleStroke)
        .attr("stroke-linecap", "round");
    }
  }

  const metaLeftX = bodyMetaX;
  const metaRightX = bodyMetaX + bodyMetaW;

  let titleBottom = 0;
  if (titleEl) {
    const titleBox = titleEl.node().getBBox();
    titleBottom = titleBaseline + titleBox.y + titleBox.height;
  }

  let metaBottom = hideMeta ? 0 : titleBottom;
  if (!hideMeta) {
    const metaRow = drawScoreMeta(
      g,
      meta,
      {
        left: metaLeftX,
        right: metaRightX,
        fallbackLeft: slotMetaX,
        fallbackRight: slotMetaX + slotMetaW,
        canvasWidth: width,
      },
      metrics,
      ink
    );
    const metaBox = metaRow.node().getBBox();
    const gapAfterTitle = sectionGap;
    const metaTranslateY = titleBottom + gapAfterTitle - metaBox.y;
    metaRow.attr("transform", `translate(0,${metaTranslateY})`);
    metaBottom = metaTranslateY + metaBox.y + metaBox.height;
  }

  const metaTop = hideMeta
    ? titleEl
      ? titleBottom + sectionGap
      : metrics.hideMetaTopPad
    : 0;
  const topPad = hideMeta ? metaTop : metaBottom + sectionGap;
  // 单列的 bbox 已经含第 1 列让头，再加一次才把音符留在调号区下面
  const bodyTranslateY =
    topPad -
    bodyBox.y +
    (hideMeta && columnCount <= 1 ? firstColumnHeaderH : 0);
  bodyG.attr("transform", `translate(0,${bodyTranslateY})`);
  // 首行唱名基线（供 PDF 分页）；列组 scale 后视觉行距 = eachHeight * bodyScale
  marginTop = bodyTranslateY;

  const visualEachHeight = eachHeight * bodyScale;
  const contentBottom =
    bodyTranslateY + bodyBox.y + bodyBox.height;
  const preserveCanvas = colCap != null;
  if (!preserveCanvas) {
    const fullBox = g.node().getBBox();
    const padX = 16;
    const minX = fullBox.x - padX;
    const tightW = Math.max(1, Math.ceil(fullBox.width + 2 * padX));
    g.attr("transform", `translate(${-minX},0)`);
    svg.attr("width", tightW);
  } else {
    svg.attr("width", width);
  }
  svg.attr("height", Math.max(1, Math.ceil(contentBottom + 24)));

  function pathTied(p)
  {
    if(p[1] > p[3] && p[1] - p[3] < metrics.tieSameLineSlop)
      p[3] = p[1];
    else if(p[3] > p[1] && p[3] - p[1] < metrics.tieSameLineSlop) 
      p[1] = p[3];
    var dx = p[2] - p[0];
    const curve = metrics.tieCurve;
    return `M ${p[0]} ${p[1]} C ${p[0]+dx/4} ${p[1]-curve} ${p[2]-dx/4} ${p[1]-curve} ${p[2]} ${p[1]}`;
  }

  const layout = {
    marginTop,
    eachHeight: visualEachHeight,
    lineCount: scoreLines.length,
    columns: columnCount,
    bodyScale,
    naturalColumnW,
    bodyMetaX,
    bodyMetaW,
    slotMetaX,
    slotMetaW,
    lineAscentPad,
    metaTop,
  };

  if (!options.forceLight) {
    // 拍线按时间扫描；反复时排序后相邻两段即演奏上相邻
    beatSegments.sort((a, b) => a.startSec - b.startSec);
    for (let i = 0; i < beatSegments.length - 1; i++) {
      const cur = beatSegments[i];
      const next = beatSegments[i + 1];
      if (
        cur.lineIndex === next.lineIndex &&
        cur.colIndex === next.colIndex &&
        next.measureIndex === cur.measureIndex + 1 &&
        next.x0 > cur.x0
      ) {
        cur.x1 = next.x0;
      }
    }
    setJianpuBeatSegments(svgElement, beatSegments);
    setPitchPaint({
      svg: svgElement,
      parsed: musicJson,
      maxUpper: maxUpperDots,
      maxLower: maxLowerDots,
      metrics,
      LAYER,
      ink,
      noteEls,
      meta,
      layout,
      needsFullRender: noteLayout.some((row) =>
        (row || []).some((l) => l && (l.grace || l.stackTopDy != null))
      ),
    });
  }

  return {
    ...meta,
    layout,
  };
}
