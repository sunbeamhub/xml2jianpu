/** 页边距（mm）；略留白，避免贴边被裁切 */
export const MARGIN_MM = 12

/** 列内左右留白；页面与 PDF 共用 */
export const SCORE_PAD_X = 28

/** 网页预览默认：跟随设备宽度；导出仍须 A3/A4 */
export const DEVICE_PAPER_SIZE = 'device'
export const DEFAULT_PAPER_SIZE = DEVICE_PAPER_SIZE
export const DEFAULT_EXPORT_PAPER_SIZE = 'a4'

/** ISO 竖版纸张（mm）；仅用于导出与纸张预览 */
export const PAPER_SIZES = {
  a3: {
    id: 'a3',
    label: 'A3',
    optionLabel: 'A3（大号 297×420mm）',
    pageW: 297,
    pageH: 420,
  },
  a4: {
    id: 'a4',
    label: 'A4',
    optionLabel: 'A4（标准 210×297mm）',
    pageW: 210,
    pageH: 297,
  },
}

/** 下拉选项：设备在前，其后为可导出纸张 */
export const DISPLAY_SIZES = {
  [DEVICE_PAPER_SIZE]: {
    id: DEVICE_PAPER_SIZE,
    label: '设备',
    optionLabel: '设备（跟随屏幕尺寸）',
  },
  ...PAPER_SIZES,
}

export function isExportPaperSize(size) {
  return Object.prototype.hasOwnProperty.call(PAPER_SIZES, size)
}

export function isDevicePaperSize(size) {
  return size === DEVICE_PAPER_SIZE
}

/**
 * @param {string} [size]
 * @returns {{
 *   id: string,
 *   format: string,
 *   pageWMm: number,
 *   pageHMm: number,
 *   contentWMm: number,
 *   contentHMm: number,
 *   marginMm: number,
 *   svgWidth: number,
 * }}
 */
export function getPageLayout(size = DEFAULT_EXPORT_PAPER_SIZE) {
  const paper = PAPER_SIZES[size] || PAPER_SIZES[DEFAULT_EXPORT_PAPER_SIZE]
  const contentWMm = paper.pageW - 2 * MARGIN_MM
  const contentHMm = paper.pageH - 2 * MARGIN_MM
  return {
    id: paper.id,
    format: paper.id,
    pageWMm: paper.pageW,
    pageHMm: paper.pageH,
    contentWMm,
    contentHMm,
    marginMm: MARGIN_MM,
    svgWidth: Math.round((contentWMm / 25.4) * 96),
  }
}

/** 引擎无 options 时的列宽回退（A4 内容宽） */
export const DEFAULT_SVG_WIDTH = getPageLayout(DEFAULT_EXPORT_PAPER_SIZE).svgWidth
