/* eslint-disable no-unused-vars */
import { xml } from "d3-fetch";
import { select } from "d3-selection";
import { XMLParser } from "fast-xml-parser";
import { DEFAULT_SVG_WIDTH, SCORE_PAD_X } from "../utils/pageLayout.js";
import { SCORE_FONT_FAMILY } from "../utils/scoreFont.js";
import { makeScoreMetrics, READABLE_LINE_UNITS } from "../utils/scoreMetrics.js";

const d3 = { select, xml };

/** 无纸张列槽时的左右边距回退 */
const SCORE_SIDE_PAD = 32;
const LINE_BREAK_FIXED_MIN = 2;
const LINE_BREAK_FIXED_MAX = 6;

function themeColor(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function scoreInk() {
  return themeColor("--color-text-primary", "#1C1C1E");
}

function scoreError() {
  return themeColor("--color-error", "#b00020");
}

function scoreGuide() {
  return themeColor("--color-border", "#d0d0d0");
}

function isLink(str) {
  if (typeof str !== "string" || !str) return false;
  const s = str.trim();
  // XML 字符串以 < 或 <?xml 开头；其余视为可 fetch 的 URL（含 webpack 相对路径）
  if (s.startsWith("<") || s.startsWith("<?")) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return (
      s.startsWith("/") ||
      s.startsWith("./") ||
      s.startsWith("../") ||
      /^[a-z][a-z0-9+.-]*:/i.test(s)
    );
  }
}

function asArray(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  if (typeof node === "object" && node["#text"] != null) return String(node["#text"]).trim();
  return "";
}

function isPlaceholder(text) {
  return !text || /^(title|composer|lyricist|composer\.?|unknown)$/i.test(text);
}

function mergeAttributes(prev, next) {
  const src = Array.isArray(next) ? next[0] : next;
  if (!src) return prev;
  return {
    ...(prev || {}),
    ...src,
    key: src.key != null ? src.key : prev?.key,
    time: src.time != null ? src.time : prev?.time,
    divisions: src.divisions != null ? src.divisions : prev?.divisions,
    clef: src.clef != null ? src.clef : prev?.clef,
  };
}

function normalizeScore(musicJson) {
  const score = musicJson?.["score-partwise"];
  if (!score) {
    throw new Error("不是 score-partwise 格式的 MusicXML，或文件不完整");
  }
  const part = asArray(score.part)[0];
  if (!part) {
    throw new Error("MusicXML 中没有 part");
  }
  const measures = asArray(part.measure);
  if (!measures.length) {
    throw new Error("MusicXML 中没有小节");
  }

  let lastAttr = null;
  for (const measure of measures) {
    if (measure.attributes) {
      lastAttr = mergeAttributes(lastAttr, measure.attributes);
      measure.attributes = lastAttr;
    } else if (lastAttr) {
      measure.attributes = lastAttr;
    }
    measure.note = asArray(measure.note);
  }

  return {
    score,
    measures,
    partAttr: measures[0].attributes,
  };
}

function isMusicXmlLineBreak(measure) {
  const prints = asArray(measure?.print);
  return prints.some(
    (p) =>
      p &&
      (p["@_new-system"] === "yes" || p["@_new-page"] === "yes")
  );
}

function hasMusicXmlSystemBreaks(measures) {
  return measures.some(isMusicXmlLineBreak);
}

/**
 * @param {unknown} raw
 * @returns {'auto' | 'musicxml' | number}
 */
function parseLineBreakOption(raw) {
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
function groupMeasureColumnsIntoLines(
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


function noteTypeUnderlineCount(note) {
  const type = textOf(note?.type).toLowerCase();
  switch (type) {
    case "eighth":
      return 1;
    case "16th":
      return 2;
    case "32nd":
      return 3;
    case "64th":
      return 4;
    case "128th":
      return 5;
    default:
      return 0;
  }
}

function durationUnderlineCount(dur, divisions) {
  const div = Math.max(1, Number(divisions) || 1);
  const d = Number(dur) || 0;
  if (d <= 0 || d >= div) return 0;
  if (d >= div / 2) return 1;
  if (d >= div / 4) return 2;
  if (d >= div / 8) return 3;
  if (d >= div / 16) return 4;
  return 5;
}

function underlineCount(note, dur, divisions) {
  const fromType = noteTypeUnderlineCount(note);
  if (fromType > 0) return fromType;
  return durationUnderlineCount(dur, divisions);
}

/** 简谱按拍分组：4/4 等以拍号单位为一拍；6/8、9/8、12/8 以附点四分（三个八分）为一拍 */
function primaryBeatDuration(divisions, partAttr) {
  const div = Math.max(1, Number(divisions) || 1);
  const beats = Math.max(1, Number(partAttr?.time?.beats) || 4);
  const beatType = Math.max(1, Number(partAttr?.time?.["beat-type"]) || 4);
  const unit = div * (4 / beatType);
  if (beatType === 8 && beats % 3 === 0) return unit * 3;
  return unit;
}

function underlineLayerY(level, LAYER, step) {
  if (level <= 1) return LAYER.underline1;
  if (level === 2) return LAYER.underline2;
  return LAYER.underline2 + (level - 2) * step;
}

/**
 * 同一拍内、达到该层下划线的连续音符/休止符分成一组。
 * @returns {number[][][]} groups[level-1] = [[noteIdx, ...], ...]
 */
function groupUnderlineBeams(notes, durs, beatDur, divisions) {
  const n = notes.length;
  const onsets = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    onsets.push(t);
    t += Number(durs[i]) || 0;
  }
  const counts = notes.map((note, i) => underlineCount(note, durs[i], divisions));
  const maxLevel = counts.reduce((m, c) => Math.max(m, c), 0);
  const groups = [];
  const beat = Math.max(1e-9, Number(beatDur) || 1);
  for (let level = 1; level <= maxLevel; level++) {
    const levelGroups = [];
    let cur = [];
    let curBeat = -1;
    for (let i = 0; i < n; i++) {
      const beatIdx = Math.floor((onsets[i] + 1e-9) / beat);
      if (counts[i] >= level && beatIdx === curBeat) {
        cur.push(i);
      } else {
        if (cur.length) levelGroups.push(cur);
        if (counts[i] >= level) {
          cur = [i];
          curBeat = beatIdx;
        } else {
          cur = [];
          curBeat = -1;
        }
      }
    }
    if (cur.length) levelGroups.push(cur);
    groups.push(levelGroups);
  }
  return groups;
}

/** 取第 1 段歌词文本 */
function primaryLyricText(note) {
  if (note?.lyric == null) return "";
  const lyrics = asArray(note.lyric);
  const primary =
    lyrics.find((item) => String(item["@_number"] ?? item.number ?? "1") === "1") ||
    lyrics[0];
  return textOf(primary?.text) || textOf(primary) || "";
}

/** 用临时 SVG text 测量宽度 */
function measureTextWidth(host, text, attrs = {}) {
  if (!text) return 0;
  const t = host.append("text").attr("visibility", "hidden");
  if (attrs.fontSize != null) t.attr("font-size", attrs.fontSize);
  if (attrs.fontWeight != null) t.attr("font-weight", attrs.fontWeight);
  t.text(String(text));
  const w = t.node()?.getComputedTextLength?.() || String(text).length * 8;
  t.remove();
  return w;
}

/** 中文单字标准槽宽：小节线/终止符/延音/默认四分音符共用，不扫描全曲歌词 */
function standardSlotWidth(host, metrics) {
  const noteW = measureTextWidth(host, "5", { fontSize: metrics.bodySize });
  const lyricW = measureTextWidth(host, "字", {
    fontSize: metrics.bodySize,
    fontWeight: "bold",
  });
  return Math.max(
    metrics.layoutMinGap,
    noteW,
    lyricW + metrics.layoutLyricPad
  );
}

/** MusicXML 右侧小节线样式；全曲最后一小节默认终止线（light-heavy） */
function rightBarStyle(measure, isLastMeasure) {
  if (isLastMeasure) return "light-heavy";
  const barlines = asArray(measure?.barline);
  let style = "";
  for (const bl of barlines) {
    if (!bl) continue;
    if (bl["@_location"] === "left") continue;
    const s = textOf(bl["bar-style"]);
    if (s) style = s;
  }
  return style || "regular";
}

/**
 * 简谱小节线：普通为单竖线；终止线为细+粗（light-heavy）。
 * y 为唱名基线；yTop / yBottom 为相对基线的上下沿（由全曲音高决定）。
 */
function appendJianpuBarline(parent, x, y, style, ink, yTop, yBottom, metrics) {
  const y1 = y + yTop;
  const y2 = y + yBottom;
  if (style === "light-heavy") {
    parent
      .append("line")
      .attr("class", "barline barline-final")
      .attr("x1", x - metrics.barlineFinalOffsetL)
      .attr("x2", x - metrics.barlineFinalOffsetL)
      .attr("y1", y1)
      .attr("y2", y2)
      .attr("stroke", ink)
      .attr("stroke-width", metrics.barlineFinalThin);
    parent
      .append("line")
      .attr("class", "barline barline-final")
      .attr("x1", x + metrics.barlineFinalOffsetR)
      .attr("x2", x + metrics.barlineFinalOffsetR)
      .attr("y1", y1)
      .attr("y2", y2)
      .attr("stroke", ink)
      .attr("stroke-width", metrics.barlineFinalThick);
    return;
  }
  parent
    .append("line")
    .attr("class", "barline")
    .attr("x1", x)
    .attr("x2", x)
    .attr("y1", y1)
    .attr("y2", y2)
    .attr("stroke", ink)
    .attr("stroke-width", metrics.barlineStroke);
}

/** 简谱中央八度（无高低点） */
const JIANPU_MIDDLE_OCTAVE = 4;

function upperOctaveDotCount(octave) {
  const oct = Number(octave);
  if (!Number.isFinite(oct)) return 0;
  return Math.max(0, oct - JIANPU_MIDDLE_OCTAVE);
}

function lowerOctaveDotCount(octave) {
  const oct = Number(octave);
  if (!Number.isFinite(oct)) return 0;
  return Math.max(0, JIANPU_MIDDLE_OCTAVE - oct);
}

function outerUpperOctaveY(dotCount, LAYER, step) {
  if (dotCount <= 0) return LAYER.upperOctave;
  return LAYER.upperOctave - (dotCount - 1) * step;
}

function scanOctaveDotExtent(measureColumns) {
  let maxUpper = 0;
  let maxLower = 0;
  for (const cols of measureColumns) {
    for (const col of cols) {
      if (col.kind !== "note") continue;
      const oct = Number(col.number?.octave) || JIANPU_MIDDLE_OCTAVE;
      maxUpper = Math.max(maxUpper, upperOctaveDotCount(oct));
      maxLower = Math.max(maxLower, lowerOctaveDotCount(oct));
    }
  }
  return { maxUpper, maxLower };
}

function scoreHasTuplet(measureColumns, divisions) {
  const div = Number(divisions) || 1;
  for (const cols of measureColumns) {
    for (const col of cols) {
      if (col.kind !== "note") continue;
      const dur = Number(col.number?.dur) || 0;
      if (dur == div / 3 || dur == (div * 2) / 3) return true;
    }
  }
  return false;
}

/** 两点及以上时，延音线/三连音上移，避免压住最外层上点。 */
function layerWithUpperOctaveLift(baseLayer, maxUpperDots, step) {
  const lift = Math.max(0, maxUpperDots - 1) * step;
  if (lift <= 0) return { ...baseLayer };
  return {
    ...baseLayer,
    tupletTop: baseLayer.tupletTop - lift,
    tupletLeg: baseLayer.tupletLeg - lift,
    tie: baseLayer.tie - lift,
  };
}

function computeLineAscentPad(LAYER, metrics, maxUpperDots, hasTuplet) {
  const step = metrics.octaveDotStep;
  let ascent = metrics.noteAscent;
  if (maxUpperDots > 0) {
    const outerY = outerUpperOctaveY(maxUpperDots, LAYER, step);
    ascent = Math.max(ascent, -(outerY - metrics.octaveDotR));
  }
  ascent = Math.max(ascent, -(LAYER.tie - metrics.tieCurve));
  if (hasTuplet) {
    ascent = Math.max(ascent, -LAYER.tupletTop);
  }
  return Math.max(metrics.lineAscentPad, Math.round(ascent * 10) / 10);
}

/**
 * 唱名数字；升降号用独立 text + 绝对坐标，避免 baseline-shift（svg2pdf 不支持）。
 * @returns 唱名 <text>，供附点量宽
 */
function appendNoteNumber(parent, cx, cy, number, metrics, LAYER) {
  const noteText = d3
    .select(parent)
    .append("text")
    .attr("text-anchor", "middle")
    .attr("font-size", metrics.bodySize)
    .attr("transform", `translate(${cx},${cy + LAYER.note})`);

  if (!number.text || number.text.length <= 1) {
    noteText.text(number.text || "");
    return noteText;
  }

  const accidental = number.text[0];
  const digit = number.text.slice(1);
  const lift =
    accidental === "#" ? metrics.accidentalDy : metrics.naturalDy;
  noteText.text(digit);

  let digitLeft = -metrics.bodySize * 0.3;
  try {
    const extent = noteText.node().getExtentOfChar(0);
    digitLeft = extent.x;
  } catch {
    /* keep fallback */
  }

  d3.select(parent)
    .append("text")
    .attr("class", "jianpu-accidental")
    .attr("text-anchor", "end")
    .attr("font-size", metrics.bodySize)
    .attr("x", cx + digitLeft)
    .attr("y", cy + LAYER.note - lift)
    .text(accidental);

  return noteText;
}

/** 唱名墨水盒子（相对基线原点）；量不到时用 metrics 回退。 */
function noteGlyphBox(textSel, metrics) {
  const fallback = {
    x: -metrics.bodySize * 0.3,
    y: -metrics.noteAscent,
    width: metrics.bodySize * 0.6,
    height: metrics.noteAscent + metrics.noteDescent,
  };
  const node = textSel?.node?.();
  if (!node) return fallback;
  try {
    const box = node.getBBox();
    if (box && box.width > 0 && box.height > 0) {
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
  } catch {
    /* 未插入文档 */
  }
  try {
    const n = Math.max(1, node.getNumberOfChars?.() || 1);
    const first = node.getExtentOfChar(0);
    const last = node.getExtentOfChar(n - 1);
    const x = first.x;
    const y = Math.min(first.y, last.y);
    const right = last.x + last.width;
    const bottom = Math.max(first.y + first.height, last.y + last.height);
    if (right > x && bottom > y) {
      return { x, y, width: right - x, height: bottom - y };
    }
  } catch {
    /* keep fallback */
  }
  return fallback;
}

/**
 * 附点：固定横/纵偏移（不按字高比例）。复附点沿水平按 augDotStep 排列。
 */
function appendAugmentationDot(
  parent,
  cx,
  cy,
  noteText,
  metrics,
  LAYER,
  ink,
  count
) {
  const n = Math.max(1, Number(count) || 1);
  const box = noteGlyphBox(noteText, metrics);
  const x0 = cx + box.x + box.width + metrics.augDotDx;
  const y = cy + LAYER.note - metrics.augDotDy;
  const host = d3.select(parent);
  for (let i = 0; i < n; i++) {
    host
      .append("circle")
      .attr("class", "aug-dot")
      .attr("cx", x0 + i * metrics.augDotStep)
      .attr("cy", y)
      .attr("r", metrics.augDotR)
      .attr("fill", ink);
  }
}

function appendOctaveDots(
  parent,
  cx,
  cy,
  octave,
  LAYER,
  metrics,
  ink,
  noteText,
  underlineN
) {
  const upperN = upperOctaveDotCount(octave);
  const lowerN = lowerOctaveDotCount(octave);
  if (upperN <= 0 && lowerN <= 0) return;

  const step = metrics.octaveDotStep;
  const r = metrics.octaveDotR;
  const box = noteGlyphBox(noteText, metrics);
  const top = Math.max(box.y, -metrics.noteAscent);
  let bottom = Math.min(box.y + box.height, metrics.noteDescent);
  if (underlineN > 0) {
    bottom = Math.max(
      bottom,
      underlineLayerY(underlineN, LAYER, metrics.underlineStep)
    );
  }
  const host = d3.select(parent);
  for (let i = 0; i < upperN; i++) {
    host
      .append("circle")
      .attr("transform", `translate(${cx},${cy})`)
      .attr("cx", 0)
      .attr("cy", top - step * (i + 1))
      .attr("r", r)
      .attr("fill", ink);
  }
  for (let i = 0; i < lowerN; i++) {
    host
      .append("circle")
      .attr("transform", `translate(${cx},${cy})`)
      .attr("cx", 0)
      .attr("cy", bottom + step * (i + 1))
      .attr("r", r)
      .attr("fill", ink);
  }
}

/**
 * 小节线高度：上至全文最高音点，下至全文最低音点；不超过延音线/连线。
 */
function barlineYOffsets(measureColumns, divisions, LAYER, metrics) {
  const { maxUpper, maxLower } = scanOctaveDotExtent(measureColumns);
  let maxUl = 0;
  for (const cols of measureColumns) {
    for (const col of cols) {
      if (col.kind !== "note") continue;
      maxUl = Math.max(
        maxUl,
        underlineCount(col.note, col.number?.dur, divisions)
      );
    }
  }
  const step = metrics.octaveDotStep;
  let yTop = -metrics.noteAscent;
  if (maxUpper > 0) {
    yTop = outerUpperOctaveY(maxUpper, LAYER, step) - metrics.octaveDotR;
  }
  yTop = Math.max(yTop, LAYER.tie + 2 * metrics.s);

  let yBottom = metrics.noteDescent;
  if (maxUl > 0) {
    yBottom = Math.max(
      yBottom,
      underlineLayerY(maxUl, LAYER, metrics.underlineStep)
    );
  }
  if (maxLower > 0) {
    let lowerAnchor = metrics.noteDescent;
    if (maxUl > 0) {
      lowerAnchor = Math.max(
        lowerAnchor,
        underlineLayerY(maxUl, LAYER, metrics.underlineStep)
      );
    }
    yBottom = Math.max(
      yBottom,
      lowerAnchor + maxLower * step + metrics.octaveDotR
    );
  }
  return { yTop, yBottom };
}

function augmentationDotCount(note) {
  if (note == null || note.dot == null || note.dot === false) return 0;
  return Math.max(1, asArray(note.dot).length);
}

/** 二分及以上用延音线表示，不画附点 */
function shownAugmentationDotCount(note, dur, divisions) {
  if (!(Number(dur) < 2 * Number(divisions))) return 0;
  return augmentationDotCount(note);
}

function augmentationPadRight(dotCount, metrics) {
  if (dotCount <= 0) return 0;
  return (
    metrics.augDotDx +
    (dotCount - 1) * metrics.augDotStep +
    metrics.augDotR +
    metrics.augDotPad
  );
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
function applyContentLineWidths(scoreLines, minGap) {
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

function keyNameFromFifths(fifths) {
  const map = {
    0: "C",
    1: "G",
    2: "D",
    3: "A",
    4: "E",
    5: "B",
    6: "#F",
    7: "#C",
    "-1": "F",
    "-2": "bB",
    "-3": "bE",
    "-4": "bA",
    "-5": "bD",
    "-6": "bG",
    "-7": "bC",
  };
  return map[String(fifths)] || "C";
}

function findTempo(measures) {
  for (const measure of measures) {
    for (const direction of asArray(measure.direction)) {
      const sound = direction.sound;
      if (sound != null) {
        const tempo = sound["@_tempo"] ?? sound.tempo;
        if (tempo != null && tempo !== "") return String(tempo);
      }
      const types = asArray(direction["direction-type"]);
      for (const t of types) {
        const perMinute = t?.metronome?.["per-minute"];
        if (perMinute != null && perMinute !== "") return String(perMinute);
      }
    }
  }
  return null;
}

/** 情绪等文字速度标记（如「欢快地」） */
function findExpression(measures) {
  for (const measure of measures) {
    for (const direction of asArray(measure.direction)) {
      for (const t of asArray(direction["direction-type"])) {
        const words = textOf(t?.words);
        if (words && !/^\d+(\.\d+)?$/.test(words)) return words;
      }
    }
  }
  return null;
}

function formatCreditLine(line) {
  return String(line || "")
    .replace(/[：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(score, partAttr, measures, options = {}) {
  const credits = asArray(score.credit);
  const creditWords = [];
  for (const credit of credits) {
    for (const words of asArray(credit["credit-words"])) {
      const line = textOf(words);
      if (line) creditWords.push(line);
    }
  }

  let title = "";
  const titleCredit = credits.find((c) => c["credit-type"] === "title");
  if (titleCredit) {
    title = textOf(asArray(titleCredit["credit-words"])[0]);
  }
  if (isPlaceholder(title)) {
    title = textOf(score.work?.["work-title"]);
  }
  if (isPlaceholder(title)) {
    title = textOf(score["movement-title"]);
  }
  if (isPlaceholder(title)) {
    title = creditWords[0] || "未命名";
  }

  const creators = asArray(score.identification?.creator);
  let lyricist = "";
  let composer = "";
  let translator = "";
  for (const creator of creators) {
    const value = textOf(creator);
    if (isPlaceholder(value)) continue;
    if (creator["@_type"] === "lyricist") lyricist = value;
    if (creator["@_type"] === "composer") composer = value;
    if (creator["@_type"] === "translator") translator = value;
  }

  const creditAuthors = creditWords
    .flatMap((line) => String(line).split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => /作词|作曲|作编曲|歌：|歌 |演唱|译配/.test(line))
    .map(formatCreditLine);

  const fifths = partAttr?.key?.fifths ?? 0;
  const originalKeyName = keyNameFromFifths(fifths);
  const keyName = options.fixedDo ? "C" : originalKeyName;
  const beats = partAttr?.time?.beats ?? 4;
  const beatType = partAttr?.time?.["beat-type"] ?? 4;
  const tempo = findTempo(measures);
  const expression = findExpression(measures);

  const extracted = {
    title: title.replace(/\s+/g, " ").trim(),
    lyricist,
    composer,
    translator,
    creditAuthors,
    keyName,
    originalKeyName,
    beats: String(beats),
    beatType: String(beatType),
    timeSig: `${beats}/${beatType}`,
    tempo,
    expression,
  };
  extracted.authorLines = buildAuthorLines(extracted);
  return extracted;
}

function buildAuthorLines(meta) {
  if (meta.creditAuthors.length > 0) return meta.creditAuthors;
  return [
    meta.lyricist
      ? formatCreditLine(
          meta.lyricist.includes("作词")
            ? meta.lyricist
            : `作词 ${meta.lyricist}`
        )
      : "",
    meta.translator
      ? formatCreditLine(
          /译配|翻译|译/.test(meta.translator)
            ? meta.translator
            : `译配 ${meta.translator}`
        )
      : "",
    meta.composer
      ? formatCreditLine(
          meta.composer.includes("作曲")
            ? meta.composer
            : `作曲 ${meta.composer}`
        )
      : "",
  ].filter(Boolean);
}

/**
 * 量 SVG 文字：advance 用于光标，ink 盒子用于字面间距。
 * getBBox 失败时退回 advance（与旧逻辑一致）。
 */
function measureSvgText(sel) {
  const node = sel.node();
  const origin = Number(sel.attr("x")) || 0;
  const advance = node?.getComputedTextLength?.() || 0;
  let inkX = origin;
  let inkW = advance;
  try {
    const box = node.getBBox();
    if (box && box.width > 0) {
      inkX = box.x;
      inkW = box.width;
    }
  } catch {
    /* 未插入文档时 getBBox 会抛 */
  }
  return { advance, inkX, inkW };
}

/**
 * 谱头调号：1、=、调名拆开画，使「= 与 x」的字面间距等于「1 与 =」。
 * 升降号仍单独抬高（svg2pdf 不支持 baseline-shift）。
 * @returns {number} 调号总宽（含 advance）
 */
function appendMetaKey(keyG, keyName, keyBaseline, metrics) {
  const metaFs = metrics.metaSize;
  const s = metrics.s;
  const fallback = 8 * s;
  const textAt = (x, y, str) =>
    keyG
      .append("text")
      .attr("x", x)
      .attr("y", y)
      .attr("font-size", metaFs)
      .text(str);

  const one = textAt(0, keyBaseline, "1");
  const oneM = measureSvgText(one);
  const oneAdv = oneM.advance || fallback;

  const eq = textAt(oneAdv, keyBaseline, "=");
  const eqM = measureSvgText(eq);
  const gap = Math.max(0, eqM.inkX - (oneM.inkX + oneM.inkW));
  const nextInkLeft = eqM.inkX + eqM.inkW + gap;

  const placeAtInkLeft = (sel, inkLeft) => {
    const origin = Number(sel.attr("x")) || 0;
    const m = measureSvgText(sel);
    const lsb = m.inkX - origin;
    const x = inkLeft - lsb;
    sel.attr("x", x);
    return x + (m.advance || fallback);
  };

  if (keyName.startsWith("b") || keyName.startsWith("#")) {
    const accidental = keyName[0];
    const letter = keyName.slice(1);
    const acc = textAt(
      0,
      keyBaseline - metrics.metaKeyAccidentalLift,
      accidental
    );
    const cursor = placeAtInkLeft(acc, nextInkLeft);
    const letterNode = textAt(
      cursor + metrics.metaKeyAccidentalGap,
      keyBaseline,
      letter
    );
    return (
      Number(letterNode.attr("x")) +
      (letterNode.node()?.getComputedTextLength?.() || 10 * s)
    );
  }

  const letterNode = textAt(0, keyBaseline, keyName);
  return placeAtInkLeft(letterNode, nextInkLeft);
}

/**
 * PDF 用：在 SVG 里画调号/拍号/速度/署名。
 * @param {d3.Selection} parent
 * @param {object} meta
 * @param {{ left: number, right: number, canvasWidth: number, fallbackLeft?: number, fallbackRight?: number }} geom
 * @returns {d3.Selection} metaRow
 */
function drawScoreMeta(parent, meta, geom, metrics, inkColor) {
  const ink = inkColor || scoreInk();
  const {
    left: bodyLeft,
    right: bodyRight,
    canvasWidth,
    fallbackLeft,
    fallbackRight,
  } = geom;
  const slotLeft = fallbackLeft ?? bodyLeft;
  const slotRight = fallbackRight ?? bodyRight;
  const bodySpan = Math.max(0, bodyRight - bodyLeft);
  const slotSpan = Math.max(0, slotRight - slotLeft);
  const metaLineGap = metrics.metaLineGap;
  const metaMinGap = metrics.metaMinGap;
  const pagePad = metrics.metaPagePad;
  const authorLines = meta.authorLines || [];
  const hasMoodTempo = !!(meta.tempo || meta.expression);
  const metaFs = metrics.metaSize;
  const s = metrics.s;

  const metaRow = parent.append("g").attr("class", "score-meta-svg").attr("fill", ink);
  const metaLeft = metaRow.append("g").attr("transform", `translate(${bodyLeft},0)`);
  const metaLeftInner = metaLeft.append("g");
  const keyTimeG = metaLeftInner.append("g");
  const moodTempoG = metaLeftInner.append("g");

  let metaX = 0;
  const keyBaseline = metaFs * 0.36;

  const keyG = keyTimeG.append("g").attr("transform", `translate(${metaX},0)`);
  const keyCursor = appendMetaKey(keyG, meta.keyName, keyBaseline, metrics);
  metaX += keyCursor + metrics.metaLineGap;

  const timeGap = metrics.metaTimeGap;
  const timeCap = metaFs * 0.72;
  const timeG = keyTimeG.append("g").attr("transform", `translate(${metaX},0)`);
  timeG
    .append("text")
    .attr("text-anchor", "middle")
    .attr("x", 0)
    .attr("y", -timeGap)
    .attr("font-size", metaFs)
    .attr("font-weight", "600")
    .text(meta.beats);
  timeG
    .append("line")
    .attr("x1", -metrics.metaTimeBarHalf)
    .attr("x2", metrics.metaTimeBarHalf)
    .attr("y1", 0)
    .attr("y2", 0)
    .attr("stroke", ink)
    .attr("stroke-width", metrics.metaTimeBarStroke);
  timeG
    .append("text")
    .attr("text-anchor", "middle")
    .attr("x", 0)
    .attr("y", timeGap + timeCap)
    .attr("font-size", metaFs)
    .attr("font-weight", "600")
    .text(meta.beatType);
  metaX += metrics.metaTimeAdvance;
  const keyTimeEndX = metaX;

  const tempoBaseline = metaFs * 0.36;
  const moodTempoGap = metrics.metaMoodGap;
  let moodCursor = 0;
  if (meta.tempo) {
    const noteShift = 5 * s;
    const noteG = moodTempoG
      .append("g")
      .attr("transform", `translate(${moodCursor + noteShift},0)`);
    noteG
      .append("ellipse")
      .attr("cx", 0)
      .attr("cy", 2 * s)
      .attr("rx", metrics.metaTempoNoteRx)
      .attr("ry", metrics.metaTempoNoteRy)
      .attr("transform", "rotate(-25)")
      .attr("fill", ink);
    noteG
      .append("line")
      .attr("x1", 4.2 * s)
      .attr("y1", 2 * s)
      .attr("x2", 4.2 * s)
      .attr("y2", -12 * s)
      .attr("stroke", ink)
      .attr("stroke-width", metrics.metaTempoStem)
      .attr("stroke-linecap", "round");
    const tempoText = moodTempoG
      .append("text")
      .attr("x", moodCursor + 14 * s)
      .attr("y", tempoBaseline)
      .attr("font-size", metaFs)
      .text(`=${meta.tempo}`);
    moodCursor +=
      14 * s +
      (tempoText.node()?.getComputedTextLength?.() || 36 * s) +
      moodTempoGap;
  }
  if (meta.expression) {
    moodTempoG
      .append("text")
      .attr("x", moodCursor)
      .attr("y", tempoBaseline)
      .attr("font-size", metaFs)
      .text(meta.expression);
  }

  function layoutMetaLeft(stacked) {
    if (stacked && hasMoodTempo) {
      keyTimeG.attr("transform", "translate(0,0)");
      moodTempoG.attr("transform", "translate(0,0)");
      const keyBox = keyTimeG.node().getBBox();
      const moodBox = moodTempoG.node().getBBox();
      const clearance = 5 * s;
      const needSpan = keyBox.y + keyBox.height - moodBox.y + clearance;
      const rowSpan = Math.max(metaLineGap, needSpan);
      keyTimeG.attr("transform", `translate(0,${-rowSpan / 2})`);
      moodTempoG.attr("transform", `translate(0,${rowSpan / 2})`);
    } else {
      keyTimeG.attr("transform", "translate(0,0)");
      moodTempoG.attr(
        "transform",
        hasMoodTempo ? `translate(${keyTimeEndX},0)` : "translate(0,0)"
      );
    }
  }
  layoutMetaLeft(false);

  const creditN = authorLines.length;
  const creditSpan = Math.max(0, (creditN - 1) * metaLineGap);
  const creditG = metaRow
    .append("g")
    .attr("transform", `translate(${bodyRight},0)`);
  authorLines.forEach((line, idx) => {
    const centerY = -creditSpan / 2 + idx * metaLineGap;
    creditG
      .append("text")
      .attr("text-anchor", "end")
      .attr("x", 0)
      .attr("y", centerY + metaFs * 0.35)
      .attr("font-size", metaFs)
      .text(line);
  });

  function measureMetaNeed() {
    const leftBox = metaLeft.node().getBBox();
    const creditBox = creditG.node().getBBox();
    const leftW = leftBox.width;
    const creditW = creditN > 0 ? creditBox.width : 0;
    return {
      leftBox,
      creditBox,
      leftW,
      creditW,
      needed: leftW + metaMinGap + creditW,
    };
  }

  let { leftBox, creditBox, leftW, creditW, needed } = measureMetaNeed();
  const maxSpan = Math.max(0, canvasWidth - 2 * pagePad);

  let useLeft = bodyLeft;
  let useRight = bodyRight;
  let useSpan = bodySpan;
  if (needed > bodySpan + 0.5) {
    useLeft = slotLeft;
    useRight = slotRight;
    useSpan = slotSpan;
  }

  if (creditN > 0 && hasMoodTempo && useSpan < needed) {
    layoutMetaLeft(true);
    ({ leftBox, creditBox, leftW, creditW, needed } = measureMetaNeed());
  }

  if (creditN > 0 && useSpan < needed) {
    const bodyCenterX = (useLeft + useRight) / 2;
    if (needed <= maxSpan) {
      let useNeed = needed;
      let metaAlignLeft = bodyCenterX - useNeed / 2;
      let metaAlignRight = bodyCenterX + useNeed / 2;
      if (metaAlignLeft < pagePad) {
        metaAlignLeft = pagePad;
        metaAlignRight = pagePad + useNeed;
      } else if (metaAlignRight > canvasWidth - pagePad) {
        metaAlignRight = canvasWidth - pagePad;
        metaAlignLeft = metaAlignRight - useNeed;
      }
      metaLeft.attr("transform", `translate(${metaAlignLeft},0)`);
      creditG.attr("transform", `translate(${metaAlignRight},0)`);
    } else {
      const metaAlignLeft = Math.max(
        pagePad,
        Math.min(useLeft, canvasWidth - pagePad - leftW)
      );
      const metaAlignRight = Math.min(
        canvasWidth - pagePad,
        Math.max(useRight, metaAlignLeft + leftW)
      );
      metaLeft.attr("transform", `translate(${metaAlignLeft},0)`);
      const creditY =
        leftBox.y + leftBox.height + metrics.metaCreditStackGap - creditBox.y;
      creditG.attr("transform", `translate(${metaAlignRight},${creditY})`);
    }
  } else {
    metaLeft.attr("transform", `translate(${useLeft},0)`);
    creditG.attr("transform", `translate(${useRight},0)`);
  }

  return metaRow;
}

function showParseError(svgElement, err) {
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
function resolveScoreWidth(svgElement, options = {}, contentMinWidth = 0) {
  if (options.width) return options.width;
  const viewportW = getViewportWidth(svgElement);
  return Math.max(viewportW, contentMinWidth, 1);
}

/** 多列之间的水平间距（px）；含分隔符留白 */
const COLUMN_GAP = 56;
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
 * @param {{ columns?: number, autoColumns?: boolean, viewportWidth?: number, viewportHeight?: number, hideTitle?: boolean, hideMeta?: boolean }} options
 * @param {number} lineCount
 * @param {number} columnInnerW 单列槽宽（纸张列槽）
 * @param {number} eachHeight 行高
 * @param {SVGSVGElement} svgElement
 */
function resolveColumnCount(
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
  // hideMeta 时元信息在 HTML，画布内几乎无页眉；预留少许顶边
  const headerReserve = options.hideMeta ? 48 : options.hideTitle ? 72 : 140;
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
function packReadableLineLayout(
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

/**
 * 可被 Vue 组件调用的初始化函数。
 * @param {SVGSVGElement} svgElement - 宿主 <svg> 节点
 * @param {string} [url] - musicxml 资源 URL 或 XML 字符串
 * @param {{ width?: number, hideTitle?: boolean, hideMeta?: boolean, columns?: number, autoColumns?: boolean, viewportWidth?: number, viewportHeight?: number, maxColumnWidth?: number, contentPadX?: number, lineBreak?: 'auto' | 'musicxml' | number, firstColumnHeaderH?: number, fontSize?: number, forceLight?: boolean, readableLineUnits?: boolean, fixedDo?: boolean, transposeSemitones?: number }} [options]
 * @returns {Promise<{ xmlString: string, title: string, meta?: object, layout?: object } | null>}
 */
export default async function initApp(svgElement, url, options = {}) {
  d3.select(svgElement).selectAll("*").remove();

  try {
    let xmlString;
    if (isLink(url)) {
      const xmlDoc = await d3.xml(url);
      xmlString = new XMLSerializer().serializeToString(xmlDoc);
    } else {
      xmlString = url;
    }

    if (!xmlString || !String(xmlString).trim()) {
      throw new Error("MusicXML 内容为空");
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const parsed = parser.parse(xmlString);
    if (!parsed?.["score-partwise"]) {
      throw new Error("不是 score-partwise 格式的 MusicXML，或文件不完整");
    }

    const rendered = jianpu(parsed, svgElement, options);
    return {
      xmlString,
      title: rendered?.title || "",
      meta: rendered
        ? {
            keyName: rendered.keyName,
            originalKeyName: rendered.originalKeyName,
            beats: rendered.beats,
            beatType: rendered.beatType,
            tempo: rendered.tempo,
            expression: rendered.expression,
            authorLines: rendered.authorLines || [],
          }
        : null,
      layout: rendered?.layout || null,
    };
  } catch (err) {
    console.error("[initApp] 加载或解析 MusicXML 失败：", err);
    showParseError(svgElement, err);
    return null;
  }
}

function jianpu(musicJson, svgElement, options = {}) {
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
  var lyricOffset = LAYER.lyric; // 组内：唱名基线 → 歌词
  var eachHeight = metrics.eachHeight; // 组高（含组间空隙）
  var titleY = metrics.titleY;
  var titleFontSize = metrics.titleSize;
  var sectionGap = metrics.sectionGap; // 标题↔元信息、元信息↔正文（视觉等距）
  var marginTop = 110; // 首行唱名基线（正文定位后回写）
  var tiePath = [-1, -1, -1, -1]; //连音始末位置
  const divisions = Number(partAttr.divisions) || 1;

  // —— Pass1：先按小节收集列并量宽，再按 lineBreak 断行 ——
  const measureHost = g.append("g").attr("visibility", "hidden");
  const measureColumns = [];
  const noteLayout = []; // noteLayout[measureIdx][noteIdx] = { cx, lineIndex, extendCxs }

  for (let j = 0; j < measures.length; j++) {
    const cols = [];
    noteLayout[j] = [];
    const notes = measures[j].note;
    for (let i = 0; i < notes.length; i++) {
      const d = notes[i];
      const number = note2number(d);
      const lyric = primaryLyricText(d);
      const noteCol = {
        kind: "note",
        note: d,
        number,
        lyric,
        measureIdx: j,
        noteIdx: i,
      };
      cols.push(noteCol);
      const extendCols = [];
      const dur = number.dur || 0;
      if (dur > divisions) {
        // 按拍拆延音：floor(dur/divisions) 即占用拍数。
        // 二分 5 -、附点二分 5 - -、全音符 5 - - -；不要因 <dot> 再多加一拍。
        const addNote = Math.floor(dur / divisions);
        for (let k = 1; k < addNote; k++) {
          const ext = {
            kind: "extend",
            text: number.text === "0" ? "0" : "-",
            number,
            measureIdx: j,
            noteIdx: i,
          };
          cols.push(ext);
          extendCols.push(ext);
        }
      }
      noteLayout[j][i] = {
        lineIndex: 0,
        noteCol,
        extendCols,
        cx: 0,
        extendCxs: [],
      };
    }
    cols.push({
      kind: "bar",
      measureIdx: j,
      style: rightBarStyle(measures[j], j === measures.length - 1),
    });
    measureColumns.push(cols);
  }

  const slotW = standardSlotWidth(measureHost, metrics);
  for (const cols of measureColumns) {
    for (const col of cols) {
      if (col.kind === "bar" || col.kind === "extend") {
        col.w = slotW;
      } else {
        const noteLabel =
          col.number.text.length > 1
            ? col.number.text.replace(/^#/, "")
            : col.number.text;
        const noteW =
          measureTextWidth(measureHost, noteLabel, {
            fontSize: metrics.bodySize,
          }) + (col.number.text.startsWith("#") ? metrics.sharpExtraW : 0);
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
        col.w = Math.max(
          slotW,
          noteW + augPad,
          lyricW + metrics.layoutLyricPad
        );
      }
    }
  }
  measureHost.remove();

  const { maxUpper: maxUpperDots } = scanOctaveDotExtent(measureColumns);
  LAYER = layerWithUpperOctaveLift(
    LAYER,
    maxUpperDots,
    metrics.octaveDotStep
  );
  const lineAscentPad = computeLineAscentPad(
    LAYER,
    metrics,
    maxUpperDots,
    scoreHasTuplet(measureColumns, divisions)
  );
  const barY = barlineYOffsets(measureColumns, divisions, LAYER, metrics);

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

  let scoreLines;
  let measureLineIndex;
  let readableColumnCount = null;
  let readableColumnSlotW = null;
  if (useReadableUnits) {
    const packed = packReadableLineLayout(
      measureColumns,
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
      measureColumns,
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

  const contentWidth = applyContentLineWidths(scoreLines, metrics.layoutMinGap);
  // 正文宽 = 最长行；列槽内整体居中，行内仍左对齐
  const targetWidth = contentWidth;

  // 回填音符与延音线中心坐标
  for (let j = 0; j < measures.length; j++) {
    for (let i = 0; i < (noteLayout[j] || []).length; i++) {
      const layout = noteLayout[j][i];
      if (!layout) continue;
      layout.cx = layout.noteCol.cx;
      layout.extendCxs = layout.extendCols.map((c) => c.cx);
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

  for (var j = 0; j < measures.length; j++) {
    const lineIndex = measureLineIndex[j];
    const { col: lineCol } = linePlacement(lineIndex);
    const notes = measures[j].note;
    const length = notes.length;
    const durList = notes.map((d) => note2number(d).dur);

    colGroups[lineCol]
      .selectAll(`.note-m${j}`)
      .data(notes)
      .enter()
      .append("g")
      .attr("class", `note note-m${j}`)
      .each(function (d, i) {
        const layout = noteLayout[j][i];
        const number = layout.noteCol.number;
        const pos = bodyXY(lineIndex, layout.cx);
        const cx = pos.x;
        const cy = pos.y;

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
        if (lyric) {
          d3.select(this)
            .append("text")
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
          underlineCount(d, number.dur, divisions)
        );

        if (number.tied) {
          if (tiePath[0] == -1) {
            tiePath[0] = cx;
            tiePath[1] = cy + LAYER.tie;
          } else if (tiePath[2] == -1) {
            tiePath[2] = cx;
            tiePath[3] = cy + LAYER.tie;
            if (Math.abs(tiePath[3] - tiePath[1]) < metrics.tieSameLineSlop) {
              d3.select(this)
                .append("path")
                .attr("fill", "none")
                .attr("stroke", ink)
                .attr("stroke-width", metrics.tieStroke)
                .attr("d", pathTied(tiePath));
              tiePath[0] = -1;
              tiePath[2] = -1;
            } else {
              const path1 = [
                tiePath[0],
                tiePath[1],
                tiePath[0] + metrics.tieHookPx,
                tiePath[1],
              ];
              const path2 = [
                tiePath[2] - metrics.tieHookPx,
                tiePath[3],
                tiePath[2],
                tiePath[3],
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
              tiePath[0] = -1;
              tiePath[2] = -1;
            }
          }
        }

        if (
          number.dur == divisions / 3 ||
          number.dur == divisions * 2 / 3
        ) {
          if (
            i != 0 &&
            i + 1 < length &&
            durList[i - 1] == number.dur &&
            number.dur == durList[i + 1]
          ) {
            const leftX = bodyXY(lineIndex, noteLayout[j][i - 1].cx).x - cx;
            const rightX = bodyXY(lineIndex, noteLayout[j][i + 1].cx).x - cx;
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

    // 同一拍内有下划线的音符/休止符连成一组
    const measureAttr = measures[j].attributes || partAttr;
    const beatDur = primaryBeatDuration(
      Number(measureAttr.divisions) || divisions,
      measureAttr
    );
    const underlineGroups = groupUnderlineBeams(
      notes,
      durList,
      beatDur,
      Number(measureAttr.divisions) || divisions
    );
    underlineGroups.forEach((levelGroups, levelIdx) => {
      const y = underlineLayerY(levelIdx + 1, LAYER, metrics.underlineStep);
      for (const idxs of levelGroups) {
        const xs = [];
        let cy = 0;
        for (const i of idxs) {
          const layout = noteLayout[j][i];
          if (!layout) continue;
          const pos = bodyXY(lineIndex, layout.cx);
          xs.push(pos.x);
          cy = pos.y;
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

    // 小节竖线：取该小节 bar 列中心；全曲末为终止线
    const barCol = scoreLines[lineIndex].columns.find(
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
  function note2number(note)
  {
    // 调号 → 各音级默认升降（未写 accidental 时由调号决定）
    const keySigAlter = (fifths) => {
      const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
      const sharpOrder = ["F", "C", "G", "D", "A", "E", "B"];
      const flatOrder = ["B", "E", "A", "D", "G", "C", "F"];
      const n = Number(fifths) || 0;
      if (n > 0) {
        for (let i = 0; i < n && i < 7; i++) map[sharpOrder[i]] = 1;
      } else if (n < 0) {
        for (let i = 0; i < -n && i < 7; i++) map[flatOrder[i]] = -1;
      }
      return map;
    };
    // 调号 → 主音音名（1=）
    const tonicFromFifths = (fifths) => {
      const majors = {
        0: "C",
        1: "G",
        2: "D",
        3: "A",
        4: "E",
        5: "B",
        6: "F",
        7: "C",
        "-1": "F",
        "-2": "B",
        "-3": "E",
        "-4": "A",
        "-5": "D",
        "-6": "G",
        "-7": "C",
      };
      return majors[String(fifths)] || "C";
    };
    var stepList = [ "1","#1","2","#2","3","4","#4","5","#5","6","#6","7" ];
    var step2num = [ {step:"C",num:0},{step:"D",num:2},{step:"E",num:4},
                    {step:"F",num:5},{step:"G",num:7},{step:"A",num:9},{step:"B",num:11} ];
    var number = {text:"0",tied:0,octave:4,dur:0};
    const notations = note.notations;
    const hasTied =
      notations != null &&
      (notations.tied != null ||
        asArray(notations).some((item) => item && item.tied != null));
    number.tied = hasTied ? 1 : 0;
    if(note.rest != undefined)
    {
      number.text = "0";
      number.dur = Number(note.duration) || 0;
      number.octave = 4;
      return number;
    }
    if (!note.pitch) {
      number.dur = Number(note.duration) || 0;
      return number;
    }
    const step = note.pitch.step;
    let naturalSemitone = 0;
    for (let i = 0; i < step2num.length; i++) {
      if (step2num[i].step == step) {
        naturalSemitone = step2num[i].num;
        break;
      }
    }
    const originalFifths = Number(partAttr.key?.fifths) || 0;
    const sig = keySigAlter(originalFifths);
    // 显式 alter 优先；否则用调号默认升降
    let pitchAlter = 0;
    if (note.pitch.alter != undefined) {
      pitchAlter = Number(note.pitch.alter);
    } else {
      pitchAlter = sig[step] || 0;
    }
    const soundingSemitone = ((naturalSemitone + pitchAlter) % 12 + 12) % 12;
    const pitchOctave = Number(note.pitch.octave);
    const transposeSemitones = Number(options.transposeSemitones) || 0;
    const midi =
      (pitchOctave + 1) * 12 + soundingSemitone + transposeSemitones;

    const numberingFifths = options.fixedDo ? 0 : originalFifths;
    const numberingSig = keySigAlter(numberingFifths);
    const tonicStep = tonicFromFifths(numberingFifths);
    let tonicNatural = 0;
    for (let i = 0; i < step2num.length; i++) {
      if (step2num[i].step == tonicStep) {
        tonicNatural = step2num[i].num;
        break;
      }
    }
    const tonicSemitone =
      ((tonicNatural + (numberingSig[tonicStep] || 0)) % 12 + 12) % 12;
    // 中央八度：主音落在 4（渲染约定：3=下点，4=中央，5=上点）
    const tonicMidi = (4 + 1) * 12 + tonicSemitone;

    let degreeSemis = midi - tonicMidi;
    let relOctave = 4;
    while (degreeSemis < 0) {
      degreeSemis += 12;
      relOctave--;
    }
    while (degreeSemis > 11) {
      degreeSemis -= 12;
      relOctave++;
    }
    number.octave = relOctave;
    number.dur = Number(note.duration) || 0;
    number.text = stepList[degreeSemis] || "0";
    return number;
  }

  return {
    ...meta,
    layout: {
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
    },
  };
}