import {
  SCORE_PAD_X,
  getPageLayout,
  isDevicePaperSize,
} from './pageLayout.js'
import { NOTATION_STAFF } from './osmdRenderer.js'

/** 右侧总览栏宽度，判定与占位用同一个数 */
export const OVERVIEW_RAIL_PX = 112
/** 总览栏与乐谱正文之间的间距 */
export const OVERVIEW_GAP_PX = 12

export function overviewReservePx() {
  return OVERVIEW_RAIL_PX + OVERVIEW_GAP_PX
}

/** 一列简谱在不缩小时占用的宽度（自然列宽 + 列内左右留白） */
export function jianpuColumnOuterPx(naturalColumnW, contentPadX = SCORE_PAD_X) {
  const w = Number(naturalColumnW) || 0
  if (w <= 0) return 0
  return Math.ceil(w + 2 * contentPadX)
}

/**
 * 判定用的正文宽度。
 * 设备尺寸用自然列宽，避免画布撑满视口后永远放不下总览。
 * 固定纸张至少按纸宽算，短行不会在纸面本身还没放下时打开总览。
 */
export function scoreBodyFitWidth({
  notation,
  naturalColumnW,
  staffBodyWidth,
  paperSize,
}) {
  if (notation === NOTATION_STAFF) {
    return Math.ceil(Number(staffBodyWidth) || 0)
  }
  const naturalOuter = jianpuColumnOuterPx(naturalColumnW)
  if (isDevicePaperSize(paperSize)) return naturalOuter
  return Math.max(naturalOuter, getPageLayout(paperSize).svgWidth)
}

/**
 * 视口放得下一列不缩小的正文再加上总览栏时用总览。
 * 设备尺寸且自动换行时排版会跟着视口重排，只用缩放。
 */
export function shouldUseScoreOverview({
  paperSize,
  lineBreak,
  viewportContentW,
  bodyFitW,
  sidePad = 0,
}) {
  if (isDevicePaperSize(paperSize) && lineBreak === 'auto') return false
  const body = Number(bodyFitW) || 0
  const view = Number(viewportContentW) || 0
  if (body <= 0 || view <= 0) return false
  const need = body + 2 * sidePad + overviewReservePx()
  return view + 0.5 >= need
}
