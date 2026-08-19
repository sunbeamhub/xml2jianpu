/** 与 jsPDF addFont 注册名、SVG / CSS font-family 保持一致 */
export const SCORE_FONT_FAMILY = 'NotoSansSC'
export const SCORE_FONT_FILE = 'NotoSansSC-Regular.ttf'
export const SCORE_FONT_CDN =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.5/chinese-simplified-400-normal.ttf'

export function scoreFontPublicUrl() {
  // Vue CLI 会在构建时把 process.env.BASE_URL 替换为 publicPath（如 /xml2jianpu/）。
  // 不要用 typeof process 判断：浏览器里 process 未定义，会错误回退成 "/" 导致 404。
  const base = process.env.BASE_URL || '/'
  return `${base}fonts/${SCORE_FONT_FILE}`
}

let fontReady = null

/**
 * 等 @font-face 就绪后再量宽/绘制，避免首屏用系统字体导致槽宽和 PDF 不一致。
 */
export function ensureScoreFont() {
  if (!fontReady) {
    fontReady = (async () => {
      if (typeof document === 'undefined' || !document.fonts?.load) return
      try {
        await Promise.all([
          document.fonts.load(`16px "${SCORE_FONT_FAMILY}"`),
          document.fonts.load(`bold 16px "${SCORE_FONT_FAMILY}"`),
        ])
      } catch {
        /* 字体未就绪时继续，量宽会短暂回退系统字体 */
      }
    })()
  }
  return fontReady
}
