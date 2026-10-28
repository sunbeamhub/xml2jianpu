/** 曲名左右留白，避免贴着画布边缘被裁切 */
export const SCORE_TITLE_EDGE_PAD = 8

/** 曲名可用宽度：画布宽减去两侧留白 */
export function scoreTitleMaxWidth(canvasWidth) {
  const w = Number(canvasWidth)
  if (!(w > 0)) return 1
  return Math.max(1, w - 2 * SCORE_TITLE_EDGE_PAD)
}

/**
 * 曲名超出 maxWidth 时按比例缩小，并上移基线，使字顶留在原处。
 * 放得下时 scale 为 1，字号和基线不变。
 * @param {SVGTextElement | null | undefined} textEl
 * @param {{ fontSize: number, baseline: number, maxWidth: number }} opts
 * @returns {{ fontSize: number, baseline: number, scale: number }}
 */
export function fitScoreTitle(textEl, opts) {
  const fontSize = Number(opts?.fontSize)
  const baseline = Number(opts?.baseline)
  const maxWidth = Number(opts?.maxWidth)
  const unchanged = { fontSize, baseline, scale: 1 }
  if (!(fontSize > 0) || !(maxWidth > 0) || !Number.isFinite(baseline)) {
    return unchanged
  }
  const measured = Number(textEl?.getComputedTextLength?.()) || 0
  if (!(measured > maxWidth + 0.5)) return unchanged
  const fitted = Math.floor(fontSize * (maxWidth / measured) * 100) / 100
  if (!(fitted > 0) || fitted >= fontSize) return unchanged
  return {
    fontSize: fitted,
    baseline: baseline - (fontSize - fitted),
    scale: fitted / fontSize,
  }
}
