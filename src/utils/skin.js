export const SKIN_KEY = 'xml2jianpu:skin'
export const SKIN_MODERN = 'modern'
export const SKIN_SMARTISAN = 'smartisan'
export const SKIN_VALUES = [SKIN_MODERN, SKIN_SMARTISAN]

export function readStoredSkin() {
  try {
    const value = localStorage.getItem(SKIN_KEY)
    if (value && SKIN_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return SKIN_MODERN
}

export function persistSkin(skin) {
  if (!SKIN_VALUES.includes(skin)) return
  try {
    localStorage.setItem(SKIN_KEY, skin)
  } catch {
    /* ignore quota / private mode */
  }
}

export function applySkin(skin) {
  if (typeof document === 'undefined') return
  const next = SKIN_VALUES.includes(skin) ? skin : SKIN_MODERN
  document.documentElement.setAttribute('data-skin', next)
}

export function applyStoredSkin() {
  applySkin(readStoredSkin())
}
