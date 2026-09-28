import { select } from "d3-selection";
import { asArray, textOf } from "./parse.js";

const d3 = { select };
const textWidthCache = new Map();

function themeColor(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export function scoreInk() {
  return themeColor("--color-text-primary", "#1C1C1E");
}

export function scoreError() {
  return themeColor("--color-error", "#b00020");
}

export function scoreGuide() {
  return themeColor("--color-border", "#d0d0d0");
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

export function underlineCount(note, dur, divisions) {
  const fromType = noteTypeUnderlineCount(note);
  if (fromType > 0) return fromType;
  return durationUnderlineCount(dur, divisions);
}

/** 简谱按拍分组：4/4 等以拍号单位为一拍；6/8、9/8、12/8 以附点四分（三个八分）为一拍 */
export function primaryBeatDuration(divisions, partAttr) {
  const div = Math.max(1, Number(divisions) || 1);
  const beats = Math.max(1, Number(partAttr?.time?.beats) || 4);
  const beatType = Math.max(1, Number(partAttr?.time?.["beat-type"]) || 4);
  const unit = div * (4 / beatType);
  if (beatType === 8 && beats % 3 === 0) return unit * 3;
  return unit;
}

export function underlineLayerY(level, LAYER, step) {
  if (level <= 1) return LAYER.underline1;
  if (level === 2) return LAYER.underline2;
  return LAYER.underline2 + (level - 2) * step;
}

/**
 * 同一拍内、达到该层下划线的连续音符/休止符分成一组。
 * @returns {number[][][]} groups[level-1] = [[noteIdx, ...], ...]
 */
export function groupUnderlineBeams(notes, durs, beatDur, divisions) {
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
export function primaryLyricText(note) {
  if (note?.lyric == null) return "";
  const lyrics = asArray(note.lyric);
  const primary =
    lyrics.find((item) => String(item["@_number"] ?? item.number ?? "1") === "1") ||
    lyrics[0];
  return textOf(primary?.text) || textOf(primary) || "";
}

/** 用临时 SVG text 测量宽度；按字号/字重缓存 */
export function measureTextWidth(host, text, attrs = {}) {
  if (!text) return 0;
  const key = `${attrs.fontSize || ""}|${attrs.fontWeight || ""}|${text}`;
  const cached = textWidthCache.get(key);
  if (cached != null) return cached;
  const t = host.append("text").attr("visibility", "hidden");
  if (attrs.fontSize != null) t.attr("font-size", attrs.fontSize);
  if (attrs.fontWeight != null) t.attr("font-weight", attrs.fontWeight);
  t.text(String(text));
  const w = t.node()?.getComputedTextLength?.() || String(text).length * 8;
  t.remove();
  textWidthCache.set(key, w);
  return w;
}

/** 中文单字标准槽宽：小节线/终止符/延音/默认四分音符共用，不扫描全曲歌词 */
export function standardSlotWidth(host, metrics) {
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
export function rightBarStyle(measure, isLastMeasure) {
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
export function appendJianpuBarline(parent, x, y, style, ink, yTop, yBottom, metrics) {
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

/** 花括号几何：鼓起宽度、与竖线间距、曲率、线宽 */
export function pianoBraceGeom(metrics) {
  const gap =
    (Number(metrics.barlineFinalOffsetL) || 2.5) +
    (Number(metrics.barlineFinalOffsetR) || 1.5);
  const depth = Number(metrics.braceWidth) || 12;
  const qRaw = Number(metrics.braceCurve);
  const q = Number.isFinite(qRaw) ? qRaw : 0.6;
  const stroke =
    Number(metrics.braceStroke) || Number(metrics.barlineStroke) || 1.6;
  return { gap, depth, q, stroke };
}

/**
 * 连谱号花括号路径（二次贝塞尔描边）。
 * x1,y1 顶点；x2,y2 底点；w 鼓起宽度；q 曲率比例 (0~1)。
 * 垂直时正 w 向左突出。
 */
function makeCurlyBrace(x1, y1, x2, y2, w, q) {
  let dx = x1 - x2;
  let dy = y1 - y2;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0)) return "";
  dx /= len;
  dy /= len;

  const qx1 = x1 + q * w * dy;
  const qy1 = y1 - q * w * dx;
  const qx2 = x1 - 0.25 * len * dx + (1 - q) * w * dy;
  const qy2 = y1 - 0.25 * len * dy - (1 - q) * w * dx;
  const tx1 = x1 - 0.5 * len * dx + w * dy;
  const ty1 = y1 - 0.5 * len * dy - w * dx;
  const qx3 = x2 + q * w * dy;
  const qy3 = y2 - q * w * dx;
  const qx4 = x1 - 0.75 * len * dx + (1 - q) * w * dy;
  const qy4 = y1 - 0.75 * len * dy - (1 - q) * w * dx;

  return `M ${x1} ${y1} Q ${qx1} ${qy1} ${qx2} ${qy2} T ${tx1} ${ty1} M ${x2} ${y2} Q ${qx3} ${qy3} ${qx4} ${qy4} T ${tx1} ${ty1}`;
}

/**
 * 钢琴花括号：描边 `{`，尖钩朝左，贴左右缘竖线。
 */
export function appendPianoBrace(parent, barX, y1, y2, ink, metrics) {
  const h = y2 - y1;
  if (!(h > 0)) return;
  const { gap, depth, q, stroke } = pianoBraceGeom(metrics);
  const x = barX - gap;
  const d = makeCurlyBrace(x, y1, x, y2, depth, q);
  if (!d) return;
  parent
    .append("path")
    .attr("class", "piano-brace")
    .attr("d", d)
    .attr("fill", "none")
    .attr("stroke", ink)
    .attr("stroke-width", stroke)
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round");
}

/** 简谱中央八度（无高低点） */
const JIANPU_MIDDLE_OCTAVE = 4;

export function upperOctaveDotCount(octave) {
  const oct = Number(octave);
  if (!Number.isFinite(oct)) return 0;
  return Math.max(0, oct - JIANPU_MIDDLE_OCTAVE);
}

export function lowerOctaveDotCount(octave) {
  const oct = Number(octave);
  if (!Number.isFinite(oct)) return 0;
  return Math.max(0, JIANPU_MIDDLE_OCTAVE - oct);
}

function outerUpperOctaveY(dotCount, LAYER, step) {
  if (dotCount <= 0) return LAYER.upperOctave;
  return LAYER.upperOctave - (dotCount - 1) * step;
}

export function scanOctaveDotExtent(measureColumns) {
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

export function scoreHasTuplet(measureColumns, divisions) {
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
export function layerWithUpperOctaveLift(baseLayer, maxUpperDots, step) {
  const lift = Math.max(0, maxUpperDots - 1) * step;
  if (lift <= 0) return { ...baseLayer };
  return {
    ...baseLayer,
    tupletTop: baseLayer.tupletTop - lift,
    tupletLeg: baseLayer.tupletLeg - lift,
    tie: baseLayer.tie - lift,
  };
}

export function computeLineAscentPad(LAYER, metrics, maxUpperDots, hasTuplet) {
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
export function appendNoteNumber(parent, cx, cy, number, metrics, LAYER) {
  const noteText = d3
    .select(parent)
    .append("text")
    .attr("class", "jianpu-digit")
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
export function appendAugmentationDot(
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

export function appendOctaveDots(
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
      .attr("class", "octave-dot")
      .attr("transform", `translate(${cx},${cy})`)
      .attr("cx", 0)
      .attr("cy", top - step * (i + 1))
      .attr("r", r)
      .attr("fill", ink);
  }
  for (let i = 0; i < lowerN; i++) {
    host
      .append("circle")
      .attr("class", "octave-dot")
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
export function barlineYOffsets(measureColumns, divisions, LAYER, metrics) {
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
export function shownAugmentationDotCount(note, dur, divisions) {
  if (!(Number(dur) < 2 * Number(divisions))) return 0;
  return augmentationDotCount(note);
}

export function augmentationPadRight(dotCount, metrics) {
  if (dotCount <= 0) return 0;
  return (
    metrics.augDotDx +
    (dotCount - 1) * metrics.augDotStep +
    metrics.augDotR +
    metrics.augDotPad
  );
}
