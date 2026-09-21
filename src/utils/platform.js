import { isTauri as checkTauri } from '@tauri-apps/api/core'

/** 是否在 Tauri 客户端（桌面 / Android / iOS）内运行 */
export function isTauri() {
  return checkTauri()
}

/** 是否在 Tauri Android 客户端内运行 */
export function isAndroidTauri() {
  return (
    isTauri() &&
    typeof navigator !== 'undefined' &&
    /android/i.test(navigator.userAgent)
  )
}

/** 是否在 Tauri iOS 客户端内运行 */
export function isIosTauri() {
  return (
    isTauri() &&
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent)
  )
}

/** Android / iOS：window.theme() 不可用，系统外观走 matchMedia */
export function usesMatchMediaSystemScheme() {
  return isAndroidTauri() || isIosTauri()
}

function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isAppleTouch = /iPad|iPhone|iPod/.test(ua)
  const isIPadDesktopUA =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return isAppleTouch || isIPadDesktopUA
}

/** iOS 主屏幕 PWA（Safari 标签页为 false） */
export function isIosStandalonePwa() {
  if (typeof window === 'undefined' || !isIosDevice()) return false
  return (
    window.navigator.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  )
}
