export const THEME_KEY = 'xml2jianpu:theme'
export const THEME_VALUES = ['auto', 'light', 'dark']

/** 与 tokens.css --color-page-bg 保持一致，供系统栏 theme-color 使用 */
const THEME_COLOR_LIGHT = '#f9f9f9'
const THEME_COLOR_DARK = '#111113'

let schemeListenerBound = false

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

function prefersColorSchemeDark() {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
}

function pageBgFor(theme) {
  if (theme === 'dark') return THEME_COLOR_DARK
  if (theme === 'light') return THEME_COLOR_LIGHT
  return prefersColorSchemeDark() ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
}

function themeColorMetas() {
  return [...document.querySelectorAll('meta[name="theme-color"]')]
}

/**
 * 系统状态栏 / Android 导航栏跟页面底色走。
 * auto：保留 media 查询；显式浅/深：去掉 media，避免和系统偏好打架。
 */
function syncChromeTheme(theme) {
  if (typeof document === 'undefined') return
  const metas = themeColorMetas()
  if (!metas.length) {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
    metas.push(meta)
  }

  if (theme === 'auto') {
    while (metas.length < 2) {
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
      metas.push(meta)
    }
    metas[0].setAttribute('media', '(prefers-color-scheme: light)')
    metas[0].setAttribute('content', THEME_COLOR_LIGHT)
    metas[1].setAttribute('media', '(prefers-color-scheme: dark)')
    metas[1].setAttribute('content', THEME_COLOR_DARK)
    for (let i = 2; i < metas.length; i++) {
      metas[i].removeAttribute('media')
      metas[i].setAttribute('content', THEME_COLOR_LIGHT)
    }
    return
  }

  const color = pageBgFor(theme)
  for (const meta of metas) {
    meta.removeAttribute('media')
    meta.setAttribute('content', color)
  }
}

function bindSchemeListener() {
  if (schemeListenerBound || typeof window === 'undefined') return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (readStoredTheme() === 'auto') syncChromeTheme('auto')
  }
  if (mq.addEventListener) mq.addEventListener('change', onChange)
  else mq.addListener(onChange)
  schemeListenerBound = true
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return
  const next = THEME_VALUES.includes(theme) ? theme : 'auto'
  document.documentElement.setAttribute('data-theme', next)
  syncChromeTheme(next)
  bindSchemeListener()
}

export function applyStoredTheme() {
  applyTheme(readStoredTheme())
}
