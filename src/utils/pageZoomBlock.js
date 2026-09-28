/**
 * iOS 12 不支持 touch-action: manipulation，双击按钮会缩放页面。
 * 点击后 400ms 内拦截后续 touchend，避免双击缩放，同时按钮自己的 touchend 仍能连点。
 */
let pageZoomBlockTimer = 0
let pageZoomBlockHandler = null

export function clearPageZoomBlock() {
  window.clearTimeout(pageZoomBlockTimer)
  pageZoomBlockTimer = 0
  if (pageZoomBlockHandler) {
    document.removeEventListener('touchend', pageZoomBlockHandler, true)
    pageZoomBlockHandler = null
  }
}

export function armPageZoomBlock() {
  if (!pageZoomBlockHandler) {
    pageZoomBlockHandler = (e) => {
      if (e.cancelable) e.preventDefault()
    }
    document.addEventListener('touchend', pageZoomBlockHandler, {
      capture: true,
      passive: false,
    })
  }
  window.clearTimeout(pageZoomBlockTimer)
  pageZoomBlockTimer = window.setTimeout(clearPageZoomBlock, 400)
}
