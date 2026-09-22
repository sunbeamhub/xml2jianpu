const SVG_NS = 'http://www.w3.org/2000/svg'
const PAD = 3

/**
 * 按音符 g 的整块边界（含歌词）铺一层背景。矩形插在 g 前面，不改墨色。
 * @param {SVGSVGElement | null | undefined} svg
 */
export function mountJianpuPlayheads(svg) {
  if (!svg) return
  svg.querySelectorAll('.jianpu-playhead').forEach((el) => el.remove())
  const notes = svg.querySelectorAll('g.note[data-onset]')
  notes.forEach((g) => {
    let box
    try {
      box = g.getBBox()
    } catch {
      return
    }
    if (!(box.width > 0 || box.height > 0)) return
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('class', 'jianpu-playhead')
    rect.setAttribute('data-onset', g.getAttribute('data-onset') || '')
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
  rects.forEach((rect) => {
    const on = target != null && rect.getAttribute('data-onset') === target
    const next = on ? 'visible' : 'hidden'
    if (rect.getAttribute('visibility') !== next) {
      rect.setAttribute('visibility', next)
    }
  })
}
