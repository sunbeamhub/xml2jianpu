/** @type {((reloadPage?: boolean) => Promise<void>) | null} */
let updateSW = null

/** 由 registerServiceWorker 在生产 PWA 里登记 */
export function setPwaUpdate(fn) {
  updateSW = typeof fn === 'function' ? fn : null
}

/** 先激活等待中的 service worker，再刷新当前页面 */
export async function refreshWebApp() {
  if (updateSW) {
    try {
      await updateSW(true)
    } catch {
      /* 没有可激活的 worker 时仍刷新 */
    }
  }
  window.location.reload()
}
