import { isTauri, usesMatchMediaSystemScheme } from './platform.js'

export const SCHEME_LIGHT = 'light'
export const SCHEME_DARK = 'dark'

const BG_LIGHT = { red: 249, green: 249, blue: 249, alpha: 255 }
const BG_DARK = { red: 17, green: 17, blue: 19, alpha: 255 }

function bgColorForScheme(scheme) {
  return scheme === SCHEME_DARK ? BG_DARK : BG_LIGHT
}

const SYSTEM_SCHEME_VAR = '--jp-system-scheme'

/** CSS 引擎的系统外观；iOS Safari 首次 matchMedia 可能与系统相反 */
function systemSchemeFromCss() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return null
  }
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(SYSTEM_SCHEME_VAR)
      .trim()
    if (value === SCHEME_DARK || value === SCHEME_LIGHT) return value
  } catch {
    /* ignore */
  }
  return null
}

/** 系统外观：优先 CSS 变量，读不到再回退 matchMedia */
export function readSystemScheme() {
  const fromCss = systemSchemeFromCss()
  if (fromCss) return fromCss
  if (typeof window === 'undefined' || !window.matchMedia) return null
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? SCHEME_DARK
    : SCHEME_LIGHT
}

function prefersDarkScheme() {
  return readSystemScheme() === SCHEME_DARK
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

/** Tauri 桌面：读原生窗口主题；Web / Android / iOS：CSS 变量，回退 matchMedia */
export async function resolveSystemScheme() {
  if (usesMatchMediaSystemScheme()) {
    return prefersDarkScheme() ? SCHEME_DARK : SCHEME_LIGHT
  }
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
 * 同步窗口背景与标题栏外观。
 * auto：标题栏跟系统；显式浅/深：强制窗口主题。
 * Android / iOS 的 setTheme 为 Unsupported，只同步背景色。
 */
export async function syncWindowChrome(themePreference, scheme) {
  if (!isTauri()) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.setBackgroundColor(bgColorForScheme(scheme))
  if (usesMatchMediaSystemScheme()) return
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
