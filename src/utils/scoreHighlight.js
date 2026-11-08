const SVG_NS = 'http://www.w3.org/2000/svg'
const PAD = 3
const NOTE_STACK = '.jianpu-digit, .octave-dot, .aug-dot, .extend-dash'
const beatSegmentsBySvg = new WeakMap()

/**
 * 保存简谱每一拍的水平区间与纵向范围，供指示线匀速滑过。
 * @param {SVGSVGElement | null | undefined} svg
 * @param {Array<{ measureIndex: number, startSec: number, endSec: number, x0: number, x1: number, yTop: number, yBottom: number, colIndex: number, lineIndex: number }>} segments
 */
export function setJianpuBeatSegments(svg, segments) {
  if (!svg) return
  beatSegmentsBySvg.set(svg, Array.isArray(segments) ? segments : [])
}

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

/** 和弦竖排的音同时起音、左右重叠；上下框相交时在交界中点切开 */
function splitStackOverlap(rects) {
  const byOnset = new Map()
  for (const rect of rects) {
    const onset = rect.getAttribute('data-onset')
    if (!onset) continue
    if (!byOnset.has(rect.parentNode)) byOnset.set(rect.parentNode, new Map())
    const groups = byOnset.get(rect.parentNode)
    if (!groups.has(onset)) groups.set(onset, [])
    groups.get(onset).push(rect)
  }
  const num = (rect, name) => Number(rect.getAttribute(name))
  const groups = [...byOnset.values()].flatMap((m) => [...m.values()])
  groups.forEach((group) => {
    if (group.length < 2) return
    group.sort((a, b) => num(a, 'y') - num(b, 'y'))
    for (let i = 0; i < group.length - 1; i++) {
      const upper = group[i]
      for (let k = i + 1; k < group.length; k++) {
        const lower = group[k]
        const ux = num(upper, 'x')
        const lx = num(lower, 'x')
        if (ux + num(upper, 'width') <= lx || lx + num(lower, 'width') <= ux) continue
        const uy = num(upper, 'y')
        const uBottom = uy + num(upper, 'height')
        const ly = num(lower, 'y')
        const lBottom = ly + num(lower, 'height')
        if (uBottom <= ly) continue
        const mid = (ly + uBottom) / 2
        upper.setAttribute('height', String(Math.max(0, mid - uy)))
        lower.setAttribute('y', String(mid))
        lower.setAttribute('height', String(Math.max(0, lBottom - mid)))
      }
    }
  })
}

/** 同一行相邻两音（如带升降号的宽框）左右相交时，在交界中点切开 */
function splitRowOverlap(rects) {
  const num = (rect, name) => Number(rect.getAttribute(name))
  const byParent = new Map()
  for (const rect of rects) {
    if (!byParent.has(rect.parentNode)) byParent.set(rect.parentNode, [])
    byParent.get(rect.parentNode).push(rect)
  }
  byParent.forEach((list) => {
    list.sort((a, b) => num(a, 'x') - num(b, 'x'))
    for (let i = 0; i < list.length; i++) {
      const left = list[i]
      for (let k = i + 1; k < list.length; k++) {
        const right = list[k]
        const lx = num(left, 'x')
        const leftEnd = lx + num(left, 'width')
        const rx = num(right, 'x')
        if (rx >= leftEnd) break
        if (left.getAttribute('data-onset') === right.getAttribute('data-onset')) continue
        const ly = num(left, 'y')
        const ry = num(right, 'y')
        if (ly >= ry + num(right, 'height') || ry >= ly + num(left, 'height')) continue
        const rightEnd = rx + num(right, 'width')
        const mid = (rx + leftEnd) / 2
        left.setAttribute('width', String(Math.max(0, mid - lx)))
        right.setAttribute('x', String(mid))
        right.setAttribute('width', String(Math.max(0, rightEnd - mid)))
      }
    }
  })
}

/**
 * 按唱名本身（不含歌词、连音弧）铺一层背景。矩形插在 g 前面，不改墨色。
 * @param {SVGSVGElement | null | undefined} svg
 */
export function mountJianpuPlayheads(svg) {
  if (!svg) return
  svg.querySelectorAll('.jianpu-playhead, .jianpu-beat-line').forEach((el) => el.remove())
  const notes = svg.querySelectorAll('g.note[data-onset]')
  const playheads = []
  const measureMinY = new Map()
  const measureMaxY = new Map()
  notes.forEach((g) => {
    let box
    try {
      box = notePlayheadBox(g)
    } catch {
      return
    }
    if (!box || !(box.width > 0 || box.height > 0)) return
    const ry = box.y - PAD
    const rh = Math.max(0, box.height + PAD * 2)
    const noteId = g.getAttribute('data-note') || ''
    const mIdx = Number(noteId.split('-')[0])
    if (Number.isFinite(mIdx)) {
      const prevMin = measureMinY.get(mIdx)
      const prevMax = measureMaxY.get(mIdx)
      measureMinY.set(mIdx, prevMin == null ? ry : Math.min(prevMin, ry))
      measureMaxY.set(mIdx, prevMax == null ? ry + rh : Math.max(prevMax, ry + rh))
    }
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('class', 'jianpu-playhead')
    rect.setAttribute('data-onset', g.getAttribute('data-onset') || '')
    const end = g.getAttribute('data-end')
    if (end) rect.setAttribute('data-end', end)
    const times = g.getAttribute('data-times')
    if (times) rect.setAttribute('data-times', times)
    const tie = g.getAttribute('data-tie')
    if (tie) rect.setAttribute('data-tie', tie)
    rect.setAttribute('x', String(box.x - PAD))
    rect.setAttribute('y', String(ry))
    rect.setAttribute('width', String(Math.max(0, box.width + PAD * 2)))
    rect.setAttribute('height', String(rh))
    rect.setAttribute('rx', '3')
    rect.setAttribute('fill', 'var(--color-accent)')
    rect.setAttribute('fill-opacity', '0.35')
    rect.setAttribute('visibility', 'hidden')
    rect.setAttribute('pointer-events', 'none')
    g.parentNode?.insertBefore(rect, g)
    playheads.push(rect)
  })
  splitStackOverlap(playheads)
  splitTieOverlap(svg)
  splitRowOverlap(playheads)
  const segments = beatSegmentsBySvg.get(svg)
  if (segments && segments.length && measureMinY.size) {
    const lineMinY = new Map()
    const lineMaxY = new Map()
    for (const seg of segments) {
      const minY = measureMinY.get(seg.measureIndex)
      const maxY = measureMaxY.get(seg.measureIndex)
      if (minY != null) {
        const cur = lineMinY.get(seg.lineIndex)
        lineMinY.set(seg.lineIndex, cur == null ? minY : Math.min(cur, minY))
      }
      if (maxY != null) {
        const cur = lineMaxY.get(seg.lineIndex)
        lineMaxY.set(seg.lineIndex, cur == null ? maxY : Math.max(cur, maxY))
      }
    }
    const overhang = 9
    for (const seg of segments) {
      const minY = lineMinY.get(seg.lineIndex)
      const maxY = lineMaxY.get(seg.lineIndex)
      if (minY != null) seg.yTop = Math.min(seg.yTop, minY - overhang)
      if (maxY != null) seg.yBottom = Math.max(seg.yBottom, maxY + overhang)
    }
  }
  svg.querySelectorAll('g.score-col').forEach((colG, idx) => {
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('class', 'jianpu-beat-line')
    line.setAttribute('data-col', String(idx))
    line.setAttribute('x1', '0')
    line.setAttribute('x2', '0')
    line.setAttribute('y1', '0')
    line.setAttribute('y2', '0')
    line.setAttribute('stroke', 'var(--color-accent)')
    line.setAttribute('stroke-width', '2.2')
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('visibility', 'hidden')
    line.setAttribute('pointer-events', 'none')
    colG.appendChild(line)
  })
}

/**
 * 每个音在 [onset, end) 内保持高亮。连谱里时值重叠的音可以同时亮。
 * 同一连音只要有一个音落在时值内，整组保持高亮。
 * failedKeys 中的步骤保持红色高亮（--color-danger），直到新一轮重置。
 * @param {SVGSVGElement | null | undefined} svg
 * @param {number} seconds
 * @param {boolean} visible
 * @param {Set<string> | null | undefined} [failedKeys]
 */
export function syncJianpuPlayheads(svg, seconds, visible, failedKeys) {
  if (!svg) return
  const rects = svg.querySelectorAll('.jianpu-playhead')
  if (!rects.length) return
  const failed = failedKeys instanceof Set ? failedKeys : null
  const now = Number(seconds) || 0
  const sounding = new Set()
  const activeTies = new Set()
  const failedTies = new Set()
  if (visible) {
    rects.forEach((rect) => {
      if (!playheadSounding(rect, now)) return
      sounding.add(rect)
      const tie = rect.getAttribute('data-tie')
      if (tie) activeTies.add(tie)
    })
  }
  const failedRects = new Set()
  if (failed && failed.size) {
    rects.forEach((rect) => {
      if (!playheadIntervals(rect).some(([onset]) => failed.has(onset))) return
      failedRects.add(rect)
      const tie = rect.getAttribute('data-tie')
      if (tie) failedTies.add(tie)
    })
  }
  rects.forEach((rect) => {
    const tie = rect.getAttribute('data-tie')
    const isCurrent =
      sounding.has(rect) || (tie != null && activeTies.has(tie))
    const isFailed =
      failedRects.has(rect) || (tie != null && failedTies.has(tie))
    const on = isCurrent || (visible && isFailed)
    const nextVis = on ? 'visible' : 'hidden'
    if (rect.getAttribute('visibility') !== nextVis) {
      rect.setAttribute('visibility', nextVis)
    }
    const nextFill = isFailed ? 'var(--color-danger)' : 'var(--color-accent)'
    if (rect.getAttribute('fill') !== nextFill) {
      rect.setAttribute('fill', nextFill)
    }
    if (isCurrent) {
      rect.setAttribute('data-active', 'true')
    } else if (rect.hasAttribute('data-active')) {
      rect.removeAttribute('data-active')
    }
  })
}

/** onset ≤ now < end。结束时刻交给下一个音，避免两音交界处叠亮。
 * data-end 的误差必须小于这里的 1e-6。跟弹把时间停在下一步的精确 onset 上，
 * 结束时间若略晚于该 onset，上一音会亮满整个下一步。 */
function playheadSounding(rect, now) {
  for (const [onsetKey, end] of playheadIntervals(rect)) {
    const onset = Number(onsetKey)
    if (!Number.isFinite(onset) || onset > now + 1e-3) continue
    if (Number.isFinite(end) && now < end - 1e-6) return true
  }
  return false
}

/** @type {WeakMap<Element, Array<[string, number]>>} */
const intervalCache = new WeakMap()

/**
 * 音符各遍的 [onset key, end 秒]。反复时 data-times 列出每一遍，否则只有 data-onset/data-end。
 * @param {Element} rect
 * @returns {Array<[string, number]>}
 */
export function playheadIntervals(rect) {
  const cached = intervalCache.get(rect)
  if (cached) return cached
  const times = rect.getAttribute('data-times')
  /** @type {Array<[string, number]>} */
  let list
  if (times) {
    list = times
      .split(' ')
      .map((pair) => pair.split(':'))
      .filter((p) => p.length === 2 && p[0])
      .map(([onset, end]) => [onset, Number(end)])
  } else {
    const onset = rect.getAttribute('data-onset') || ''
    list = onset ? [[onset, Number(rect.getAttribute('data-end'))]] : []
  }
  intervalCache.set(rect, list)
  return list
}

/**
 * 同步简谱竖直指示线：在当前拍起止时间内匀速滑过该拍宽度，换行/换列时跳到下一行起点。
 * @param {SVGSVGElement | null | undefined} svg
 * @param {number} seconds
 * @param {boolean} visible
 */
export function syncJianpuBeatLine(svg, seconds, visible) {
  if (!svg) return
  const lines = svg.querySelectorAll('.jianpu-beat-line')
  if (!lines.length) return
  const segments = beatSegmentsBySvg.get(svg)
  if (!visible || !segments || !segments.length) {
    lines.forEach((line) => {
      if (line.getAttribute('visibility') !== 'hidden') {
        line.setAttribute('visibility', 'hidden')
      }
      if (line.hasAttribute('data-active')) line.removeAttribute('data-active')
    })
    return
  }
  const now = Math.max(0, Number(seconds) || 0)
  let seg = segments[segments.length - 1]
  for (let i = 0; i < segments.length; i++) {
    const item = segments[i]
    if (now < item.endSec - 1e-6 || i === segments.length - 1) {
      seg = item
      break
    }
  }
  const dur = Math.max(1e-6, seg.endSec - seg.startSec)
  const ratio = Math.max(0, Math.min(1, (now - seg.startSec) / dur))
  const x = seg.x0 + (seg.x1 - seg.x0) * ratio
  lines.forEach((line) => {
    const col = Number(line.getAttribute('data-col'))
    if (col === seg.colIndex) {
      line.setAttribute('x1', x.toFixed(2))
      line.setAttribute('x2', x.toFixed(2))
      line.setAttribute('y1', seg.yTop.toFixed(2))
      line.setAttribute('y2', seg.yBottom.toFixed(2))
      if (line.getAttribute('visibility') !== 'visible') {
        line.setAttribute('visibility', 'visible')
      }
      line.setAttribute('data-active', 'true')
    } else {
      if (line.getAttribute('visibility') !== 'hidden') {
        line.setAttribute('visibility', 'hidden')
      }
      if (line.hasAttribute('data-active')) line.removeAttribute('data-active')
    }
  })
}
