/** 与 jsPDF addFont 注册名、SVG / CSS font-family 保持一致 */
export const SCORE_FONT_FAMILY = 'NotoSansSC'
/** jsPDF 只吃 TTF；屏幕用同族 WOFF2 */
export const SCORE_FONT_FILE = 'NotoSansSC-Regular.ttf'
export const SCORE_FONT_WOFF2 = 'NotoSansSC-Regular.woff2'
export const SCORE_FONT_CDN =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.5/chinese-simplified-400-normal.ttf'
export const SCORE_FONT_WOFF2_CDN =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.5/chinese-simplified-400-normal.woff2'

export function scoreFontPublicUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}fonts/${SCORE_FONT_FILE}`
}

export function scoreFontWoff2PublicUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}fonts/${SCORE_FONT_WOFF2}`
}

let fontReady = null

/**
 * 等谱面字体就绪后再量宽/绘制。
 * 标题走系统字体，不挡 LCP；SVG 唱名量宽仍等 NotoSansSC。
 * 数字/升降号即可开始画，不必等完整 CJK 子集之外的字形。
 */
export function ensureScoreFont() {
  if (!fontReady) {
    fontReady = (async () => {
      if (typeof document === 'undefined' || !document.fonts?.load) return
      try {
        await Promise.all([
          document.fonts.load(`16px "${SCORE_FONT_FAMILY}"`, '0123456789#-'),
          document.fonts.load(`bold 16px "${SCORE_FONT_FAMILY}"`, '字词'),
        ])
      } catch {
        /* 字体未就绪时继续，量宽会短暂回退系统字体 */
      }
    })()
  }
  return fontReady
}
