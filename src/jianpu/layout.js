import { READABLE_LINE_UNITS, makeScoreMetrics } from "../utils/scoreMetrics.js";
import { asArray } from "./parse.js";
import { note2number } from "./pitch.js";
import {
  augmentationPadRight,
  measureTextWidth,
  pianoBraceGeom,
  primaryLyricText,
  shownAugmentationDotCount,
} from "./glyphs.js";

/** 无纸张列槽时的左右边距回退 */
export const SCORE_SIDE_PAD = 32;
const LINE_BREAK_FIXED_MIN = 2;
const LINE_BREAK_FIXED_MAX = 6;

function isMusicXmlLineBreak(measure) {
  const prints = asArray(measure?.print);
  return prints.some(
    (p) =>
      p &&
      (p["@_new-system"] === "yes" || p["@_new-page"] === "yes")
  );
}

export function hasMusicXmlSystemBreaks(measures) {
  return measures.some(isMusicXmlLineBreak);
}

/**
 * @param {unknown} raw
 * @returns {'auto' | 'musicxml' | number}
 */
export function parseLineBreakOption(raw) {
  if (raw == null || raw === "") return "auto";
  const s = String(raw).trim().toLowerCase();
  if (s === "auto") return "auto";
  if (s === "musicxml") return "musicxml";
  const n = Number(s);
  if (
    Number.isInteger(n) &&
    n >= LINE_BREAK_FIXED_MIN &&
    n <= LINE_BREAK_FIXED_MAX
  ) {
    return n;
  }
  return "auto";
}


/** 小节自然宽：各列宽之和（含小节线/终止符） */
function naturalMeasureWidth(segment) {
  let content = 0;
  for (const col of segment) {
    content += Number(col.w) || 0;
  }
  return content;
}

/** 唱名/休止/延音占位/小节线各计 1；歌词附着在音符列上不另计 */
function countLineUnits(cols) {
  let n = 0;
  for (const col of cols) {
    if (col.kind === "note" || col.kind === "extend" || col.kind === "bar") {
      n += 1;
    }
  }
  return n;
}

function naturalMeasureUnits(segment) {
  return countLineUnits(segment);
}

export function staffNumberOf(note) {
  const s = Number(note?.staff);
  return Number.isFinite(s) && s >= 1 ? Math.trunc(s) : 1;
}

export function detectStaffCount(measures, partAttr) {
  let maxS = Number(partAttr?.staves) || 1;
  for (const measure of measures || []) {
    const attrS = Number(measure?.attributes?.staves);
    if (Number.isFinite(attrS) && attrS > maxS) maxS = attrS;
    for (const note of asArray(measure?.note)) {
      maxS = Math.max(maxS, staffNumberOf(note));
    }
  }
  if (!Number.isFinite(maxS) || maxS < 1) return 1;
  return Math.min(2, Math.trunc(maxS));
}

function isChordNote(note) {
  return note != null && note.chord != null && note.chord !== false;
}

/** 按声部顺序累加 duration；和弦不推进光标 */
export function assignStaffOnsets(entries) {
  let cursor = 0;
  let lastOnset = 0;
  for (const entry of entries || []) {
    if (isChordNote(entry.d)) {
      entry.onset = lastOnset;
    } else {
      entry.onset = cursor;
      lastOnset = cursor;
      cursor += Number(entry.d?.duration) || 0;
    }
  }
}

/** 大于四分：二分 1 条、附点二分 2 条、全音符 3 条 */
function extendDashCount(dur, divisions) {
  const div = Number(divisions) || 0;
  const d = Number(dur) || 0;
  if (!(d > div) || !(div > 0)) return 0;
  return Math.max(0, Math.floor(d / div) - 1);
}

export function collectMeasureTimeStops(staffEntries) {
  const times = new Set();
  for (const entries of staffEntries || []) {
    for (const entry of entries || []) {
      times.add(entry.onset);
    }
  }
  return [...times].sort((a, b) => a - b);
}

function firstAttackAtOnset(entries) {
  const attackAt = new Map();
  for (const entry of entries || []) {
    if (isChordNote(entry.d)) continue;
    if (!attackAt.has(entry.onset)) attackAt.set(entry.onset, entry);
  }
  return attackAt;
}

/** 走完 onset 格后仍未写下的延音横条数 */
function leftoverExtendSlots(entries, timeStops, divisions) {
  const attackAt = firstAttackAtOnset(entries);
  let pending = 0;
  for (const t of timeStops) {
    const attack = attackAt.get(t);
    if (attack) {
      pending = extendDashCount(Number(attack.d?.duration) || 0, divisions);
    } else if (pending > 0) {
      pending -= 1;
    }
  }
  return pending;
}

export function padTimeStopsForExtends(staffEntries, timeStops, divisions) {
  let extra = 0;
  for (const entries of staffEntries || []) {
    extra = Math.max(
      extra,
      leftoverExtendSlots(entries, timeStops, divisions)
    );
  }
  if (extra <= 0) return timeStops;
  const last = timeStops.length ? timeStops[timeStops.length - 1] : 0;
  const padded = timeStops.slice();
  for (let i = 1; i <= extra; i++) padded.push(last + i);
  return padded;
}

export function columnsContentWidth(cols) {
  let w = 0;
  for (const col of cols || []) w += Number(col.w) || 0;
  return w;
}

export function unifyDualColumnWidths(staves, slotW) {
  const n = Math.max(0, ...staves.map((cols) => (cols || []).length));
  const minW = Number(slotW) || 0;
  for (let i = 0; i < n; i++) {
    let w = minW;
    for (const cols of staves) {
      w = Math.max(w, Number(cols[i]?.w) || 0);
    }
    for (const cols of staves) {
      if (cols[i]) cols[i].w = w;
    }
  }
}

function placeColumnsFromX(cols, startX) {
  let x = startX;
  for (const col of cols || []) {
    const w = Number(col.w) || 0;
    if (col.kind === "spacer") {
      x += w;
      continue;
    }
    if (col.kind !== "note" && col.kind !== "extend" && col.kind !== "bar") {
      continue;
    }
    const padR = Number(col.augPadRight) || 0;
    col.cx = x + (w - padR) / 2;
    x += w;
  }
  return x;
}

export function applyColumnNaturalWidths(cols, measureHost, metrics, slotW, divisions) {
  for (const col of cols || []) {
    if (col.kind === "spacer") {
      col.w = 0;
      continue;
    }
    if (col.kind === "bar" || col.kind === "extend") {
      col.w = slotW;
      continue;
    }
    const noteLabel =
      col.number.text.length > 1
        ? col.number.text.replace(/^#/, "")
        : col.number.text;
    const noteW =
      measureTextWidth(measureHost, noteLabel, {
        fontSize: metrics.bodySize,
      }) + metrics.sharpExtraW;
    const lyricW = measureTextWidth(measureHost, col.lyric, {
      fontSize: metrics.bodySize,
      fontWeight: "bold",
    });
    const augCount = shownAugmentationDotCount(
      col.note,
      col.number?.dur,
      divisions
    );
    const augPad = augmentationPadRight(augCount, metrics);
    col.augPadRight = augPad;
    col.w = Math.max(slotW, noteW + augPad, lyricW + metrics.layoutLyricPad);
  }
}

export function buildStaffNoteColumns(
  notes,
  measureIdx,
  partAttr,
  options,
  divisions,
  noteLayoutRow
) {
  const cols = [];
  for (const { d, i } of notes) {
    const number = note2number(d, partAttr, options);
    const lyric = primaryLyricText(d);
    const noteCol = {
      kind: "note",
      note: d,
      number,
      lyric,
      measureIdx,
      noteIdx: i,
    };
    cols.push(noteCol);
    const extendCols = [];
    const dur = number.dur || 0;
    if (dur > divisions) {
      const addNote = Math.floor(dur / divisions);
      for (let k = 1; k < addNote; k++) {
        const ext = {
          kind: "extend",
          text: number.text === "0" ? "0" : "-",
          number,
          measureIdx,
          noteIdx: i,
        };
        cols.push(ext);
        extendCols.push(ext);
      }
    }
    noteLayoutRow[i] = {
      lineIndex: 0,
      noteCol,
      extendCols,
      cx: 0,
      extendCxs: [],
      staff: staffNumberOf(d),
    };
  }
  return cols;
}

/**
 * 连谱：按共享时间格生成列。同一 onset 上下对齐；
 * 延音横紧跟唱名占后续格，不按整拍拆开。
 */
export function buildAlignedStaffColumns(
  entries,
  timeStops,
  measureIdx,
  partAttr,
  options,
  divisions,
  noteLayoutRow
) {
  const attackAt = new Map();
  const extraAt = new Map();
  for (const entry of entries || []) {
    const t = entry.onset;
    if (isChordNote(entry.d)) {
      if (!extraAt.has(t)) extraAt.set(t, []);
      extraAt.get(t).push(entry);
      continue;
    }
    if (!attackAt.has(t)) attackAt.set(t, entry);
    else {
      if (!extraAt.has(t)) extraAt.set(t, []);
      extraAt.get(t).push(entry);
    }
  }

  const cols = [];
  let pending = 0;
  let pendingEntry = null;
  for (const t of timeStops) {
    const attack = attackAt.get(t);
    if (attack) {
      const number = note2number(attack.d, partAttr, options);
      const noteCol = {
        kind: "note",
        note: attack.d,
        number,
        lyric: primaryLyricText(attack.d),
        measureIdx,
        noteIdx: attack.i,
        onset: t,
      };
      cols.push(noteCol);
      const extendCols = [];
      noteLayoutRow[attack.i] = {
        lineIndex: 0,
        noteCol,
        extendCols,
        cx: 0,
        extendCxs: [],
        staff: staffNumberOf(attack.d),
      };
      for (const extra of extraAt.get(t) || []) {
        const extraNumber = note2number(extra.d, partAttr, options);
        noteLayoutRow[extra.i] = {
          lineIndex: 0,
          noteCol: {
            kind: "note",
            note: extra.d,
            number: extraNumber,
            lyric: primaryLyricText(extra.d),
            measureIdx,
            noteIdx: extra.i,
          },
          slotCol: noteCol,
          extendCols: [],
          cx: 0,
          extendCxs: [],
          staff: staffNumberOf(extra.d),
        };
      }
      pending = extendDashCount(Number(attack.d?.duration) || 0, divisions);
      pendingEntry = attack;
      continue;
    }
    if (pending > 0 && pendingEntry) {
      const number = note2number(pendingEntry.d, partAttr, options);
      const ext = {
        kind: "extend",
        text: number.text === "0" ? "0" : "-",
        number,
        measureIdx,
        noteIdx: pendingEntry.i,
        onset: t,
      };
      cols.push(ext);
      const host = noteLayoutRow[pendingEntry.i];
      if (host) host.extendCols.push(ext);
      pending -= 1;
      continue;
    }
    cols.push({ kind: "spacer", measureIdx, onset: t, w: 0 });
  }
  return cols;
}

export function makeWrapProxyColumns(ml) {
  const units = Math.max(1, Number(ml.wrapUnits) || 1);
  const unitW = (Number(ml.wrapWidth) || 0) / units;
  const cols = [];
  for (let u = 0; u < units; u++) {
    cols.push({
      kind: u === units - 1 ? "bar" : "note",
      w: unitW,
      measureIdx: ml.measureIdx,
    });
  }
  return cols;
}

export function applyDualStaffLineWidths(
  measureLayouts,
  measureLineIndex,
  measureCount,
  metrics,
  slotW
) {
  const nLines = Math.max(0, ...measureLineIndex, -1) + 1;
  const lines = Array.from({ length: nLines }, () => ({
    measureIdxs: [],
    width: 0,
    leftBarX: 0,
  }));
  for (let j = 0; j < measureCount; j++) {
    const li = measureLineIndex[j] ?? 0;
    if (lines[li]) lines[li].measureIdxs.push(j);
  }
  // 左缘预留：花括号宽度 + 与竖线间距
  const braceGeom = pianoBraceGeom(metrics);
  const bracePad = Math.max(
    Number(metrics.bracePad) || 16,
    braceGeom.depth + braceGeom.gap + braceGeom.stroke / 2 + 4
  );
  let maxWidth = bracePad;
  for (const line of lines) {
    let x = bracePad;
    const leftBarW = slotW;
    line.leftBarX = x + leftBarW / 2;
    x += leftBarW;
    for (const j of line.measureIdxs) {
      const ml = measureLayouts[j];
      const contentW = Math.max(0, ...ml.staves.map(columnsContentWidth));
      for (const cols of ml.staves) {
        placeColumnsFromX(cols, x);
      }
      const barW = Number(ml.bar.w) || slotW;
      ml.bar.w = barW;
      ml.bar.cx = x + contentW + barW / 2;
      x += contentW + barW;
    }
    line.width = x;
    maxWidth = Math.max(maxWidth, x);
  }
  return { dualLines: lines, maxWidth };
}

export function staffNoteIndices(notes, staffNum) {
  const idxs = [];
  for (let i = 0; i < notes.length; i++) {
    if (staffNumberOf(notes[i]) === staffNum) idxs.push(i);
  }
  return idxs;
}

export function sameStaffNeighborIndex(notes, i, delta) {
  const staff = staffNumberOf(notes[i]);
  let k = i + delta;
  while (k >= 0 && k < notes.length) {
    if (staffNumberOf(notes[k]) === staff) return k;
    k += delta;
  }
  return -1;
}

/** 已量列宽的平均格宽；无列时回退 slotW */
function typicalUnitWidth(measureColumns, fallback = 1) {
  let w = 0;
  let n = 0;
  for (const seg of measureColumns) {
    for (const col of seg) {
      if (col.kind === "note" || col.kind === "extend" || col.kind === "bar") {
        w += Number(col.w) || 0;
        n += 1;
      }
    }
  }
  if (n <= 0) return Math.max(1e-6, Number(fallback) || 1);
  return Math.max(1e-6, w / n);
}

function unitsFitIn(innerPx, typicalW) {
  return Math.max(1, Math.floor(Number(innerPx) / typicalW));
}

function clampLineUnits(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
}

/**
 * 按换行模式把各小节列拼成行。
 * auto：按小节自然宽贪心装行；若给出 maxUnits 则同时受符号数上限。
 * 可读路径传入无限 innerW，只按 maxUnits 断行。
 * @param {'auto' | 'musicxml' | number} mode
 * @param {number} [maxUnits]
 */
export function groupMeasureColumnsIntoLines(
  measureColumns,
  measures,
  mode,
  innerW,
  maxUnits
) {
  const scoreLines = [];
  let lineCols = [];
  const measureLineIndex = [];

  function flushLine() {
    if (!lineCols.length) return;
    scoreLines.push({ columns: lineCols });
    lineCols = [];
  }

  const cap = Math.max(1, Number(innerW) || 1);
  const unitCap =
    maxUnits != null && Number(maxUnits) > 0 ? Number(maxUnits) : Infinity;
  const perLine = typeof mode === "number" ? Math.max(1, mode) : null;
  let lineW = 0;
  let lineUnits = 0;

  for (let j = 0; j < measureColumns.length; j++) {
    let shouldBreak = false;
    if (mode === "musicxml") {
      shouldBreak = isMusicXmlLineBreak(measures[j]);
    } else if (perLine != null) {
      shouldBreak = j > 0 && j % perLine === 0;
    } else {
      const mw = naturalMeasureWidth(measureColumns[j]);
      const mu = naturalMeasureUnits(measureColumns[j]);
      shouldBreak =
        lineCols.length > 0 &&
        (lineW + mw > cap || lineUnits + mu > unitCap);
      if (shouldBreak) {
        flushLine();
        lineW = 0;
        lineUnits = 0;
      }
      measureLineIndex[j] = scoreLines.length;
      for (const col of measureColumns[j]) lineCols.push(col);
      lineW += mw;
      lineUnits += mu;
      continue;
    }
    if (shouldBreak) flushLine();
    measureLineIndex[j] = scoreLines.length;
    for (const col of measureColumns[j]) lineCols.push(col);
  }
  flushLine();
  return { scoreLines, measureLineIndex };
}

/** 按小节线把一行 columns 切成若干段（每段以 bar 结尾） */
function segmentLineByBars(columns) {
  const segments = [];
  let cur = [];
  for (const col of columns) {
    cur.push(col);
    if (col.kind === "bar") {
      segments.push(cur);
      cur = [];
    }
  }
  if (cur.length) segments.push(cur);
  return segments;
}

/**
 * 按内容自然宽从左排，不拉伸。换行方式只决定断在哪，不改变间距。
 * @returns {number} 各行宽度的 max
 */
export function applyContentLineWidths(scoreLines, minGap) {
  const gap = minGap || 18;
  let maxLineW = gap;

  for (const line of scoreLines) {
    line.segments = segmentLineByBars(line.columns);
    let x = 0;
    for (const col of line.columns) {
      if (col.kind !== "note" && col.kind !== "extend" && col.kind !== "bar") {
        continue;
      }
      const w = Number(col.w) || gap;
      const padR = Number(col.augPadRight) || 0;
      col.w = w;
      col.cx = x + (w - padR) / 2;
      x += w;
    }
    line.width = Math.max(gap, x);
    maxLineW = Math.max(maxLineW, line.width);
  }

  return maxLineW;
}

/** 容器/视口可用宽度；导出请传 options.width */
function getViewportWidth(svgElement) {
  return (
    svgElement?.parentElement?.clientWidth ||
    window.innerWidth ||
    document.documentElement.clientWidth ||
    document.body.clientWidth ||
    0
  );
}

/**
 * 排版宽度：固定导出宽，或 max(视口, 曲谱正文所需最小宽)。
 * @param {number} contentMinWidth 正文总宽 + 边距
 */
export function resolveScoreWidth(svgElement, options = {}, contentMinWidth = 0) {
  if (options.width) return options.width;
  const viewportW = getViewportWidth(svgElement);
  return Math.max(viewportW, contentMinWidth, 1);
}

/** 多列之间的水平间距（px）；含分隔符留白 */
export const COLUMN_GAP = 56;
/** 自动分栏上限 */
const MAX_AUTO_COLUMNS = 4;
/** 可读路径只按符号数断行，像素上限不参与 */
const UNITS_ONLY_INNER_W = Number.POSITIVE_INFINITY;

function splitColumnInner(availW, n, fitPad) {
  const rawSlot = Math.floor(
    (Math.max(1, Number(availW) || 1) - 32 - (n - 1) * COLUMN_GAP) / n
  );
  return Math.max(1, rawSlot - 2 * fitPad);
}

/**
 * 报刊式分栏数：优先 options.columns；autoColumns 时按视口尽量塞进一屏。
 * 仅在「不缩小也能并排装下」时增加列数（fitScale 仍可由 Vue 做宽度适配，但不为分栏而主动缩小）。
 * @param {{ columns?: number, autoColumns?: boolean, viewportWidth?: number, viewportHeight?: number, hideMeta?: boolean }} options
 * @param {number} lineCount
 * @param {number} columnInnerW 单列槽宽（纸张列槽）
 * @param {number} eachHeight 行高
 * @param {SVGSVGElement} svgElement
 */
export function resolveColumnCount(
  options,
  lineCount,
  columnInnerW,
  eachHeight,
  svgElement
) {
  if (options.columns != null && options.columns !== "") {
    return Math.max(1, Math.floor(Number(options.columns)) || 1);
  }
  if (!options.autoColumns) return 1;

  const availW =
    Number(options.viewportWidth) ||
    getViewportWidth(svgElement) ||
    window.innerWidth ||
    1;
  const availH =
    Number(options.viewportHeight) ||
    window.innerHeight ||
    document.documentElement.clientHeight ||
    800;
  // 标题底边锚点加与调号区的间距，随正文字号缩放
  const titleMetrics = makeScoreMetrics(options.fontSize);
  const titleBlock = titleMetrics.titleY + titleMetrics.sectionGap;
  // hideMeta 时调号区在 HTML，画布再留一截顶边，并加上标题高度
  const headerReserve = options.hideMeta ? 48 + titleBlock : 140;
  const usableH = Math.max(eachHeight, availH - headerReserve);
  const maxLinesFit = Math.max(1, Math.floor(usableH / eachHeight));
  const needByHeight = Math.max(
    1,
    Math.ceil(Math.max(1, lineCount) / maxLinesFit)
  );
  // 不缩小：列宽合计必须 ≤ 可用宽度
  const unit = columnInnerW + COLUMN_GAP;
  const maxByWidth = Math.max(
    1,
    Math.floor((availW - 32) / Math.max(1, unit))
  );
  return Math.min(needByHeight, maxByWidth, MAX_AUTO_COLUMNS);
}

/**
 * 设备+自动：按列容量把 maxUnits 夹进单栏 45–75 / 多栏 40–50，只按符号数断行。
 * @returns {{ scoreLines: object[], measureLineIndex: number[], columnCount: number, columnSlotW: number }}
 */
export function packReadableLineLayout(
  measureColumns,
  measures,
  options,
  availSlotW,
  fitPad,
  _eachHeight,
  slotW,
  svgElement
) {
  const { single, multi } = READABLE_LINE_UNITS;
  const availInner = Math.max(1, Number(availSlotW) - 2 * fitPad);
  const availW =
    Number(options.viewportWidth) ||
    Number(availSlotW) ||
    getViewportWidth(svgElement) ||
    window.innerWidth ||
    1;
  const typicalW = typicalUnitWidth(measureColumns, slotW);

  function packByUnits(maxUnits) {
    return groupMeasureColumnsIntoLines(
      measureColumns,
      measures,
      "auto",
      UNITS_ONLY_INNER_W,
      maxUnits
    );
  }

  function slotWidthFor(maxUnits, maxInnerPx) {
    const byUnits = maxUnits * typicalW + 2 * fitPad;
    const bySplit = maxInnerPx + 2 * fitPad;
    return Math.max(1, Math.min(byUnits, bySplit));
  }

  function tryMulti(n) {
    if (n < 2) return null;
    const colInner = splitColumnInner(availW, n, fitPad);
    const cap = unitsFitIn(colInner, typicalW);
    if (cap < multi.min) return null;
    return {
      n,
      maxUnits: clampLineUnits(cap, multi.min, multi.max),
      colInner,
    };
  }

  let choice = null;
  const forcedCols =
    options.columns != null && options.columns !== ""
      ? Math.max(1, Math.floor(Number(options.columns)) || 1)
      : null;

  if (forcedCols != null) {
    if (forcedCols >= 2) choice = tryMulti(forcedCols);
  } else if (options.autoColumns) {
    for (let n = MAX_AUTO_COLUMNS; n >= 2; n--) {
      choice = tryMulti(n);
      if (choice) break;
    }
  }

  if (choice) {
    const packed = packByUnits(choice.maxUnits);
    return {
      scoreLines: packed.scoreLines,
      measureLineIndex: packed.measureLineIndex,
      columnCount: choice.n,
      columnSlotW: slotWidthFor(choice.maxUnits, choice.colInner),
    };
  }

  const cap = unitsFitIn(availInner, typicalW);
  const maxUnits =
    cap < single.min
      ? Math.max(1, cap)
      : clampLineUnits(cap, single.min, single.max);
  const packed = packByUnits(maxUnits);
  return {
    scoreLines: packed.scoreLines,
    measureLineIndex: packed.measureLineIndex,
    columnCount: 1,
    columnSlotW: slotWidthFor(maxUnits, availInner),
  };
}
