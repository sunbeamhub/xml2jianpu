import { isTauri as checkTauri } from '@tauri-apps/api/core'

/** 是否在 Tauri 客户端（桌面 / Android / iOS）内运行 */
export function isTauri() {
  return checkTauri()
}
