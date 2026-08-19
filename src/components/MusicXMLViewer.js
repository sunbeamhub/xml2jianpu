/* eslint-disable no-unused-vars */
import * as d3 from "d3";
import { XMLParser } from "fast-xml-parser";
import { DEFAULT_SVG_WIDTH, SCORE_PAD_X } from "../utils/pageLayout.js";

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

/** 小节线内侧留白 */
const MEASURE_INSET = 8;
/** 跨行连音续弧长度 */
const TIE_HOOK_PX = 16;

/** 小节自然宽：字形/歌词最小宽 + 两侧内边距 + 小节线 */
function naturalMeasureWidth(segment) {
  let content = 0;
  let hasBar = false;
  for (const col of segment) {
    if (col.kind === "bar") {
      hasBar = true;
      continue;
    }
    content += Number(col.w) || 0;
  }
  return content + MEASURE_INSET * 2 + (hasBar ? LAYOUT_BAR_W : 0);
}

/**
 * 按换行模式把各小节列拼成行。
 * auto：按小节自然宽贪心装行；musicxml / 每行 N 小节：断点不变。
 * @param {'auto' | 'musicxml' | number} mode
 */
function groupMeasureColumnsIntoLines(measureColumns, measures, mode, innerW) {
  const scoreLines = [];
  let lineCols = [];
  const measureLineIndex = [];

  function flushLine() {
    if (!lineCols.length) return;
    scoreLines.push({ columns: lineCols });
    lineCols = [];
  }

  const cap = Math.max(1, Number(innerW) || 1);
  const perLine = typeof mode === "number" ? Math.max(1, mode) : null;
  let lineW = 0;

  for (let j = 0; j < measureColumns.length; j++) {
    let shouldBreak = false;
    if (mode === "musicxml") {
      shouldBreak = isMusicXmlLineBreak(measures[j]);
    } else if (perLine != null) {
      shouldBreak = j > 0 && j % perLine === 0;
    } else {
      const mw = naturalMeasureWidth(measureColumns[j]);
      shouldBreak = lineCols.length > 0 && lineW + mw > cap;
      if (shouldBreak) {
        flushLine();
        lineW = 0;
      }
      measureLineIndex[j] = scoreLines.length;
      for (const col of measureColumns[j]) lineCols.push(col);
      lineW += mw;
      continue;
    }
    if (shouldBreak) flushLine();
    measureLineIndex[j] = scoreLines.length;
    for (const col of measureColumns[j]) lineCols.push(col);
  }
  flushLine();
  return { scoreLines, measureLineIndex };
}

const UNDERLINE_HALF = 5;

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

function underlineLayerY(level, LAYER) {
  if (level <= 1) return LAYER.underline1;
  if (level === 2) return LAYER.underline2;
  return LAYER.underline2 + (level - 2) * 3;
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

const LAYOUT_MIN_GAP = 18;
const LAYOUT_LYRIC_PAD = 6;
const LAYOUT_BAR_W = 12;
const LAYOUT_DOT_PAD = 8;

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
function appendJianpuBarline(parent, x, y, style, ink, yTop, yBottom) {
  const y1 = y + yTop;
  const y2 = y + yBottom;
  if (style === "light-heavy") {
    parent
      .append("line")
      .attr("class", "barline barline-final")
      .attr("x1", x - 2.5)
      .attr("x2", x - 2.5)
      .attr("y1", y1)
      .attr("y2", y2)
      .attr("stroke", ink)
      .attr("stroke-width", 1);
    parent
      .append("line")
      .attr("class", "barline barline-final")
      .attr("x1", x + 1.5)
      .attr("x2", x + 1.5)
      .attr("y1", y1)
      .attr("y2", y2)
      .attr("stroke", ink)
      .attr("stroke-width", 2.8);
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
    .attr("stroke-width", 1);
}

const OCTAVE_DOT_R = 1.5;
const NOTE_ASCENT = 12;
const NOTE_DESCENT = 4;

/**
 * 小节线高度：上至全文最高音点，下至全文最低音点；不超过延音线/连线。
 */
function barlineYOffsets(measureColumns, divisions, LAYER) {
  let hasUpper = false;
  let hasLower = false;
  let maxUl = 0;
  for (const cols of measureColumns) {
    for (const col of cols) {
      if (col.kind !== "note") continue;
      const oct = Number(col.number?.octave) || 4;
      if (oct >= 5) hasUpper = true;
      if (oct <= 3) hasLower = true;
      maxUl = Math.max(
        maxUl,
        underlineCount(col.note, col.number?.dur, divisions)
      );
    }
  }
  let yTop = -NOTE_ASCENT;
  if (hasUpper) yTop = LAYER.upperOctave - OCTAVE_DOT_R;
  yTop = Math.max(yTop, LAYER.tie + 2);

  let yBottom = NOTE_DESCENT;
  if (maxUl > 0) yBottom = Math.max(yBottom, underlineLayerY(maxUl, LAYER));
  if (hasLower) yBottom = Math.max(yBottom, LAYER.lowerOctave + OCTAVE_DOT_R);
  return { yTop, yBottom };
}

function noteHasAugmentationDot(note) {
  return note != null && note.dot != null && note.dot !== false;
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
function applyContentLineWidths(scoreLines) {
  let maxLineW = LAYOUT_MIN_GAP;

  for (const line of scoreLines) {
    line.segments = segmentLineByBars(line.columns);
    let x = 0;
    for (const seg of line.segments) {
      x += MEASURE_INSET;
      for (const col of seg) {
        if (col.kind === "bar") {
          x += MEASURE_INSET;
          col.w = LAYOUT_BAR_W;
          col.cx = x + LAYOUT_BAR_W / 2;
          x += LAYOUT_BAR_W;
          continue;
        }
        if (col.kind !== "note" && col.kind !== "extend") continue;
        const minW = Number(col.w) || LAYOUT_MIN_GAP;
        col.w = minW;
        col.cx = x + minW / 2;
        x += minW;
      }
    }
    line.width = Math.max(LAYOUT_MIN_GAP, x);
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

function extractMeta(score, partAttr, measures) {
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
  const keyName = keyNameFromFifths(fifths);
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
 * PDF 用：在 SVG 里画调号/拍号/速度/署名。
 * @param {d3.Selection} parent
 * @param {object} meta
 * @param {{ left: number, right: number, canvasWidth: number, fallbackLeft?: number, fallbackRight?: number }} geom
 * @returns {d3.Selection} metaRow
 */
function drawScoreMeta(parent, meta, geom) {
  const ink = scoreInk();
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
  const metaLineGap = 18;
  const metaMinGap = 28;
  const pagePad = 16;
  const authorLines = meta.authorLines || [];
  const hasMoodTempo = !!(meta.tempo || meta.expression);

  const metaRow = parent.append("g").attr("class", "score-meta-svg").attr("fill", ink);
  const metaLeft = metaRow.append("g").attr("transform", `translate(${bodyLeft},0)`);
  const metaLeftInner = metaLeft.append("g");
  const keyTimeG = metaLeftInner.append("g");
  const moodTempoG = metaLeftInner.append("g");

  let metaX = 0;
  const keyFs = 16;
  const keyBaseline = keyFs * 0.36;

  const keyG = keyTimeG.append("g").attr("transform", `translate(${metaX},0)`);
  const keyPrefix = keyG
    .append("text")
    .attr("x", 0)
    .attr("y", keyBaseline)
    .attr("font-size", keyFs)
    .text("1=");
  let keyCursor = keyPrefix.node()?.getComputedTextLength?.() || 18;
  if (meta.keyName.startsWith("b") || meta.keyName.startsWith("#")) {
    const accidental = meta.keyName[0];
    const letter = meta.keyName.slice(1);
    keyG
      .append("text")
      .attr("x", keyCursor)
      .attr("y", keyBaseline - 8)
      .attr("font-size", 11)
      .text(accidental);
    const letterNode = keyG
      .append("text")
      .attr("x", keyCursor + 6)
      .attr("y", keyBaseline)
      .attr("font-size", keyFs)
      .text(letter);
    keyCursor += 6 + (letterNode.node()?.getComputedTextLength?.() || 10);
  } else {
    const letterNode = keyG
      .append("text")
      .attr("x", keyCursor)
      .attr("y", keyBaseline)
      .attr("font-size", keyFs)
      .text(meta.keyName);
    keyCursor += letterNode.node()?.getComputedTextLength?.() || 10;
  }
  metaX += keyCursor + 18;

  const timeFs = 13;
  const timeGap = 3;
  const timeCap = timeFs * 0.72;
  const timeG = keyTimeG.append("g").attr("transform", `translate(${metaX},0)`);
  timeG
    .append("text")
    .attr("text-anchor", "middle")
    .attr("x", 0)
    .attr("y", -timeGap)
    .attr("font-size", timeFs)
    .attr("font-weight", "600")
    .text(meta.beats);
  timeG
    .append("line")
    .attr("x1", -9)
    .attr("x2", 9)
    .attr("y1", 0)
    .attr("y2", 0)
    .attr("stroke", ink)
    .attr("stroke-width", 1.2);
  timeG
    .append("text")
    .attr("text-anchor", "middle")
    .attr("x", 0)
    .attr("y", timeGap + timeCap)
    .attr("font-size", timeFs)
    .attr("font-weight", "600")
    .text(meta.beatType);
  metaX += 22;
  const keyTimeEndX = metaX;

  const tempoFs = 15;
  const tempoBaseline = tempoFs * 0.36;
  const moodTempoGap = 14;
  let moodCursor = 0;
  if (meta.tempo) {
    const noteG = moodTempoG
      .append("g")
      .attr("transform", `translate(${moodCursor + 5},0)`);
    noteG
      .append("ellipse")
      .attr("cx", 0)
      .attr("cy", 2)
      .attr("rx", 5)
      .attr("ry", 3.6)
      .attr("transform", "rotate(-25)")
      .attr("fill", ink);
    noteG
      .append("line")
      .attr("x1", 4.2)
      .attr("y1", 2)
      .attr("x2", 4.2)
      .attr("y2", -12)
      .attr("stroke", ink)
      .attr("stroke-width", 1.5)
      .attr("stroke-linecap", "round");
    const tempoText = moodTempoG
      .append("text")
      .attr("x", moodCursor + 14)
      .attr("y", tempoBaseline)
      .attr("font-size", tempoFs)
      .text(`=${meta.tempo}`);
    moodCursor +=
      14 + (tempoText.node()?.getComputedTextLength?.() || 36) + moodTempoGap;
  }
  if (meta.expression) {
    moodTempoG
      .append("text")
      .attr("x", moodCursor)
      .attr("y", tempoBaseline)
      .attr("font-size", tempoFs)
      .text(meta.expression);
  }

  function layoutMetaLeft(stacked) {
    if (stacked && hasMoodTempo) {
      keyTimeG.attr("transform", "translate(0,0)");
      moodTempoG.attr("transform", "translate(0,0)");
      const keyBox = keyTimeG.node().getBBox();
      const moodBox = moodTempoG.node().getBBox();
      const clearance = 5;
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

  const creditFs = 14;
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
      .attr("y", centerY + creditFs * 0.35)
      .attr("font-size", creditFs)
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
      const creditStackGap = 12;
      const creditY = leftBox.y + leftBox.height + creditStackGap - creditBox.y;
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
 * 可被 Vue 组件调用的初始化函数。
 * @param {SVGSVGElement} svgElement - 宿主 <svg> 节点
 * @param {string} [url] - musicxml 资源 URL 或 XML 字符串
 * @param {{ width?: number, hideTitle?: boolean, hideMeta?: boolean, columns?: number, autoColumns?: boolean, viewportWidth?: number, viewportHeight?: number, maxColumnWidth?: number, contentPadX?: number, lineBreak?: 'auto' | 'musicxml' | number, firstColumnHeaderH?: number }} [options]
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
  const ink = scoreInk();
  const { score, measures, partAttr } = normalizeScore(musicJson);
  if (!partAttr) {
    throw new Error("缺少 attributes（调号/拍号/divisions）");
  }

  const meta = extractMeta(score, partAttr, measures);
  const height =
    window.innerHeight ||
    document.documentElement.clientHeight ||
    document.body.clientHeight;
  const svg = d3.select(svgElement || "svg");
  // 先算正文所需宽度，再决定排版宽（窄屏不压缩，交由横向滚动）
  const g = svg.append("g").attr("fill", ink);

  // 排版：按唱名/歌词自然宽从左排布；换行方式只决定断点
  // 正文相对唱名基线的固定分层（有则画在该层，无则不塌缩）
  const LAYER = {
    tupletTop: -31,
    tupletLeg: -28,
    tie: -23,
    upperOctave: -18,
    note: 0,
    underline1: 5,
    underline2: 8,
    lowerOctave: 13,
    lyric: 34,
  };
  var lyricOffset = LAYER.lyric; // 组内：唱名基线 → 歌词
  var eachHeight = 100; // 组高（含组间空隙）
  var marginLeft = 100; //左边距（随后按正文宽度居中）
  var titleY = 28;
  var titleFontSize = 28;
  var sectionGap = 24; // 标题↔元信息、元信息↔正文（视觉等距）
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

  for (const cols of measureColumns) {
    for (const col of cols) {
      if (col.kind === "bar") {
        col.w = LAYOUT_BAR_W;
      } else if (col.kind === "extend") {
        col.w = LAYOUT_MIN_GAP;
      } else {
        const noteLabel =
          col.number.text.length > 1
            ? col.number.text.replace(/^#/, "")
            : col.number.text;
        const noteW =
          measureTextWidth(measureHost, noteLabel, { fontSize: 16 }) +
          (col.number.text.startsWith("#") ? 8 : 0);
        const lyricW = measureTextWidth(measureHost, col.lyric, {
          fontSize: 14,
          fontWeight: "bold",
        });
        const dotted =
          noteHasAugmentationDot(col.note) && col.number.dur < 2 * divisions;
        col.w =
          Math.max(LAYOUT_MIN_GAP, noteW, lyricW + LAYOUT_LYRIC_PAD) +
          (dotted ? LAYOUT_DOT_PAD : 0);
      }
    }
  }
  measureHost.remove();

  const barY = barlineYOffsets(measureColumns, divisions, LAYER);

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
  const { scoreLines, measureLineIndex } = groupMeasureColumnsIntoLines(
    measureColumns,
    measures,
    lineBreakMode,
    breakInnerW
  );

  for (let j = 0; j < measures.length; j++) {
    const lineIndex = measureLineIndex[j] ?? 0;
    for (const layout of noteLayout[j] || []) {
      if (layout) layout.lineIndex = lineIndex;
    }
  }

  const contentWidth = applyContentLineWidths(scoreLines);
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
  const columnSlotW = colCap || naturalColumnW;
  const columnCount = resolveColumnCount(
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
  if (colCap) {
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
  const innerW = colCap ? Math.max(1, columnSlotW - 2 * fitPad) : scaledColW;
  const colContentPad = colCap
    ? fitPad + (innerW - scaledColW) / 2
    : Math.max(0, (width - scaledColW) / 2);
  const columnInnerW = columnSlotW;
  const bodyMetaX = colContentPad;
  const bodyMetaW = scaledColW;
  const slotMetaX = colCap ? fitPad : 0;
  const slotMetaW = innerW;
  // 首屏用纸张列槽，避免短谱把调号行挤坏；屏幕侧量完再决定是否改回正文宽
  const firstColumnX = slotMetaX;
  const firstColumnW = slotMetaW;

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

        const noteNumberIs = d3
          .select(this)
          .append("text")
          .attr("text-anchor", "middle")
          .attr("transform", `translate(${cx},${cy + LAYER.note})`);
        if (number.text.length == 1) noteNumberIs.text(number.text);
        else {
          noteNumberIs
            .append("tspan")
            .attr("baseline-shift", "super")
            .attr("dy", () => (number.text[0] == "#" ? 8 : 4))
            .attr("font-size", 12)
            .attr("dx", -5)
            .text(number.text[0]);
          noteNumberIs
            .append("tspan")
            .attr("dy", () => (number.text[0] == "#" ? -8 : -4))
            .text(number.text[1]);
        }

        if (noteHasAugmentationDot(d) && number.dur < 2 * divisions) {
          const textNode = noteNumberIs.node();
          const lastChar = Math.max(0, (textNode.getNumberOfChars?.() || 1) - 1);
          let right = 4.5;
          try {
            const extent = textNode.getExtentOfChar(lastChar);
            right = extent.x + extent.width;
          } catch {
            /* keep fallback */
          }
          const r = 1.35;
          const gap = LAYER.underline1 - LAYER.note;
          d3.select(this)
            .append("circle")
            .attr("class", "aug-dot")
            .attr("cx", cx + right + gap)
            .attr("cy", cy + LAYER.note - r * 0.35)
            .attr("r", r)
            .attr("fill", ink);
        }

        const lyric = layout.noteCol.lyric;
        if (lyric) {
          d3.select(this)
            .append("text")
            .attr("text-anchor", "middle")
            .attr("font-weight", "bold")
            .attr("font-size", 14)
            .attr("transform", `translate(${cx},${cy + LAYER.lyric})`)
            .text(lyric);
        }

        if (number.dur > divisions) {
          for (const ex of layout.extendCxs) {
            const exX = bodyXY(lineIndex, ex).x;
            d3.select(this)
              .append("text")
              .attr("transform", `translate(${exX},${cy + LAYER.note})`)
              .attr("font-weight", number.text == "0" ? "normal" : "bold")
              .attr("text-anchor", "middle")
              .text(number.text == "0" ? "0" : "-");
          }
        }

        if (number.octave == 3) {
          d3.select(this)
            .append("circle")
            .attr("transform", `translate(${cx},${cy})`)
            .attr("cx", 0)
            .attr("cy", LAYER.lowerOctave)
            .attr("r", 1.5)
            .attr("fill", ink);
        } else if (number.octave == 5) {
          d3.select(this)
            .append("circle")
            .attr("transform", `translate(${cx},${cy})`)
            .attr("cx", 0)
            .attr("cy", LAYER.upperOctave)
            .attr("r", 1.5)
            .attr("fill", ink);
        }

        if (number.tied) {
          if (tiePath[0] == -1) {
            tiePath[0] = cx;
            tiePath[1] = cy + LAYER.tie;
          } else if (tiePath[2] == -1) {
            tiePath[2] = cx;
            tiePath[3] = cy + LAYER.tie;
            if (Math.abs(tiePath[3] - tiePath[1]) < 20) {
              d3.select(this)
                .append("path")
                .attr("fill", "none")
                .attr("stroke", ink)
                .attr("stroke-width", 1)
                .attr("d", pathTied(tiePath));
              tiePath[0] = -1;
              tiePath[2] = -1;
            } else {
              const path1 = [
                tiePath[0],
                tiePath[1],
                tiePath[0] + TIE_HOOK_PX,
                tiePath[1],
              ];
              const path2 = [
                tiePath[2] - TIE_HOOK_PX,
                tiePath[3],
                tiePath[2],
                tiePath[3],
              ];
              d3.select(this)
                .append("path")
                .attr("fill", "none")
                .attr("stroke", ink)
                .attr("stroke-width", 1)
                .attr("d", pathTied(path1));
              d3.select(this)
                .append("path")
                .attr("fill", "none")
                .attr("stroke", ink)
                .attr("stroke-width", 1)
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
              .attr("stroke-width", "1px")
              .attr("transform", `translate(${cx},${cy})`)
              .attr(
                "d",
                `M ${leftX} ${LAYER.tupletLeg} L ${leftX} ${LAYER.tupletTop} L ${rightX} ${LAYER.tupletTop} L ${rightX} ${LAYER.tupletLeg}`
              );
            d3.select(this)
              .append("text")
              .attr("font-size", 10)
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
      const y = underlineLayerY(levelIdx + 1, LAYER);
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
        const x1 = Math.min(...xs) - UNDERLINE_HALF;
        const x2 = Math.max(...xs) + UNDERLINE_HALF;
        colGroups[lineCol]
          .append("line")
          .attr("class", "jianpu-underline")
          .attr("x1", x1)
          .attr("x2", x2)
          .attr("y1", cy + y)
          .attr("y2", cy + y)
          .attr("stroke", ink)
          .attr("stroke-width", 1);
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
        barY.yBottom
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
      const ruleTop = bodyBox.y + 4;
      const ruleBottom = Math.min(
        bodyBox.y + bodyBox.height - 4,
        ((usedLines - 1) * eachHeight + lyricOffset + 16) * bodyScale
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
        .attr("stroke", scoreGuide())
        .attr("stroke-width", 1)
        .attr("stroke-linecap", "round");
    }
  }

  const metaLeftX = bodyMetaX;
  const metaRightX = bodyMetaX + bodyMetaW;

  if (titleEl) {
    titleEl.attr("transform", `translate(${scoreCenterX},${titleY})`);
  }

  let titleBottom = 0;
  if (titleEl) {
    const titleBox = titleEl.node().getBBox();
    titleBottom = titleY + titleBox.y + titleBox.height;
  }

  let metaBottom = hideMeta ? 0 : titleBottom;
  if (!hideMeta) {
    const metaRow = drawScoreMeta(g, meta, {
      left: metaLeftX,
      right: metaRightX,
      fallbackLeft: slotMetaX,
      fallbackRight: slotMetaX + slotMetaW,
      canvasWidth: width,
    });
    const metaBox = metaRow.node().getBBox();
    const gapAfterTitle = hideTitle ? 12 : sectionGap;
    const metaTranslateY = titleBottom + gapAfterTitle - metaBox.y;
    metaRow.attr("transform", `translate(0,${metaTranslateY})`);
    metaBottom = metaTranslateY + metaBox.y + metaBox.height;
  }

  const topPad = hideMeta ? 8 : metaBottom + sectionGap;
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
    if(p[1] > p[3] && p[1] - p[3] < 20)
      p[3] = p[1];
    else if(p[3] > p[1] && p[3] - p[1] < 20) 
      p[1] = p[3];
    var dx = p[2] - p[0];
    return `M ${p[0]} ${p[1]} C ${p[0]+dx/4} ${p[1]-4} ${p[2]-dx/4} ${p[1]-4} ${p[2]} ${p[1]}`;
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
    const fifths = Number(partAttr.key?.fifths) || 0;
    const sig = keySigAlter(fifths);
    // 显式 alter 优先；否则用调号默认升降
    let pitchAlter = 0;
    if (note.pitch.alter != undefined) {
      pitchAlter = Number(note.pitch.alter);
    } else {
      pitchAlter = sig[step] || 0;
    }
    const soundingSemitone = ((naturalSemitone + pitchAlter) % 12 + 12) % 12;
    const pitchOctave = Number(note.pitch.octave);
    const midi = (pitchOctave + 1) * 12 + soundingSemitone;

    const tonicStep = tonicFromFifths(fifths);
    let tonicNatural = 0;
    for (let i = 0; i < step2num.length; i++) {
      if (step2num[i].step == tonicStep) {
        tonicNatural = step2num[i].num;
        break;
      }
    }
    const tonicSemitone = ((tonicNatural + (sig[tonicStep] || 0)) % 12 + 12) % 12;
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
      lyricOffset: lyricOffset * bodyScale,
      lineCount: scoreLines.length,
      columns: columnCount,
      columnInnerW,
      columnGap: COLUMN_GAP,
      bodyScale,
      naturalColumnW,
      firstColumnX,
      firstColumnW,
      firstColumnHeaderH,
      bodyMetaX,
      bodyMetaW,
      slotMetaX,
      slotMetaW,
    },
  };
}