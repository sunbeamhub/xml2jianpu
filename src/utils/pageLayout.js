/** 页边距（mm）；略留白，避免贴边被裁切 */
export const MARGIN_MM = 12

/** 列内左右留白；页面与 PDF 共用 */
export const SCORE_PAD_X = 28

export const DEFAULT_PAPER_SIZE = 'a4'

/** ISO 竖版纸张（mm）；顺序即下拉选项顺序 */
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
export function getPageLayout(size = DEFAULT_PAPER_SIZE) {
  const paper = PAPER_SIZES[size] || PAPER_SIZES[DEFAULT_PAPER_SIZE]
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

/** 引擎无 options 时的列宽回退 */
export const DEFAULT_SVG_WIDTH = getPageLayout(DEFAULT_PAPER_SIZE).svgWidth
