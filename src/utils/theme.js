import { isTauri, isAndroidTauri } from './platform.js'
import {
  resolveSystemScheme,
  syncWindowChrome,
  bindTauriThemeListener,
  clearWindowThemeOverride,
  schemeFromThemePayload,
  isLinuxTauri,
  SCHEME_DARK,
  SCHEME_LIGHT,
} from './tauriWindow.js'

export const THEME_KEY = 'xml2jianpu:theme'
export const THEME_VALUES = ['auto', 'light', 'dark']

/** 与 tokens.css --color-page-bg 保持一致，供系统栏 theme-color 使用 */
const THEME_COLOR_LIGHT = '#f9f9f9'
const THEME_COLOR_DARK = '#111113'

const SCHEME_DEBOUNCE_MS = 50

let schemeListenersBound = false
/** @type {((themePref: string, scheme: string) => void) | null} */
let schemeChangeHandler = null
/** @type {ReturnType<typeof setTimeout> | null} */
let schemeDebounceTimer = null
let linuxFocusFallbackBound = false
let androidFocusFallbackBound = false
let startupThemeApplied = false
/** @type {string | null} */
let lastAppliedThemePref = null
/** @type {string | null} */
let lastAppliedScheme = null

function systemSchemeHint() {
  if (typeof window === 'undefined' || !window.matchMedia) return null
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? SCHEME_DARK
    : SCHEME_LIGHT
}

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

async function resolveScheme(theme, schemeHint = null) {
  if (theme === 'dark') return SCHEME_DARK
  if (theme === 'light') return SCHEME_LIGHT
  const hinted = schemeFromThemePayload(schemeHint)
  if (hinted) return hinted
  return resolveSystemScheme()
}

function pageBgForScheme(scheme) {
  return scheme === SCHEME_DARK ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
}

function themeColorMetas() {
  return [...document.querySelectorAll('meta[name="theme-color"]')]
}

function currentDataScheme() {
  return document.documentElement.getAttribute('data-scheme')
}

/** 通知 Android 原生层同步主题偏好与系统栏图标颜色 */
function syncAndroidSystemBars(themePref) {
  if (!isAndroidTauri() || typeof window === 'undefined') return
  try {
    window.AndroidChrome?.setThemePreference(themePref)
  } catch {
    /* bridge not ready */
  }
}

/** Android 冷启动后由 JS 主动请求重放安全区 inset */
export function syncAndroidSafeArea() {
  if (!isAndroidTauri() || typeof window === 'undefined') return
  try {
    window.AndroidChrome?.requestSafeAreaSync()
  } catch {
    /* bridge not ready */
  }
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

function debouncedSystemSchemeChange(onChange) {
  return (schemeHint) => {
    if (schemeDebounceTimer) clearTimeout(schemeDebounceTimer)
    schemeDebounceTimer = setTimeout(() => {
      schemeDebounceTimer = null
      onChange(schemeHint ?? null)
    }, SCHEME_DEBOUNCE_MS)
  }
}

async function applyThemeFromSystemEvent(schemeHint = null) {
  if (readStoredTheme() !== 'auto') return

  const scheme = await resolveScheme('auto', schemeHint)
  if (currentDataScheme() === scheme) return

  await applyTheme('auto', { schemeHint })
}

async function syncAutoScheme() {
  if (readStoredTheme() !== 'auto') return
  const schemeHint = isAndroidTauri() ? systemSchemeHint() : null
  await applyThemeFromSystemEvent(schemeHint)
}

function bindMediaQueryListener(onSystemSchemeChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onMqChange = () => {
    onSystemSchemeChange(mq.matches ? 'dark' : 'light')
  }
  if (mq.addEventListener) mq.addEventListener('change', onMqChange)
  else mq.addListener(onMqChange)
}

function bindLinuxFocusFallback() {
  if (linuxFocusFallbackBound || typeof window === 'undefined') return
  linuxFocusFallbackBound = true

  const resync = () => {
    void syncAutoScheme()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync()
  })
  window.addEventListener('focus', resync)
}

function bindAndroidFocusFallback() {
  if (androidFocusFallbackBound || typeof window === 'undefined') return
  androidFocusFallbackBound = true

  const resync = () => {
    void syncAutoScheme()
    syncAndroidSafeArea()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync()
  })
}

/**
 * 窗口就绪后注册系统主题监听（Tauri onThemeChanged + matchMedia 双源）。
 * 应在 Vue mount 之后调用，避免过早绑定导致 Linux/KDE 上监听失效。
 */
export async function bindSchemeListenersWhenReady() {
  if (schemeListenersBound || typeof window === 'undefined') return

  const onSystemSchemeChange = debouncedSystemSchemeChange((schemeHint) => {
    void applyThemeFromSystemEvent(schemeHint)
  })

  bindMediaQueryListener(onSystemSchemeChange)

  if (isTauri()) {
    try {
      await bindTauriThemeListener(onSystemSchemeChange)
    } catch {
      /* matchMedia 仍可作为兜底 */
    }
    if (isLinuxTauri()) {
      bindLinuxFocusFallback()
    }
    if (isAndroidTauri()) {
      bindAndroidFocusFallback()
      syncAndroidSafeArea()
    }
  }

  schemeListenersBound = true
}

/**
 * @param {string} theme
 * @param {{ schemeHint?: 'light' | 'dark' | null, coldStart?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function applyTheme(theme, options = {}) {
  if (typeof document === 'undefined') return
  const next = THEME_VALUES.includes(theme) ? theme : 'auto'
  const coldStart = options.coldStart === true
  const previousScheme = currentDataScheme()
  const prefChanged = lastAppliedThemePref !== next
  const schemeHint = (() => {
    if (options.schemeHint != null) return options.schemeHint
    if (next === 'auto' && isAndroidTauri()) return systemSchemeHint()
    return null
  })()

  document.documentElement.setAttribute('data-theme', next)

  // 冷启动 auto：窗口尚未被本应用强制主题，跳过 setTheme(null) 避免多余原生重排
  const shouldClearWindowOverride =
    isTauri() && next === 'auto' && !coldStart
  if (shouldClearWindowOverride) {
    await clearWindowThemeOverride()
  }

  const scheme = await resolveScheme(next, schemeHint)
  const schemeChanged = previousScheme !== scheme

  document.documentElement.setAttribute('data-scheme', scheme)

  if (schemeChanged || !startupThemeApplied) {
    syncChromeTheme(scheme)
  }

  const shouldSyncAndroidNative =
    isAndroidTauri() &&
    (!startupThemeApplied || prefChanged || schemeChanged)
  if (shouldSyncAndroidNative) {
    syncAndroidSystemBars(next)
  }

  const shouldSyncWindow =
    !(coldStart && isAndroidTauri() && next === 'auto') &&
    (!startupThemeApplied || prefChanged || schemeChanged)
  if (shouldSyncWindow) {
    await syncWindowChrome(next, scheme)
  }

  startupThemeApplied = true
  lastAppliedThemePref = next
  lastAppliedScheme = scheme

  if (schemeChanged) {
    schemeChangeHandler?.(next, scheme)
  }
}

export function onThemeSchemeApplied(handler) {
  schemeChangeHandler = handler
}

/** 启动时同步主题属性，不注册系统监听（监听延迟到 mount 后） */
export function applyStoredTheme() {
  void applyTheme(readStoredTheme(), { coldStart: true })
}
