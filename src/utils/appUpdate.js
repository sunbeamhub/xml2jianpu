import { computed, ref } from 'vue'
import { isIosTauri, isTauri } from './platform.js'
import { refreshWebApp } from './pwaRefresh.js'
import { showToast } from './toast.js'

const RELEASES_URL =
  'https://api.github.com/repos/sunbeamhub/xml2jianpu/releases?per_page=30'
const SNOOZE_KEY = 'yipu-update-snooze'

export const currentVersion =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/** @type {import('vue').Ref<'idle' | 'checking' | 'ready' | 'error'>} */
export const checkStatus = ref('idle')
export const latestVersion = ref('')
/** @type {import('vue').Ref<ReleaseView[]>} */
export const releasesBetween = ref([])
export const updateAvailable = ref(false)
export const snoozedToday = ref(readSnoozedToday())

export const showUpdateDot = computed(
  () => updateAvailable.value && !snoozedToday.value
)

/** @type {ReleaseView | null} */
let latestRelease = null

/**
 * @typedef {{ name: string, url: string }} ReleaseAsset
 * @typedef {{
 *   version: string,
 *   tag: string,
 *   body: string,
 *   htmlUrl: string,
 *   assets: ReleaseAsset[],
 * }} ReleaseView
 */

/** @param {string} tag */
export function parseVersion(tag) {
  const match = String(tag || '')
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 正数表示 a 比 b 新 */
export function compareVersions(a, b) {
  const left = Array.isArray(a) ? a : parseVersion(a)
  const right = Array.isArray(b) ? b : parseVersion(b)
  if (!left || !right) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

/**
 * @param {Array<Record<string, unknown>>} releases
 * @param {string} current
 */
export function selectPublished(releases, current) {
  const currentParts = parseVersion(current)
  /** @type {Array<{ parts: number[], rel: Record<string, unknown> }>} */
  const published = []
  for (const rel of releases || []) {
    if (!rel || rel.draft || rel.prerelease) continue
    const parts = parseVersion(String(rel.tag_name || ''))
    if (!parts) continue
    published.push({ parts, rel })
  }
  published.sort((a, b) => compareVersions(b.parts, a.parts))
  const latest = published[0] ? toView(published[0].rel, published[0].parts) : null
  if (!latest || !currentParts || compareVersions(latest.version, currentParts) <= 0) {
    return { latest, between: [], updateAvailable: false }
  }
  const between = published
    .filter((item) => compareVersions(item.parts, currentParts) > 0)
    .map((item) => toView(item.rel, item.parts))
  return { latest, between, updateAvailable: true }
}

/**
 * @param {string} platform
 * @param {string} arch
 * @param {ReleaseView | null} release
 * @returns {{ kind: 'ios' } | { kind: 'open', url: string }}
 */
export function pickUpdateTarget(platform, arch, release) {
  const page = release?.htmlUrl || 'https://github.com/sunbeamhub/xml2jianpu/releases'
  if (platform === 'ios') return { kind: 'ios' }
  const assets = (release?.assets || []).filter(
    (asset) => asset?.url && asset.name && !asset.name.endsWith('.sig')
  )
  if (platform === 'android') {
    const apks = assets.filter((asset) => /_android_.*\.apk$/i.test(asset.name))
    const arm = apks.find((asset) => /aarch64|arm64/i.test(asset.name))
    return { kind: 'open', url: (arm || apks[0])?.url || page }
  }
  if (platform === 'windows') {
    const exe = assets.find(
      (asset) =>
        /_windows_.*\.exe$/i.test(asset.name) && nameMatchesArch(asset.name, arch)
    )
    return { kind: 'open', url: exe?.url || page }
  }
  if (platform === 'macos' || platform === 'darwin') {
    const dmg = assets.find(
      (asset) =>
        /_macos_.*\.dmg$/i.test(asset.name) && nameMatchesArch(asset.name, arch)
    )
    return { kind: 'open', url: dmg?.url || page }
  }
  if (platform === 'linux') {
    const linux = assets.filter(
      (asset) => /_linux_/i.test(asset.name) && nameMatchesArch(asset.name, arch)
    )
    const exts = new Set(linux.map((asset) => extensionOf(asset.name)))
    if (linux.length === 1 || exts.size === 1) {
      return { kind: 'open', url: linux[0]?.url || page }
    }
    return { kind: 'open', url: page }
  }
  return { kind: 'open', url: page }
}

export async function checkForUpdate() {
  if (checkStatus.value === 'checking') return
  checkStatus.value = 'checking'
  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) throw new Error(String(response.status))
    const data = await response.json()
    const selected = selectPublished(
      Array.isArray(data) ? data : [],
      currentVersion
    )
    latestRelease = selected.latest
    latestVersion.value = selected.latest?.version || ''
    releasesBetween.value = selected.between
    updateAvailable.value = selected.updateAvailable
    checkStatus.value = 'ready'
  } catch {
    latestRelease = null
    latestVersion.value = ''
    releasesBetween.value = []
    updateAvailable.value = false
    checkStatus.value = 'error'
  }
}

export function snoozeUpdate() {
  const day = localDateISO()
  try {
    localStorage.setItem(SNOOZE_KEY, day)
  } catch {
    /* 隐私模式写不进时，本次会话仍去掉红点 */
  }
  snoozedToday.value = true
}

/** @returns {Promise<'ios' | 'web' | 'open'>} */
export async function applyUpdate() {
  if (!updateAvailable.value || !latestRelease) {
    throw new Error('没有可安装的新版本')
  }
  if (!isTauri()) {
    await refreshWebApp()
    return 'web'
  }
  if (isIosTauri()) return 'ios'
  const os = await import('@tauri-apps/plugin-os')
  const platform = await Promise.resolve(os.platform())
  const arch = await Promise.resolve(os.arch())
  const target = pickUpdateTarget(String(platform), String(arch), latestRelease)
  if (target.kind === 'ios') return 'ios'
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(target.url)
  return 'open'
}

export async function applyUpdateWithToast() {
  try {
    const kind = await applyUpdate()
    if (kind === 'open') {
      showToast('已打开安装包下载', { type: 'success' })
    }
    return kind
  } catch (err) {
    showToast(err?.message || '无法打开更新', { type: 'error' })
    throw err
  }
}

function readSnoozedToday() {
  try {
    return localStorage.getItem(SNOOZE_KEY) === localDateISO()
  } catch {
    return false
  }
}

function localDateISO() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * @param {Record<string, unknown>} rel
 * @param {number[]} parts
 * @returns {ReleaseView}
 */
function toView(rel, parts) {
  const assets = Array.isArray(rel.assets) ? rel.assets : []
  return {
    version: parts.join('.'),
    tag: String(rel.tag_name || ''),
    body: String(rel.body || '').trim(),
    htmlUrl: String(rel.html_url || ''),
    assets: assets
      .map((asset) => ({
        name: String(asset?.name || ''),
        url: String(asset?.browser_download_url || ''),
      }))
      .filter((asset) => asset.name && asset.url),
  }
}

/** @param {string} name @param {string} arch */
function nameMatchesArch(name, arch) {
  const token = archToken(arch)
  if (!token) return true
  if (token === 'x86_64') return /x86_64|amd64|x64/i.test(name)
  if (token === 'aarch64') return /aarch64|arm64/i.test(name)
  if (token === 'i686') return /i686|i386/i.test(name)
  return name.includes(token)
}

/** @param {string} arch */
function archToken(arch) {
  if (arch === 'x86_64' || arch === 'x64' || arch === 'amd64') return 'x86_64'
  if (arch === 'aarch64' || arch === 'arm64') return 'aarch64'
  if (arch === 'i686' || arch === 'x86' || arch === 'i386') return 'i686'
  return arch || ''
}

/** @param {string} name */
function extensionOf(name) {
  const match = String(name).match(/(\.[^.]+)$/)
  return (match?.[1] || '').toLowerCase()
}
