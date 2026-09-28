/* eslint-disable no-unused-vars */
import { asArray, isPlaceholder, textOf } from "./parse.js";
import { scoreInk } from "./glyphs.js";

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

export function findMeasureMetronome(measure) {
  for (const direction of asArray(measure?.direction)) {
    const types = asArray(direction["direction-type"]);
    for (const t of types) {
      const perMinute = t?.metronome?.["per-minute"];
      if (perMinute != null && perMinute !== "") return String(perMinute);
    }
    const sound = direction.sound;
    if (sound != null) {
      const tempo = sound["@_tempo"] ?? sound.tempo;
      if (tempo != null && tempo !== "") return String(tempo);
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

export function extractMeta(score, partAttr, measures, options = {}) {
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
  let artist = "";
  for (const creator of creators) {
    const value = textOf(creator);
    if (isPlaceholder(value)) continue;
    if (creator["@_type"] === "lyricist") lyricist = value;
    if (creator["@_type"] === "composer") composer = value;
    if (creator["@_type"] === "translator") translator = value;
    if (creator["@_type"] === "artist") artist = value;
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
    artist,
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
          /作编曲|作曲/.test(meta.composer)
            ? meta.composer
            : `作曲 ${meta.composer}`
        )
      : "",
    meta.artist
      ? formatCreditLine(
          /歌|演唱/.test(meta.artist) ? meta.artist : `歌 ${meta.artist}`
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
 * 四分音符（椭圆符头 + 符干）。不用 Unicode ♩，避免 PDF WinAnsi 把 U+2669 拆成 &i。
 * @returns {number} 音符左缘到文字起点的推进宽度
 */
export function appendTempoNote(parent, x, y, metrics, ink) {
  const s = metrics.s;
  const noteG = parent
    .append("g")
    .attr("transform", `translate(${x + 5 * s},${y})`);
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
  return 14 * s;
}

/**
 * PDF 用：在 SVG 里画调号/拍号/速度/署名。
 * @param {d3.Selection} parent
 * @param {object} meta
 * @param {{ left: number, right: number, canvasWidth: number, fallbackLeft?: number, fallbackRight?: number }} geom
 * @returns {d3.Selection} metaRow
 */
export function drawScoreMeta(parent, meta, geom, metrics, inkColor) {
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
    const noteAdvance = appendTempoNote(moodTempoG, moodCursor, 0, metrics, ink);
    const tempoText = moodTempoG
      .append("text")
      .attr("x", moodCursor + noteAdvance)
      .attr("y", tempoBaseline)
      .attr("font-size", metaFs)
      .text(`=${meta.tempo}`);
    moodCursor +=
      noteAdvance +
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
