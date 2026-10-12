import { buildTempoSpans } from './musicXmlSchedule.js'

export function tempoPlaybackRatio(scoreBpm, playbackBpm) {
  const score = Number(scoreBpm)
  const play = Number(playbackBpm)
  if (!(score > 0) || !(play > 0)) return 1
  return play / score
}

export function scaleTempoNumber(written, ratio) {
  const n = Number(String(written ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return ''
  const rate = Number(ratio) > 0 ? Number(ratio) : 1
  return String(Math.round(n * rate))
}

let tempoCacheXml = ''
/** @type {number[]} */
let tempoCache = []

export function tempoNumbersInXml(xmlString) {
  const xml = String(xmlString || '')
  if (xml === tempoCacheXml) return tempoCache
  tempoCacheXml = xml
  try {
    tempoCache = buildTempoSpans(xml)
      .map((span) => Math.round(Number(span.bpm)))
      .filter((n) => n > 0)
  } catch {
    tempoCache = []
  }
  return tempoCache
}

/**
 * 把谱面上已有的「= 数字」按比例改掉。带 data-score-bpm 的用原值，避免重复缩放。
 * @param {ParentNode | null | undefined} root
 * @param {number} ratio
 * @param {number[]} [knownTempos]
 */
export function paintTempoMarks(root, ratio, knownTempos) {
  if (!root?.querySelectorAll) return
  const known = new Set(
    (knownTempos || []).map((n) => Math.round(Number(n))).filter((n) => n > 0)
  )
  const rate = Number(ratio) > 0 ? Number(ratio) : 1
  root.querySelectorAll('text').forEach((el) => {
    const marked = el.getAttribute('data-score-bpm')
    const raw = el.textContent || ''
    let original = marked
    if (!original) {
      const match = raw.match(/=\s*(\d+(?:\.\d+)?)/)
      if (!match) return
      const n = Math.round(Number(match[1]))
      if (!known.has(n)) return
      original = String(n)
      el.setAttribute('data-score-bpm', original)
    }
    const next = scaleTempoNumber(original, rate)
    if (!next || !/=\s*\d/.test(el.textContent || '')) return
    el.textContent = (el.textContent || '').replace(/=\s*\d+(?:\.\d+)?/, (chunk) =>
      /=\s+\d/.test(chunk) ? `= ${next}` : `=${next}`
    )
  })
}
