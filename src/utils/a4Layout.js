/** A4 页边距（mm）；略留白，避免贴边被裁切 */
export const MARGIN_MM = 12
export const PAGE_W_MM = 210
export const PAGE_H_MM = 297
export const CONTENT_W_MM = PAGE_W_MM - 2 * MARGIN_MM
export const CONTENT_H_MM = PAGE_H_MM - 2 * MARGIN_MM

/** 离屏/屏幕列宽（px），约等于内容区宽度@96dpi */
export const A4_SVG_WIDTH = Math.round((CONTENT_W_MM / 25.4) * 96)

/** 列内左右留白；页面与 PDF 共用 */
export const SCORE_PAD_X = 28
