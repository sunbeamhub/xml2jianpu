export const THEME_KEY = 'xml2jianpu:theme'
export const THEME_VALUES = ['auto', 'light', 'dark']

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

export function applyTheme(theme) {
  if (typeof document === 'undefined') return
  const next = THEME_VALUES.includes(theme) ? theme : 'auto'
  document.documentElement.setAttribute('data-theme', next)
}

export function applyStoredTheme() {
  applyTheme(readStoredTheme())
}
