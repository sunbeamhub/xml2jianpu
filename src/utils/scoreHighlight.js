const SVG_NS = 'http://www.w3.org/2000/svg'
const PAD = 3
const NOTE_STACK = '.jianpu-digit, .octave-dot, .aug-dot, .extend-dash'

/** 子元素可能带 transform，换算到音符分组坐标后再取并集 */
function childBoxInGroup(g, el) {
  const b = el.getBBox()
  if (!(b.width > 0 || b.height > 0)) return null
  const groupCTM = g.getCTM()
  const elCTM = el.getCTM()
  if (!groupCTM || !elCTM) return null
  const m = groupCTM.inverse().multiply(elCTM)
  const pts = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    const nx = m.a * x + m.c * y + m.e
    const ny = m.b * x + m.d * y + m.f
    minX = Math.min(minX, nx)
    minY = Math.min(minY, ny)
    maxX = Math.max(maxX, nx)
    maxY = Math.max(maxY, ny)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function unionBoxes(g, selector, acc, xOnly) {
  g.querySelectorAll(selector).forEach((el) => {
    let box
    try {
      box = childBoxInGroup(g, el)
    } catch {
      return
    }
    if (!box) return
    acc.minX = Math.min(acc.minX, box.x)
    acc.maxX = Math.max(acc.maxX, box.x + box.width)
    if (xOnly) return
    acc.minY = Math.min(acc.minY, box.y)
    acc.maxY = Math.max(acc.maxY, box.y + box.height)
  })
}

/**
 * 上下沿只跟唱名、高低音点、附点、延音线。
 * 升降号只向左右扩宽，避免抬进上方的连音线。
 */
function notePlayheadBox(g) {
  const acc = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  }
  unionBoxes(g, NOTE_STACK, acc, false)
  if (!Number.isFinite(acc.minY)) return null
  unionBoxes(g, '.jianpu-accidental', acc, true)
  if (!Number.isFinite(acc.minX)) return null
  return {
    x: acc.minX,
    y: acc.minY,
    width: acc.maxX - acc.minX,
    height: acc.maxY - acc.minY,
  }
}

/** 同一连音的两块框左右相交时，在交界中点切开 */
function splitTieOverlap(svg) {
  const groups = new Map()
  svg.querySelectorAll('.jianpu-playhead[data-tie]').forEach((rect) => {
    const id = rect.getAttribute('data-tie')
    if (!id) return
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(rect)
  })
  groups.forEach((rects) => {
    rects.sort(
      (a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x'))
    )
    for (let i = 0; i < rects.length - 1; i++) {
      const left = rects[i]
      const right = rects[i + 1]
      const lx = Number(left.getAttribute('x'))
      const lw = Number(left.getAttribute('width'))
      const rx = Number(right.getAttribute('x'))
      const rw = Number(right.getAttribute('width'))
      const leftEnd = lx + lw
      const rightEnd = rx + rw
      if (!(leftEnd > rx && rightEnd > lx)) continue
      const mid = (Math.max(lx, rx) + Math.min(leftEnd, rightEnd)) / 2
      left.setAttribute('width', String(Math.max(0, mid - lx)))
      right.setAttribute('x', String(mid))
      right.setAttribute('width', String(Math.max(0, rightEnd - mid)))
    }
  })
}

/**
 * 按唱名本身（不含歌词、连音弧）铺一层背景。矩形插在 g 前面，不改墨色。
 * @param {SVGSVGElement | null | undefined} svg
 */
export function mountJianpuPlayheads(svg) {
  if (!svg) return
  svg.querySelectorAll('.jianpu-playhead').forEach((el) => el.remove())
  const notes = svg.querySelectorAll('g.note[data-onset]')
  notes.forEach((g) => {
    let box
    try {
      box = notePlayheadBox(g)
    } catch {
      return
    }
    if (!box || !(box.width > 0 || box.height > 0)) return
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('class', 'jianpu-playhead')
    rect.setAttribute('data-onset', g.getAttribute('data-onset') || '')
    const tie = g.getAttribute('data-tie')
    if (tie) rect.setAttribute('data-tie', tie)
    rect.setAttribute('x', String(box.x - PAD))
    rect.setAttribute('y', String(box.y - PAD))
    rect.setAttribute('width', String(Math.max(0, box.width + PAD * 2)))
    rect.setAttribute('height', String(Math.max(0, box.height + PAD * 2)))
    rect.setAttribute('rx', '3')
    rect.setAttribute('fill', 'var(--color-accent)')
    rect.setAttribute('fill-opacity', '0.35')
    rect.setAttribute('visibility', 'hidden')
    rect.setAttribute('pointer-events', 'none')
    g.parentNode?.insertBefore(rect, g)
  })
  splitTieOverlap(svg)
}

/**
 * 亮起 onset ≤ seconds 的最后一档（同一档的和弦、休止一起亮）。
 * @param {SVGSVGElement | null | undefined} svg
 * @param {number} seconds
 * @param {boolean} visible
 */
export function syncJianpuPlayheads(svg, seconds, visible) {
  if (!svg) return
  const rects = svg.querySelectorAll('.jianpu-playhead')
  if (!rects.length) return
  let target = null
  if (visible) {
    const now = Number(seconds) || 0
    rects.forEach((rect) => {
      const raw = rect.getAttribute('data-onset')
      const t = Number(raw)
      if (!Number.isFinite(t) || t > now + 1e-3) return
      if (target == null || t > Number(target) + 1e-6) target = raw
    })
  }
  const activeTies = new Set()
  if (target != null) {
    rects.forEach((rect) => {
      if (rect.getAttribute('data-onset') !== target) return
      const tie = rect.getAttribute('data-tie')
      if (tie) activeTies.add(tie)
    })
  }
  rects.forEach((rect) => {
    const tie = rect.getAttribute('data-tie')
    const on =
      target != null &&
      (rect.getAttribute('data-onset') === target ||
        (tie != null && activeTies.has(tie)))
    const next = on ? 'visible' : 'hidden'
    if (rect.getAttribute('visibility') !== next) {
      rect.setAttribute('visibility', next)
    }
  })
}
