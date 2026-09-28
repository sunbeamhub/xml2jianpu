/* eslint-disable no-unused-vars */
import { select } from "d3-selection";
import { DEFAULT_SVG_WIDTH, SCORE_PAD_X } from "../utils/pageLayout.js";
import { SCORE_FONT_FAMILY } from "../utils/scoreFont.js";
import { makeScoreMetrics } from "../utils/scoreMetrics.js";
import { buildNoteOnsets } from "../utils/musicXmlSchedule.js";
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
} from "./glyphs.js";
import {
  applyColumnNaturalWidths,
  applyContentLineWidths,
  applyDualStaffLineWidths,
  assignStaffOnsets,
  buildAlignedStaffColumns,
  buildStaffNoteColumns,
  COLUMN_GAP,
  collectMeasureTimeStops,
  columnsContentWidth,
  detectStaffCount,
  groupMeasureColumnsIntoLines,
  hasMusicXmlSystemBreaks,
  makeWrapProxyColumns,
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
} from "./layout.js";
import { appendTempoNote, drawScoreMeta, extractMeta, findMeasureMetronome } from "./meta.js";
import { note2number, setPitchPaint } from "./pitch.js";

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
 * 多列时只改第 1 列让头高度，避免为调号区测高再全量重绘。
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
  const staffGap = isGrand ? metrics.staffGap : 0;
  if (isGrand) lyricOffset = staffGap + LAYER.lyric;
  var titleY = metrics.titleY;
  var titleFontSize = metrics.titleSize;
  var sectionGap = metrics.sectionGap; // 标题↔元信息、元信息↔正文（视觉等距）
  var marginTop = 110; // 首行唱名基线（正文定位后回写）
  var tiePath = [-1, -1, -1, -1]; //连音始末位置
  const tiePathByStaff = { 1: [-1, -1, -1, -1], 2: [-1, -1, -1, -1] };
  var tieStartEl = null;
  const tieStartElByStaff = { 1: null, 2: null };
  let tieSeq = 0;
  const divisions = Number(partAttr.divisions) || 1;

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
      measureColumns.push(cols);
    }
  }

  const slotW = standardSlotWidth(measureHost, metrics);
  if (isGrand) {
    for (const ml of measureLayouts) {
      for (const cols of ml.staves) {
        applyColumnNaturalWidths(cols, measureHost, metrics, slotW, divisions);
      }
      unifyDualColumnWidths(ml.staves, slotW);
      ml.bar.w = slotW;
      const sharedCols = ml.staves[0] || [];
      ml.wrapWidth = columnsContentWidth(sharedCols) + slotW;
      ml.wrapUnits = sharedCols.length + 1;
    }
  } else {
    for (const cols of measureColumns) {
      applyColumnNaturalWidths(cols, measureHost, metrics, slotW, divisions);
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
  const lineAscentPad = computeLineAscentPad(
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
  const barY = isGrand
    ? { yTop: barYUpper.yTop, yBottom: staffGap + barYLower.yBottom }
    : barYUpper;

  const hideTitle = !!options.hideTitle;
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

  for (let j = 0; j < measures.length; j++) {
    const lineIndex = measureLineIndex[j] ?? 0;
    for (const layout of noteLayout[j] || []) {
      if (layout) layout.lineIndex = lineIndex;
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
      slotW
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

  // —— 标题（屏幕模式抽到 HTML，此处跳过） ——
  let titleEl = null;
  if (!hideTitle) {
    titleEl = g
      .append("text")
      .attr("transform", `translate(${scoreCenterX},${titleY})`)
      .attr("font-weight", "bold")
      .attr("text-anchor", "middle")
      .attr("font-size", titleFontSize)
      .text(meta.title);
  }

  // 多列：第 1 列给 HTML 调号区让高，第 2 列起与调号区顶对齐
  const firstColumnHeaderH =
    columnCount > 1
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

  const onsetByKey = new Map();
  for (const slot of buildNoteOnsets(measures)) {
    onsetByKey.set(`${slot.measureIndex}-${slot.noteIndex}`, slot.time);
  }

  const noteEls = [];
  for (var j = 0; j < measures.length; j++) {
    const lineIndex = measureLineIndex[j];
    const { col: lineCol } = linePlacement(lineIndex);
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
        const time = onsetByKey.get(`${j}-${i}`);
        return time == null ? null : time.toFixed(4);
      })
      .each(function (d, i) {
        const layout = noteLayout[j][i];
        if (!layout) return;
        const number = layout.noteCol.number;
        const pos = bodyXY(lineIndex, layout.cx);
        const cx = pos.x;
        const staffN = staffNumberOf(d);
        const cy = pos.y + (isGrand ? (staffN - 1) * staffGap : 0);
        const underlineN = underlineCount(d, number.dur, divisions);
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
        if (lyric && (!isGrand || staffN === 1)) {
          d3.select(this)
            .append("text")
            .attr("class", "jianpu-lyric")
            .attr("text-anchor", "middle")
            .attr("font-weight", "bold")
            .attr("font-size", metrics.bodySize)
            .attr("transform", `translate(${cx},${cy + LAYER.lyric})`)
            .text(lyric);
        }

        if (number.dur > divisions) {
          const isRestExtend = number.text === "0";
          for (let k = 0; k < layout.extendCxs.length; k++) {
            const exX = bodyXY(lineIndex, layout.extendCxs[k]).x;
            if (isRestExtend) {
              d3.select(this)
                .append("text")
                .attr("transform", `translate(${exX},${cy + LAYER.note})`)
                .attr("font-weight", "normal")
                .attr("font-size", metrics.bodySize)
                .attr("text-anchor", "middle")
                .text("0");
              continue;
            }
            const slot = Number(layout.extendCols[k]?.w) || metrics.layoutMinGap;
            const half = (slot * metrics.extendDashRatio) / 2;
            const y = cy + LAYER.note - metrics.extendDashY;
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

        if (number.tied) {
          const tp = isGrand ? tiePathByStaff[staffN] || tiePathByStaff[1] : tiePath;
          const tieSlot = isGrand ? staffN : 0;
          if (tp[0] == -1) {
            tp[0] = cx;
            tp[1] = cy + LAYER.tie;
            if (tieSlot) tieStartElByStaff[tieSlot] = this;
            else tieStartEl = this;
          } else if (tp[2] == -1) {
            tp[2] = cx;
            tp[3] = cy + LAYER.tie;
            const startEl = tieSlot ? tieStartElByStaff[tieSlot] : tieStartEl;
            if (startEl && startEl !== this) {
              const tieId = `t${++tieSeq}`;
              startEl.setAttribute("data-tie", tieId);
              this.setAttribute("data-tie", tieId);
            }
            if (tieSlot) tieStartElByStaff[tieSlot] = null;
            else tieStartEl = null;
            if (Math.abs(tp[3] - tp[1]) < metrics.tieSameLineSlop) {
              d3.select(this)
                .append("path")
                .attr("fill", "none")
                .attr("stroke", ink)
                .attr("stroke-width", metrics.tieStroke)
                .attr("d", pathTied(tp));
              tp[0] = -1;
              tp[2] = -1;
            } else {
              const path1 = [
                tp[0],
                tp[1],
                tp[0] + metrics.tieHookPx,
                tp[1],
              ];
              const path2 = [
                tp[2] - metrics.tieHookPx,
                tp[3],
                tp[2],
                tp[3],
              ];
              d3.select(this)
                .append("path")
                .attr("fill", "none")
                .attr("stroke", ink)
                .attr("stroke-width", metrics.tieStroke)
                .attr("d", pathTied(path1));
              d3.select(this)
                .append("path")
                .attr("fill", "none")
                .attr("stroke", ink)
                .attr("stroke-width", metrics.tieStroke)
                .attr("d", pathTied(path2));
              tp[0] = -1;
              tp[2] = -1;
            }
          }
        }

        if (
          number.dur == divisions / 3 ||
          number.dur == divisions * 2 / 3
        ) {
          const prevI = sameStaffNeighborIndex(notes, i, -1);
          const nextI = sameStaffNeighborIndex(notes, i, 1);
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
              .attr("transform", `translate(${cx},${cy})`)
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
              .attr("transform", `translate(${cx},${cy})`)
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
      const origIdxs = isGrand ? staffNoteIndices(notes, staffN) : notes.map((_, i) => i);
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

    // 小节竖线：取该小节 bar 列中心；全曲末为终止线
    const barCol = isGrand
      ? measureLayouts[j]?.bar
      : scoreLines[lineIndex].columns.find(
          (c) => c.kind === "bar" && c.measureIdx === j
        );
    if (barCol) {
      const barPos = bodyXY(lineIndex, barCol.cx);
      appendJianpuBarline(
        colGroups[lineCol],
        barPos.x,
        barPos.y,
        barCol.style || "regular",
        ink,
        barY.yTop,
        barY.yBottom,
        metrics
      );
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
    titleBottom = titleY + titleBox.y + titleBox.height;
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
    const gapAfterTitle = hideTitle ? metrics.metaHideTitleGap : sectionGap;
    const metaTranslateY = titleBottom + gapAfterTitle - metaBox.y;
    metaRow.attr("transform", `translate(0,${metaTranslateY})`);
    metaBottom = metaTranslateY + metaBox.y + metaBox.height;
  }

  const topPad = hideMeta ? metrics.hideMetaTopPad : metaBottom + sectionGap;
  const bodyTranslateY = topPad - bodyBox.y;
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
    bodyMetaX,
    bodyMetaW,
    slotMetaX,
    slotMetaW,
    lineAscentPad,
  };

  if (!options.forceLight) {
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
    });
  }

  return {
    ...meta,
    layout,
  };
}
