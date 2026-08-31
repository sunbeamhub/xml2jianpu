import { isTauri } from './platform.js'

export const SCHEME_LIGHT = 'light'
export const SCHEME_DARK = 'dark'

const BG_LIGHT = { red: 249, green: 249, blue: 249, alpha: 255 }
const BG_DARK = { red: 17, green: 17, blue: 19, alpha: 255 }

function bgColorForScheme(scheme) {
  return scheme === SCHEME_DARK ? BG_DARK : BG_LIGHT
}

function prefersDarkScheme() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  )
}

/** Tauri 客户端运行在 Linux 上 */
export function isLinuxTauri() {
  return (
    isTauri() &&
    typeof navigator !== 'undefined' &&
    /linux/i.test(navigator.userAgent)
  )
}

/** 将 Tauri onThemeChanged payload 转为渲染 scheme */
export function schemeFromThemePayload(payload) {
  if (payload === 'dark') return SCHEME_DARK
  if (payload === 'light') return SCHEME_LIGHT
  return null
}

/** 取消应用强制主题，恢复跟随系统（auto 切回系统前须先调用） */
export async function clearWindowThemeOverride() {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setTheme(null)
}

/** Tauri：读原生窗口主题；Web：matchMedia */
export async function resolveSystemScheme() {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const t = await getCurrentWindow().theme()
    if (t === 'dark') return SCHEME_DARK
    if (t === 'light') return SCHEME_LIGHT
    return prefersDarkScheme() ? SCHEME_DARK : SCHEME_LIGHT
  }
  if (prefersDarkScheme()) {
    return SCHEME_DARK
  }
  return SCHEME_LIGHT
}

/**
 * 同步 NSWindow 背景与标题栏外观。
 * auto：标题栏跟系统；显式浅/深：强制窗口主题。
 */
export async function syncWindowChrome(themePreference, scheme) {
  if (!isTauri()) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.setBackgroundColor(bgColorForScheme(scheme))
  if (themePreference === 'auto') {
    await win.setTheme(null)
  } else {
    await win.setTheme(scheme === SCHEME_DARK ? 'dark' : 'light')
  }
}

let themeUnlisten = null
let resizeUnlisten = null

/**
 * @param {(schemeHint: 'light' | 'dark' | null) => void} onChange
 */
export async function bindTauriThemeListener(onChange) {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  if (themeUnlisten) {
    await themeUnlisten()
    themeUnlisten = null
  }
  themeUnlisten = await getCurrentWindow().onThemeChanged(({ payload }) => {
    onChange(payload ?? null)
  })
}

export async function bindTauriWindowResized(onResize) {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  if (resizeUnlisten) {
    await resizeUnlisten()
    resizeUnlisten = null
  }
  resizeUnlisten = await getCurrentWindow().onResized(() => {
    onResize()
  })
}

export async function unbindTauriWindowListeners() {
  if (themeUnlisten) {
    await themeUnlisten()
    themeUnlisten = null
  }
  if (resizeUnlisten) {
    await resizeUnlisten()
    resizeUnlisten = null
  }
}
