/** 正文/元信息共用配置；标题字号单独固定 */
export const SCORE_FONT_SIZE_DEFAULT = 16
export const SCORE_FONT_SIZE_MIN = 12
export const SCORE_FONT_SIZE_MAX = 22
export const SCORE_TITLE_FONT_SIZE = 28

export const SCORE_FONT_SIZE_LEVELS = Array.from(
  { length: SCORE_FONT_SIZE_MAX - SCORE_FONT_SIZE_MIN + 1 },
  (_, i) => SCORE_FONT_SIZE_MIN + i
)

/** 设备+自动换行：每行唱名/休止/延音占位/小节线数量 */
export const READABLE_LINE_UNITS = {
  single: { min: 45, max: 75 },
  multi: { min: 40, max: 50 },
}

export function clampScoreFontSize(n) {
  const v = Number.parseInt(String(n), 10)
  if (!Number.isFinite(v)) return SCORE_FONT_SIZE_DEFAULT
  return Math.min(SCORE_FONT_SIZE_MAX, Math.max(SCORE_FONT_SIZE_MIN, v))
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * 以 16px 为 1.0。metaSize 与 bodySize 相同；titleSize 不跟配置走。
 * @param {number} [size]
 */
export function makeScoreMetrics(size = SCORE_FONT_SIZE_DEFAULT) {
  const bodySize = clampScoreFontSize(size)
  const metaSize = bodySize
  const s = bodySize / SCORE_FONT_SIZE_DEFAULT
  const noteAscent = round1(12 * s)
  const noteDescent = round1(4 * s)
  const octaveDotR = round2(1.5 * s)
  /** 唱名顶/底缘→第一点中心 = 相邻高低点中心距（收紧，避免第二点压连线） */
  const octaveDotStep = round1(4 * s)
  const augDotR = round2(1.35 * s)
  return {
    bodySize,
    metaSize,
    titleSize: SCORE_TITLE_FONT_SIZE,
    s,
    LAYER: {
      tupletTop: round1(-31 * s),
      tupletLeg: round1(-28 * s),
      tie: round1(-23 * s),
      upperOctave: round1(-(noteAscent + octaveDotStep)),
      note: 0,
      underline1: round1(5 * s),
      underline2: round1(8 * s),
      lowerOctave: round1(noteDescent + octaveDotStep),
      lyric: round1(34 * s),
    },
    eachHeight: round1(100 * s),
    titleY: 28,
    sectionGap: round1(24 * s),
    layoutMinGap: round1(18 * s),
    layoutLyricPad: round1(6 * s),
    layoutDotGap: round1(2 * s),
    tieHookPx: round1(16 * s),
    extendDashRatio: 0.5,
    extendDashStroke: round2(2 * s),
    extendDashY: round1(5 * s),
    underlineHalf: round1(5 * s),
    underlineStep: round1(3 * s),
    octaveDotR,
    octaveDotStep,
    augDotR,
    /** 唱名右缘 → 第一附点中心；复附点中心距；基线上移 */
    augDotDx: round1(4 * s),
    augDotStep: round1(2 * augDotR + 1.5 * s),
    augDotDy: round1(4 * s),
    augDotPad: round1(1 * s),
    noteAscent,
    noteDescent,
    barlineStroke: round2(1 * s),
    barlineFinalThin: round2(1 * s),
    barlineFinalThick: round2(2.8 * s),
    barlineFinalOffsetL: round2(2.5 * s),
    barlineFinalOffsetR: round2(1.5 * s),
    tieStroke: round2(1 * s),
    tieCurve: round1(4 * s),
    tieSameLineSlop: round1(20 * s),
    sharpExtraW: round1(8 * s),
    accidentalDy: round1(8 * s),
    naturalDy: round1(4 * s),
    accidentalDx: round1(-5 * s),
    lineAscentPad: round1(24 * s),
    metaLineGap: round1(18 * s),
    metaMinGap: round1(28 * s),
    metaPagePad: 16,
    metaKeyAccidentalLift: round1(8 * s),
    metaKeyAccidentalGap: round1(6 * s),
    metaTimeGap: round1(3 * s),
    metaTimeBarHalf: round1(9 * s),
    metaTimeBarStroke: round2(1.2 * s),
    metaTimeAdvance: round1(22 * s),
    metaMoodGap: round1(14 * s),
    metaTempoNoteRx: round2(5 * s),
    metaTempoNoteRy: round2(3.6 * s),
    metaTempoStem: round2(1.5 * s),
    metaCreditStackGap: round1(12 * s),
    metaHideTitleGap: round1(12 * s),
    columnRulePad: round1(4 * s),
    columnRuleStroke: round2(1 * s),
    lyricRuleExtra: round1(16 * s),
    hideMetaTopPad: round1(8 * s),
  }
}
