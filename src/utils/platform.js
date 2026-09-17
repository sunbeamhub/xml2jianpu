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
