import { select } from "d3-selection";
import { asArray, getParseCache, normalizeScore } from "./parse.js";
import {
  appendOctaveDots,
  lowerOctaveDotCount,
  upperOctaveDotCount,
} from "./glyphs.js";

const d3 = { select };

/**
 * 最近一次屏幕全量绘制，供移调就地改唱名。
 * PDF / forceLight 不写入。
 * @type {null | {
 *   svg: SVGSVGElement,
 *   parsed: object,
 *   maxUpper: number,
 *   maxLower: number,
 *   metrics: object,
 *   LAYER: object,
 *   ink: string,
 *   noteEls: Array<{el: SVGGElement, j: number, i: number, cx: number, cy: number, underlineN: number}>,
 *   meta: object,
 *   layout: object,
 * }}
 */
let pitchPaint = null;

export function setPitchPaint(value) {
  pitchPaint = value;
}

export function clearPitchPaintForSvg(svgElement) {
  if (pitchPaint && pitchPaint.svg === svgElement) {
    pitchPaint = null;
  }
}

const STEP_LIST = ["1", "#1", "2", "#2", "3", "4", "#4", "5", "#5", "6", "#6", "7"];
const STEP2NUM = [
  { step: "C", num: 0 },
  { step: "D", num: 2 },
  { step: "E", num: 4 },
  { step: "F", num: 5 },
  { step: "G", num: 7 },
  { step: "A", num: 9 },
  { step: "B", num: 11 },
];
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
const TONIC_FROM_FIFTHS = {
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

function keySigAlter(fifths) {
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const n = Number(fifths) || 0;
  if (n > 0) {
    for (let i = 0; i < n && i < 7; i++) map[SHARP_ORDER[i]] = 1;
  } else if (n < 0) {
    for (let i = 0; i < -n && i < 7; i++) map[FLAT_ORDER[i]] = -1;
  }
  return map;
}

function tonicFromFifths(fifths) {
  return TONIC_FROM_FIFTHS[String(fifths)] || "C";
}

function stepNatural(step) {
  for (let i = 0; i < STEP2NUM.length; i++) {
    if (STEP2NUM[i].step == step) return STEP2NUM[i].num;
  }
  return 0;
}

export function note2number(note, partAttr, options = {}) {
  const number = { text: "0", tied: 0, octave: 4, dur: 0 };
  const notations = note.notations;
  const hasTied =
    notations != null &&
    (notations.tied != null ||
      asArray(notations).some((item) => item && item.tied != null));
  number.tied = hasTied ? 1 : 0;
  if (note.rest != undefined) {
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
  const naturalSemitone = stepNatural(step);
  const originalFifths = Number(partAttr.key?.fifths) || 0;
  const sig = keySigAlter(originalFifths);
  let pitchAlter = 0;
  if (note.pitch.alter != undefined) {
    pitchAlter = Number(note.pitch.alter);
  } else {
    pitchAlter = sig[step] || 0;
  }
  const soundingSemitone = ((naturalSemitone + pitchAlter) % 12 + 12) % 12;
  const pitchOctave = Number(note.pitch.octave);
  const transposeSemitones = Number(options.transposeSemitones) || 0;
  const midi = (pitchOctave + 1) * 12 + soundingSemitone + transposeSemitones;

  const numberingFifths = options.fixedDo ? 0 : originalFifths;
  const numberingSig = keySigAlter(numberingFifths);
  const tonicStep = tonicFromFifths(numberingFifths);
  const tonicNatural = stepNatural(tonicStep);
  const tonicSemitone =
    ((tonicNatural + (numberingSig[tonicStep] || 0)) % 12 + 12) % 12;
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
  number.text = STEP_LIST[degreeSemis] || "0";
  return number;
}

export function packRenderResult(xmlString, rendered, extra = {}) {
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
    layout: rendered?.layout || extra.layout || null,
    ...extra,
  };
}

function updateNotePitch(parent, cx, cy, number, metrics, LAYER, ink, underlineN) {
  const host = d3.select(parent);
  host.selectAll("text.jianpu-accidental").remove();
  host.selectAll("circle.octave-dot").remove();
  const digitSel = host.select("text.jianpu-digit");
  if (digitSel.empty()) return;

  const text = number.text || "";
  if (!text || text.length <= 1) {
    digitSel.text(text);
  } else {
    const accidental = text[0];
    const digit = text.slice(1);
    const lift =
      accidental === "#" ? metrics.accidentalDy : metrics.naturalDy;
    digitSel.text(digit);
    let digitLeft = -metrics.bodySize * 0.3;
    try {
      const extent = digitSel.node().getExtentOfChar(0);
      digitLeft = extent.x;
    } catch {
      /* fallback */
    }
    host
      .append("text")
      .attr("class", "jianpu-accidental")
      .attr("text-anchor", "end")
      .attr("font-size", metrics.bodySize)
      .attr("x", cx + digitLeft)
      .attr("y", cy + LAYER.note - lift)
      .text(accidental);
  }

  appendOctaveDots(
    parent,
    cx,
    cy,
    number.octave,
    LAYER,
    metrics,
    ink,
    digitSel,
    underlineN
  );
}

export function tryUpdatePitch(svgElement, options) {
  if (!pitchPaint || pitchPaint.svg !== svgElement || !getParseCache().parsed) {
    return null;
  }
  const { measures, partAttr } = normalizeScore(getParseCache().parsed);
  const numbers = [];
  let maxUpper = 0;
  let maxLower = 0;
  for (let j = 0; j < measures.length; j++) {
    const notes = measures[j].note;
    numbers[j] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = note2number(notes[i], partAttr, options);
      numbers[j][i] = n;
      maxUpper = Math.max(maxUpper, upperOctaveDotCount(n.octave));
      maxLower = Math.max(maxLower, lowerOctaveDotCount(n.octave));
    }
  }
  if (maxUpper > pitchPaint.maxUpper || maxLower > pitchPaint.maxLower) {
    return null;
  }

  const { metrics, LAYER, ink, noteEls } = pitchPaint;
  for (const item of noteEls) {
    const n = numbers[item.j]?.[item.i];
    if (!n) continue;
    updateNotePitch(
      item.el,
      item.cx,
      item.cy,
      n,
      metrics,
      LAYER,
      ink,
      item.underlineN
    );
  }

  const originalKeyName = pitchPaint.meta.originalKeyName || "C";
  const rendered = {
    ...pitchPaint.meta,
    keyName: options.fixedDo ? "C" : originalKeyName,
    layout: pitchPaint.layout,
  };
  return packRenderResult(getParseCache().xmlString, rendered, { pitchUpdated: true });
}
