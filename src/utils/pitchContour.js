/**
 * 从播放日程生成音高轮廓。越高的音振幅越大，画出时以水平中线上下对称。
 * @param {Array<{ time: number, duration: number, midi: number }>} events
 * @param {number} durationSec
 * @param {number} [bucketCount]
 * @returns {{ heights: number[], minMidi: number, maxMidi: number }}
 */
export function buildPitchContour(events, durationSec, bucketCount = 128) {
  const n = Math.max(16, Math.min(256, Math.round(Number(bucketCount) || 128)))
  const dur = Math.max(0.01, Number(durationSec) || 0.01)
  const peaks = new Array(n).fill(null)
  let minMidi = 127
  let maxMidi = 0

  for (const ev of events || []) {
    const midi = Number(ev.midi)
    if (!Number.isFinite(midi)) continue
    minMidi = Math.min(minMidi, midi)
    maxMidi = Math.max(maxMidi, midi)
    const t0 = Math.max(0, Number(ev.time) || 0)
    const t1 = Math.max(t0, t0 + (Number(ev.duration) || 0))
    const i0 = Math.max(0, Math.floor((t0 / dur) * n))
    const i1 = Math.min(n - 1, Math.ceil((t1 / dur) * n) - 1)
    for (let i = i0; i <= Math.max(i0, i1); i++) {
      if (peaks[i] == null || midi > peaks[i]) peaks[i] = midi
    }
  }

  if (maxMidi < minMidi) {
    minMidi = 60
    maxMidi = 72
  }
  if (maxMidi === minMidi) {
    maxMidi = minMidi + 12
  }

  const span = maxMidi - minMidi
  const heights = peaks.map((midi) => {
    if (midi == null) return 0
    return 0.12 + (0.88 * (midi - minMidi)) / span
  })

  return { heights, minMidi, maxMidi }
}

/**
 * @param {number[]} heights 0~1
 * @param {number} width
 * @param {number} height
 * @returns {string} SVG path d
 */
export function contourToSvgPath(heights, width, height) {
  const w = Math.max(1, Number(width) || 1)
  const h = Math.max(1, Number(height) || 1)
  const list = heights?.length ? heights : [0]
  const n = list.length
  const padY = 2
  const usable = Math.max(1, h - padY * 2)
  const mid = h / 2
  const step = w / n
  const amp = (value) => ((Number(value) || 0) * usable) / 2

  let d = ''
  for (let i = 0; i < n; i++) {
    const x0 = i * step
    const x1 = (i + 1) * step
    const y = mid - amp(list[i])
    if (i === 0) d += `M ${x0.toFixed(2)} ${y.toFixed(2)}`
    d += ` L ${x0.toFixed(2)} ${y.toFixed(2)} L ${x1.toFixed(2)} ${y.toFixed(2)}`
  }
  for (let i = n - 1; i >= 0; i--) {
    const x0 = i * step
    const x1 = (i + 1) * step
    const y = mid + amp(list[i])
    d += ` L ${x1.toFixed(2)} ${y.toFixed(2)} L ${x0.toFixed(2)} ${y.toFixed(2)}`
  }
  d += ' Z'
  return d
}
