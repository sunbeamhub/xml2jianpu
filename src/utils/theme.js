import {
  isTauri,
  isAndroidTauri,
  usesMatchMediaSystemScheme,
} from './platform.js'
import {
  resolveSystemScheme,
  syncWindowChrome,
  bindTauriThemeListener,
  clearWindowThemeOverride,
  schemeFromThemePayload,
  isLinuxTauri,
  readSystemScheme,
  SCHEME_DARK,
  SCHEME_LIGHT,
} from './tauriWindow.js'

export const THEME_KEY = 'xml2jianpu:theme'
export const THEME_VALUES = ['auto', 'light', 'dark']

/** 与 tokens.css --color-page-bg 保持一致，供系统栏 theme-color 使用 */
const THEME_COLOR_LIGHT = '#f9f9f9'
const THEME_COLOR_DARK = '#111113'
const THEME_COLOR_MEDIA_LIGHT = '(prefers-color-scheme: light)'
const THEME_COLOR_MEDIA_DARK = '(prefers-color-scheme: dark)'

const SCHEME_DEBOUNCE_MS = 50

let schemeListenersBound = false
/** @type {((themePref: string, scheme: string) => void) | null} */
let schemeChangeHandler = null
/** @type {ReturnType<typeof setTimeout> | null} */
let schemeDebounceTimer = null
let linuxFocusFallbackBound = false
let mobileFocusFallbackBound = false
let startupThemeApplied = false
/** @type {string | null} */
let lastAppliedThemePref = null
/** @type {string | null} */
let lastAppliedScheme = null

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

function pageBgForScheme(scheme) {
  return scheme === SCHEME_DARK ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
}

function themeColorMetas() {
  return [...document.querySelectorAll('meta[name="theme-color"]')]
}

function ensureNamedMeta(name) {
  let meta = document.querySelector(`meta[name="${name}"]`)
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', name)
    document.head.appendChild(meta)
  }
  return meta
}

function replaceThemeColorMetas(specs) {
  const metas = themeColorMetas()
  const kept = []
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]
    let meta = metas[i]
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', spec.content)
    if (spec.media) meta.setAttribute('media', spec.media)
    else meta.removeAttribute('media')
    kept.push(meta)
  }
  for (const meta of metas) {
    if (!kept.includes(meta)) meta.remove()
  }
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

/** 系统状态栏 / 浏览器 UI：自动跟 media，手动锁成当前 scheme */
function syncChromeTheme(scheme, themePref = 'auto') {
  if (typeof document === 'undefined') return

  const colorSchemeMeta = ensureNamedMeta('color-scheme')
  if (themePref === 'auto') {
    colorSchemeMeta.setAttribute('content', 'light dark')
    replaceThemeColorMetas([
      { content: THEME_COLOR_LIGHT, media: THEME_COLOR_MEDIA_LIGHT },
      { content: THEME_COLOR_DARK, media: THEME_COLOR_MEDIA_DARK },
    ])
    return
  }

  colorSchemeMeta.setAttribute(
    'content',
    scheme === SCHEME_DARK ? SCHEME_DARK : SCHEME_LIGHT,
  )
  replaceThemeColorMetas([{ content: pageBgForScheme(scheme) }])
}

function resolvedAutoScheme(schemeHint = null) {
  const hinted = schemeFromThemePayload(schemeHint)
  if (hinted) return hinted
  return readSystemScheme()
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

/** 自动主题：不写 data-scheme，只重绘谱面、同步窗口背景、Android 安全区 */
async function onAutoSystemAppearanceChange(schemeHint = null) {
  if (readStoredTheme() !== 'auto') return
  const scheme = resolvedAutoScheme(schemeHint)
  if (!scheme) return

  if (lastAppliedThemePref === 'auto' && lastAppliedScheme === scheme) {
    if (isAndroidTauri()) syncAndroidSafeArea()
    return
  }

  lastAppliedScheme = scheme
  schemeChangeHandler?.('auto', scheme)
  if (isTauri()) {
    await syncWindowChrome('auto', scheme)
  }
  if (isAndroidTauri()) syncAndroidSafeArea()
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
    void onAutoSystemAppearanceChange()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync()
  })
  window.addEventListener('focus', resync)
}

function bindMobileFocusFallback() {
  if (mobileFocusFallbackBound || typeof window === 'undefined') return
  mobileFocusFallbackBound = true

  const resync = () => {
    void onAutoSystemAppearanceChange()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync()
  })
  window.addEventListener('pageshow', resync)
}

/**
 * 窗口就绪后注册系统主题监听（Tauri onThemeChanged + matchMedia）。
 * 应在 Vue mount 之后调用，避免过早绑定导致 Linux/KDE 上监听失效。
 */
export async function bindSchemeListenersWhenReady() {
  if (schemeListenersBound || typeof window === 'undefined') return

  const onSystemSchemeChange = debouncedSystemSchemeChange((schemeHint) => {
    void onAutoSystemAppearanceChange(schemeHint)
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
    if (usesMatchMediaSystemScheme()) {
      bindMobileFocusFallback()
    }
    if (isAndroidTauri()) {
      syncAndroidSafeArea()
    }
  }

  schemeListenersBound = true
}

/**
 * @param {string} theme
 * @param {{ coldStart?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function applyTheme(theme, options = {}) {
  if (typeof document === 'undefined') return
  const next = THEME_VALUES.includes(theme) ? theme : 'auto'
  const coldStart = options.coldStart === true
  const previousScheme = currentDataScheme()
  const prefChanged = lastAppliedThemePref !== next

  document.documentElement.setAttribute('data-theme', next)

  if (next === 'auto') {
    const keepAndroidBootScheme =
      coldStart &&
      isAndroidTauri() &&
      (previousScheme === SCHEME_DARK || previousScheme === SCHEME_LIGHT)
    if (!keepAndroidBootScheme) {
      document.documentElement.removeAttribute('data-scheme')
    }
    document.documentElement.style.removeProperty('background-color')
    syncChromeTheme(null, 'auto')

    if (isAndroidTauri() && (!startupThemeApplied || prefChanged)) {
      syncAndroidSystemBars('auto')
    }

    const shouldClearWindowOverride =
      isTauri() && !coldStart && !usesMatchMediaSystemScheme()
    if (shouldClearWindowOverride) {
      await clearWindowThemeOverride()
    }

    const scheme = keepAndroidBootScheme
      ? previousScheme
      : await resolveSystemScheme()
    if (!startupThemeApplied || prefChanged) {
      await syncWindowChrome('auto', scheme)
    }

    startupThemeApplied = true
    lastAppliedThemePref = next
    lastAppliedScheme = scheme
    if (prefChanged) {
      schemeChangeHandler?.(next, scheme)
    }
    return
  }

  const scheme = next === 'dark' ? SCHEME_DARK : SCHEME_LIGHT
  const schemeChanged = previousScheme !== scheme

  document.documentElement.setAttribute('data-scheme', scheme)
  document.documentElement.style.removeProperty('background-color')
  syncChromeTheme(scheme, next)

  if (
    isAndroidTauri() &&
    (!startupThemeApplied || prefChanged || schemeChanged)
  ) {
    syncAndroidSystemBars(next)
  }

  if (!startupThemeApplied || prefChanged || schemeChanged) {
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
