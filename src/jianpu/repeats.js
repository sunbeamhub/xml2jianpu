import { asArray, textOf } from "./parse.js";

function attrOf(node, name) {
  if (node == null || typeof node !== "object") return undefined;
  return node[`@_${name}`] ?? node[name];
}

/** 跳转类文字（D.C.、D.S.、Fine、To Coda、Coda）；其余演奏术语不在简谱里画 */
const JUMP_WORDS =
  /^(d\.?\s?c\.?|d\.?\s?s\.?|da\s+capo|dal\s+segno|fine\b|to\s+coda|al\s+coda|coda\b)/i;

/** 房子编号：文字是纯数字时（解析器会把「1.」读成数字 1）按 number 属性写成「1.」「1.2.」 */
function endingLabel(ending) {
  const shown = String(textOf(ending) ?? "").trim();
  if (shown && !/^[\d\s,.]+$/.test(shown)) return shown;
  const nums = String(attrOf(ending, "number") ?? shown)
    .split(/[\s,.]+/)
    .filter(Boolean);
  return nums.length ? `${nums.join(".")}.` : "";
}

/**
 * 每小节的反复与跳转记号，供简谱绘制。
 * @param {object[]} measures
 */
export function readRepeatMarks(measures) {
  const marks = (measures || []).map(() => ({
    forward: false,
    backward: false,
    segno: false,
    coda: false,
    /** @type {string[]} 小节末尾右对齐的文字 */
    endTexts: [],
    /** @type {string[]} 小节开头的文字（如 Coda 段标题） */
    startTexts: [],
  }));
  /** @type {Array<{ start: number, end: number, label: string, closed: boolean }>} */
  const endings = [];
  let open = null;
  (measures || []).forEach((measure, j) => {
    const mark = marks[j];
    for (const bar of asArray(measure?.barline)) {
      const direction = attrOf(bar?.repeat, "direction");
      if (direction === "forward") mark.forward = true;
      if (direction === "backward") mark.backward = true;
      const ending = bar?.ending;
      const type = attrOf(ending, "type");
      if (type === "start") {
        if (open) endings.push({ ...open, end: Math.max(open.start, j - 1), closed: false });
        open = { start: j, label: endingLabel(ending) };
      }
      if ((type === "stop" || type === "discontinue") && open) {
        endings.push({ ...open, end: j, closed: type === "stop" });
        open = null;
      }
    }

    let hasDcWords = false;
    let hasDsWords = false;
    let hasFineWords = false;
    let hasToCodaWords = false;
    for (const direction of asArray(measure?.direction)) {
      for (const t of asArray(direction?.["direction-type"])) {
        if (t?.segno != null) mark.segno = true;
        if (t?.coda != null) mark.coda = true;
        for (const w of asArray(t?.words)) {
          const words = textOf(w).trim();
          if (!words || !JUMP_WORDS.test(words)) continue;
          const lower = words.toLowerCase();
          if (/^d\.?\s?c|^da\s+capo/.test(lower)) hasDcWords = true;
          if (/^d\.?\s?s|^dal\s+segno/.test(lower)) hasDsWords = true;
          if (/^fine/.test(lower)) hasFineWords = true;
          if (/^to\s+coda|^al\s+coda/.test(lower)) hasToCodaWords = true;
          if (/^coda\b/.test(lower)) mark.startTexts.push(words);
          else mark.endTexts.push(words);
        }
      }
    }
    const sounds = [...asArray(measure?.sound)];
    for (const direction of asArray(measure?.direction)) sounds.push(...asArray(direction?.sound));
    for (const sound of sounds) {
      if (String(attrOf(sound, "dacapo") ?? "") === "yes" && !hasDcWords) {
        mark.endTexts.push("D.C.");
        hasDcWords = true;
      }
      if (attrOf(sound, "dalsegno") != null && !hasDsWords) {
        mark.endTexts.push("D.S.");
        hasDsWords = true;
      }
      if (attrOf(sound, "fine") != null && !hasFineWords) {
        mark.endTexts.push("Fine");
        hasFineWords = true;
      }
      if (attrOf(sound, "tocoda") != null && !hasToCodaWords) {
        mark.endTexts.push("To Coda");
        hasToCodaWords = true;
      }
      if (attrOf(sound, "segno") != null) mark.segno = true;
      if (attrOf(sound, "coda") != null) mark.coda = true;
    }
  });
  if (open) endings.push({ ...open, end: (measures?.length || 1) - 1, closed: false });
  return { marks, endings };
}

/**
 * 小节 j 右侧小节线样式：后反复 :‖、下一小节前反复 ‖:、二者兼有 :‖:。
 * nextOnSameLine 为 false 时前反复画在下一行行首，这里不管。
 */
export function repeatBarStyle(marks, j, baseStyle, nextOnSameLine) {
  const end = !!marks[j]?.backward;
  const start = !!(nextOnSameLine && marks[j + 1]?.forward);
  if (end && start) return "repeat-both";
  if (end) return "repeat-end";
  if (start) return "repeat-start";
  return baseStyle;
}

export function hasRepeatDecor(repeatInfo) {
  if (!repeatInfo) return false;
  if (repeatInfo.endings.length) return true;
  return repeatInfo.marks.some(
    (m) => m.segno || m.coda || m.endTexts.length || m.startTexts.length
  );
}

/** 房子括线、跳转文字所在高度（相对唱名基线，向上为负） */
export function repeatDecorY(LAYER, metrics, barYTop) {
  const top = Math.min(barYTop, LAYER.tie - metrics.tieCurve, LAYER.tupletTop);
  return top - metrics.voltaGap;
}

/**
 * 房子：横线在上，起点竖线下折；closed 时终点也下折。
 * @param {object} parent d3 selection
 */
export function appendVolta(parent, x0, x1, y, opts, ink, metrics) {
  const { label, hookStart, hookEnd } = opts;
  const g = parent.append("g").attr("class", "jianpu-volta");
  const legY = y + metrics.voltaHook;
  let d = hookStart ? `M ${x0} ${legY} L ${x0} ${y}` : `M ${x0} ${y}`;
  d += ` L ${x1} ${y}`;
  if (hookEnd) d += ` L ${x1} ${legY}`;
  g.append("path")
    .attr("d", d)
    .attr("fill", "none")
    .attr("stroke", ink)
    .attr("stroke-width", metrics.barlineStroke);
  if (label && hookStart) {
    g.append("text")
      .attr("x", x0 + metrics.voltaLabelDx)
      .attr("y", y + metrics.voltaLabelSize * 0.95)
      .attr("font-size", metrics.voltaLabelSize)
      .attr("fill", ink)
      .text(label);
  }
  return g;
}

/** 跳转文字：斜体；anchor 为 start/end */
export function appendJumpText(parent, x, y, text, anchor, ink, metrics) {
  return parent
    .append("text")
    .attr("class", "jianpu-jump")
    .attr("x", x)
    .attr("y", y)
    .attr("text-anchor", anchor)
    .attr("font-size", metrics.jumpTextSize)
    .attr("font-style", "italic")
    .attr("font-weight", "bold")
    .attr("fill", ink)
    .text(text);
}

/** Segno（𝄋）：S 形曲线 + 斜线 + 两点。x 为左缘，y 为底边。返回宽度 */
export function appendSegno(parent, x, y, ink, metrics) {
  const h = metrics.jumpSymbolSize;
  const w = h * 0.62;
  const px = (u) => x + u * w;
  const py = (v) => y - h + v * h;
  const g = parent.append("g").attr("class", "jianpu-segno");
  g.append("path")
    .attr(
      "d",
      `M ${px(0.86)} ${py(0.2)} C ${px(0.76)} ${py(-0.02)} ${px(0.14)} ${py(0.02)} ${px(0.2)} ${py(0.3)}` +
        ` C ${px(0.26)} ${py(0.52)} ${px(0.8)} ${py(0.46)} ${px(0.8)} ${py(0.72)}` +
        ` C ${px(0.8)} ${py(1.02)} ${px(0.2)} ${py(1)} ${px(0.12)} ${py(0.8)}`
    )
    .attr("fill", "none")
    .attr("stroke", ink)
    .attr("stroke-width", metrics.jumpSymbolStroke);
  g.append("line")
    .attr("x1", px(0.04))
    .attr("y1", py(0.96))
    .attr("x2", px(0.96))
    .attr("y2", py(0.04))
    .attr("stroke", ink)
    .attr("stroke-width", metrics.barlineStroke);
  for (const [u, v] of [
    [0.1, 0.48],
    [0.9, 0.52],
  ]) {
    g.append("circle")
      .attr("cx", px(u))
      .attr("cy", py(v))
      .attr("r", metrics.octaveDotR)
      .attr("fill", ink);
  }
  return w;
}

/** Coda（𝄌）：椭圆 + 穿出的十字。x 为左缘，y 为底边。返回宽度 */
export function appendCoda(parent, x, y, ink, metrics) {
  const h = metrics.jumpSymbolSize;
  const w = h * 0.9;
  const cx = x + w / 2;
  const cy = y - h / 2;
  const g = parent.append("g").attr("class", "jianpu-coda");
  g.append("ellipse")
    .attr("cx", cx)
    .attr("cy", cy)
    .attr("rx", w * 0.3)
    .attr("ry", h * 0.36)
    .attr("fill", "none")
    .attr("stroke", ink)
    .attr("stroke-width", metrics.jumpSymbolStroke);
  g.append("line")
    .attr("x1", x)
    .attr("x2", x + w)
    .attr("y1", cy)
    .attr("y2", cy)
    .attr("stroke", ink)
    .attr("stroke-width", metrics.barlineStroke);
  g.append("line")
    .attr("x1", cx)
    .attr("x2", cx)
    .attr("y1", y - h)
    .attr("y2", y)
    .attr("stroke", ink)
    .attr("stroke-width", metrics.barlineStroke);
  return w;
}
