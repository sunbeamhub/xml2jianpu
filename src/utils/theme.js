import { isTauri } from './platform.js'
import {
  resolveSystemScheme,
  syncWindowChrome,
  bindTauriThemeListener,
  clearWindowThemeOverride,
  SCHEME_DARK,
  SCHEME_LIGHT,
} from './tauriWindow.js'

export const THEME_KEY = 'xml2jianpu:theme'
export const THEME_VALUES = ['auto', 'light', 'dark']

/** 与 tokens.css --color-page-bg 保持一致，供系统栏 theme-color 使用 */
const THEME_COLOR_LIGHT = '#f9f9f9'
const THEME_COLOR_DARK = '#111113'

let schemeListenerBound = false
/** @type {((themePref: string, scheme: string) => void) | null} */
let schemeChangeHandler = null

export function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    if (value && THEME_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return 'auto'
}

export function persistTheme(theme) {
  if (!THEME_VALUES.includes(theme)) return
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore quota / private mode */
  }
}

async function resolveScheme(theme) {
  if (theme === 'dark') return SCHEME_DARK
  if (theme === 'light') return SCHEME_LIGHT
  return resolveSystemScheme()
}

function pageBgForScheme(scheme) {
  return scheme === SCHEME_DARK ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
}

function themeColorMetas() {
  return [...document.querySelectorAll('meta[name="theme-color"]')]
}

/** 系统状态栏 / Android 导航栏跟当前渲染 scheme 走 */
function syncChromeTheme(scheme) {
  if (typeof document === 'undefined') return
  const metas = themeColorMetas()
  if (!metas.length) {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
    metas.push(meta)
  }

  const color = pageBgForScheme(scheme)
  for (const meta of metas) {
    meta.removeAttribute('media')
    meta.setAttribute('content', color)
  }
}

function bindSchemeListener() {
  if (schemeListenerBound || typeof window === 'undefined') return
  schemeListenerBound = true

  const onSystemSchemeChange = () => {
    if (readStoredTheme() !== 'auto') return
    void applyTheme('auto')
  }

  if (isTauri()) {
    void bindTauriThemeListener(onSystemSchemeChange)
    return
  }

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  if (mq.addEventListener) mq.addEventListener('change', onSystemSchemeChange)
  else mq.addListener(onSystemSchemeChange)
}

/**
 * @param {string} theme
 * @returns {Promise<void>}
 */
export async function applyTheme(theme) {
  if (typeof document === 'undefined') return
  const next = THEME_VALUES.includes(theme) ? theme : 'auto'
  document.documentElement.setAttribute('data-theme', next)

  if (isTauri() && next === 'auto') {
    await clearWindowThemeOverride()
  }
  const scheme = await resolveScheme(next)

  document.documentElement.setAttribute('data-scheme', scheme)

  syncChromeTheme(scheme)
  await syncWindowChrome(next, scheme)
  bindSchemeListener()

  schemeChangeHandler?.(next, scheme)
}

export function onThemeSchemeApplied(handler) {
  schemeChangeHandler = handler
}

export function applyStoredTheme() {
  void applyTheme(readStoredTheme())
}
