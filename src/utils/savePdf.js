/** PDF 保存：优先 a[download]；仅独立 PWA（及兜底）再用 Web Share */

function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isAppleTouch = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ 默认伪装成桌面 Safari 的 UA
  const isIPadDesktopUA =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return isAppleTouch || isIPadDesktopUA
}

/** iPhone / iPad 的 iOS 主版本；桌面 Safari 与 iPadOS 13+ 桌面模式为 0 */
function iosMajorVersion() {
  if (typeof navigator === 'undefined') return 0
  const ua = navigator.userAgent || ''
  if (!/iP(ad|hone|od)/.test(ua)) return 0
  const matched = ua.match(/OS (\d+)_/)
  return matched ? Number(matched[1]) : 0
}

function isLegacyIos() {
  const ios = iosMajorVersion()
  return ios > 0 && ios < 13
}

function isStandalonePWA() {
  if (typeof window === 'undefined') return false
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

/** legacy 独立 PWA：需在用户手势同步栈里先开占位窗 */
export function needsPdfPopupGuard() {
  return isIOS() && isStandalonePWA() && isLegacyIos()
}

/**
 * 仅 iOS < 13（无 a[download]）需引导手动「分享 → 存储到文件」。
 * iOS 13+ 标签页可直接下载，勿因 canShare 误判弹出「无法直接下载」。
 */
export function needsManualSaveGuide() {
  return isLegacyIos()
}

/**
 * 独立 PWA 上 a[download] 常不可靠；Safari 标签页（含 iOS 16）应优先直接下载。
 */
function shouldPreferWebShare() {
  return isIOS() && isStandalonePWA()
}

/**
 * 必须在异步生成 PDF 之前、用户点击的同步栈里调用，
 * 否则 window.open 会被当弹窗拦截。
 */
export function openPdfPopupGuard() {
  if (typeof window === 'undefined') return null
  const popup = window.open('about:blank', '_blank')
  if (!popup) return null
  try {
    popup.document.open()
    popup.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在导出 PDF…</title></head><body style="margin:0;padding:24px;font-family:sans-serif;color:#1c1c1e;line-height:1.5"><p style="margin:0 0 12px;color:#8e8e93">正在导出 PDF…</p><p style="margin:0 0 8px;font-weight:600">打开后请这样保存：</p><ol style="margin:0;padding-left:1.3em"><li>点屏幕顶部的分享按钮（方框加向上箭头）</li><li>选择「存储到文件」</li><li>选好位置后点「存储」</li></ol></body></html>'
    )
    popup.document.close()
  } catch (err) {
    /* about:blank 偶发写不进去，后面仍可用 a.click / location */
  }
  return popup
}

function clickDownloadAnchor(doc, href, filename) {
  const a = doc.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  doc.body.appendChild(a)
  a.click()
  a.remove()
}

async function tryWebShare(file, popup) {
  if (
    typeof navigator === 'undefined' ||
    !navigator.share ||
    !navigator.canShare ||
    !navigator.canShare({ files: [file] })
  ) {
    return false
  }
  try {
    await navigator.share({ files: [file] })
    if (popup && !popup.closed) popup.close()
    return true
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (popup && !popup.closed) popup.close()
      return true
    }
    return false
  }
}

/**
 * @param {Blob} blob
 * @param {string} filename
 * @param {{ popup?: Window | null }} [opts]
 */
export async function savePdfFile(blob, filename, opts = {}) {
  const popup = opts.popup || null
  const file = new File([blob], filename, { type: 'application/pdf' })

  // 仅独立 PWA 优先分享；标签页 Safari 走下面的直接下载
  if (shouldPreferWebShare() && (await tryWebShare(file, popup))) {
    return
  }

  // blob + a[download]（与改前 doc.save / iOS 13+ 行为一致）
  const url = URL.createObjectURL(blob)
  const revokeMs = isLegacyIos() ? 60000 : 2500

  if (popup && !popup.closed) {
    try {
      clickDownloadAnchor(popup.document, url, filename)
      // iOS 12：download 被忽略，改为预览跳转
      if (isLegacyIos()) {
        popup.location.href = url
      }
      setTimeout(() => URL.revokeObjectURL(url), revokeMs)
      return
    } catch (err) {
      try {
        popup.location.href = url
        setTimeout(() => URL.revokeObjectURL(url), revokeMs)
        return
      } catch (err2) {
        /* 继续当前页兜底 */
      }
    }
  }

  clickDownloadAnchor(document, url, filename)
  setTimeout(() => URL.revokeObjectURL(url), revokeMs)
}
