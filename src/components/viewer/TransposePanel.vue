<script>
import { defineComponent, h, ref, onMounted, onBeforeUnmount } from 'vue'
import {
  AUDIO_INSTRUMENT_SYNTH,
  AUDIO_INSTRUMENTS,
} from '../../utils/scoreAudioPlayer.js'
import { buildPitchContour, contourToSvgPath } from '../../utils/pitchContour.js'
import { armPageZoomBlock } from '../../utils/pageZoomBlock.js'
import AppSelect from '../AppSelect.vue'

export const TRANSPOSE_LIMIT = 12

function formatOffsetLabel(n) {
  if (n > 0) return `+${n} 半音`
  if (n < 0) return `${n} 半音`
  return '0 半音'
}

function splitKeyName(name) {
  const n = name || 'C'
  if (n.startsWith('b') || n.startsWith('#')) {
    return { accidental: n[0], letter: n.slice(1) }
  }
  return { accidental: '', letter: n }
}

function keyInline(name) {
  const { accidental, letter } = splitKeyName(name)
  return [
    '1=',
    accidental
      ? h('span', { class: 'transpose-accidental' }, accidental)
      : null,
    letter,
  ]
}

export const TransposeIcon = defineComponent({
  name: 'TransposeIcon',
  setup() {
    return () =>
      h(
        'svg',
        {
          class: 'menu-icon',
          viewBox: '0 0 24 24',
          width: 22,
          height: 22,
          'aria-hidden': 'true',
        },
        [
          h('path', {
            fill: 'currentColor',
            d: 'M4 4h16v2H4V4zm0 7h16v2H4v-2zm0 7h16v2H4v-2z',
          }),
          h('path', {
            d: 'M9.5 9.3 12 6.8l2.5 2.5',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.7,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
          h('path', {
            d: 'M9.5 14.7 12 17.2l2.5-2.5',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.7,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        ]
      )
  },
})

const CONTOUR_VIEW_W = 320
const CONTOUR_VIEW_H = 44
let waveClipSeq = 0

export default defineComponent({
  name: 'TransposePanel',
  props: {
    originalKeyName: { type: String, default: 'C' },
    transposeSemitones: { type: Number, default: 0 },
    fixedDo: { type: Boolean, default: false },
    audioReady: { type: Boolean, default: false },
    audioPlaying: { type: Boolean, default: false },
    audioProgress: { type: Number, default: 0 },
    audioLoading: { type: Boolean, default: false },
    audioInstrument: { type: String, default: AUDIO_INSTRUMENT_SYNTH },
    audioInstrumentLoading: { type: Boolean, default: false },
    audioEvents: { type: Array, default: () => [] },
    audioDuration: { type: Number, default: 0 },
  },
  emits: ['set', 'reset', 'audio-toggle', 'audio-stop', 'audio-seek', 'audio-instrument'],
  setup(props, { emit }) {
    const sliderDraft = ref(null)
    const waveEl = ref(null)
    const hasPointerEvent =
      typeof window !== 'undefined' && typeof window.PointerEvent === 'function'
    const waveClipId = `transpose-wave-played-${++waveClipSeq}`
    let flushTimer = 0
    let pending = null
    let scrubbing = false

    const displayedN = () =>
      sliderDraft.value != null
        ? sliderDraft.value
        : props.fixedDo
          ? props.transposeSemitones
          : 0

    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = 0
      }
      if (pending == null) return
      const n = pending
      pending = null
      sliderDraft.value = null
      emit('set', n)
    }

    const commit = (value, immediate) => {
      const n = Math.max(
        -TRANSPOSE_LIMIT,
        Math.min(TRANSPOSE_LIMIT, Math.round(Number(value) || 0))
      )
      sliderDraft.value = n
      pending = n
      if (immediate) {
        flush()
        return
      }
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = window.setTimeout(flush, 280)
    }

    const touchClientX = (e) => {
      const touch = e.touches?.[0] || e.changedTouches?.[0]
      return touch ? touch.clientX : null
    }

    const onScrubTouchStart = (e) => {
      if (props.audioLoading || !props.audioReady) return
      const x = touchClientX(e)
      if (x == null) return
      if (e.cancelable) e.preventDefault()
      scrubbing = true
      emit('audio-seek', ratioFromPointer(e.currentTarget, x), { dragging: true })
    }

    const onScrubTouchMove = (e) => {
      if (!scrubbing) return
      const x = touchClientX(e)
      if (x == null) return
      if (e.cancelable) e.preventDefault()
      emit('audio-seek', ratioFromPointer(e.currentTarget, x), { dragging: true })
    }

    const onScrubTouchEnd = (e) => {
      if (!scrubbing) return
      const x = touchClientX(e)
      scrubbing = false
      if (x == null) return
      emit('audio-seek', ratioFromPointer(e.currentTarget, x), { dragging: false })
    }

    const bindTouchScrub = (el) => {
      el.addEventListener('touchstart', onScrubTouchStart, { passive: false })
      el.addEventListener('touchmove', onScrubTouchMove, { passive: false })
      el.addEventListener('touchend', onScrubTouchEnd)
      el.addEventListener('touchcancel', onScrubTouchEnd)
    }

    const unbindTouchScrub = (el) => {
      el.removeEventListener('touchstart', onScrubTouchStart)
      el.removeEventListener('touchmove', onScrubTouchMove)
      el.removeEventListener('touchend', onScrubTouchEnd)
      el.removeEventListener('touchcancel', onScrubTouchEnd)
    }

    onMounted(() => {
      if (hasPointerEvent || !waveEl.value) return
      bindTouchScrub(waveEl.value)
    })

    onBeforeUnmount(() => {
      flush()
      if (waveEl.value) unbindTouchScrub(waveEl.value)
    })

    let tapFromTouch = false
    const bindTap = (handler, isDisabled) => ({
      onClick: () => {
        if (isDisabled) return
        if (tapFromTouch) {
          tapFromTouch = false
          return
        }
        handler()
      },
      onTouchend: (e) => {
        if (e.cancelable) e.preventDefault()
        armPageZoomBlock()
        if (isDisabled) return
        tapFromTouch = true
        handler()
        window.setTimeout(() => {
          tapFromTouch = false
        }, 500)
      },
      onDblclick: (e) => e.preventDefault(),
    })

    const ratioFromPointer = (el, clientX) => {
      const rect = el.getBoundingClientRect()
      if (!rect.width) return 0
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    }

    const onScrubPointerDown = (e) => {
      if (props.audioLoading || !props.audioReady) return
      const el = e.currentTarget
      scrubbing = true
      el.setPointerCapture?.(e.pointerId)
      emit('audio-seek', ratioFromPointer(el, e.clientX), { dragging: true })
    }

    const onScrubPointerMove = (e) => {
      if (!scrubbing) return
      emit('audio-seek', ratioFromPointer(e.currentTarget, e.clientX), {
        dragging: true,
      })
    }

    const endScrub = (e) => {
      if (!scrubbing) return
      scrubbing = false
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      } catch {
        /* ignore */
      }
      emit('audio-seek', ratioFromPointer(e.currentTarget, e.clientX), {
        dragging: false,
      })
    }

    return () => {
      const n = displayedN()
      const atMin = n <= -TRANSPOSE_LIMIT
      const atMax = n >= TRANSPOSE_LIMIT
      const dragging = sliderDraft.value != null
      const currentKey = dragging || props.fixedDo ? 'C' : props.originalKeyName
      const canReset =
        n !== 0 || (props.fixedDo && props.originalKeyName !== 'C')
      const progress = Math.max(
        0,
        Math.min(1, Number(props.audioProgress) || 0)
      )
      const audioBusy = props.audioLoading || props.audioInstrumentLoading
      const audioDisabled = audioBusy || !props.audioReady
      const instrumentLabel =
        AUDIO_INSTRUMENTS.find((item) => item.value === props.audioInstrument)
          ?.label || '电子'
      const contour = buildPitchContour(
        props.audioEvents,
        props.audioDuration || 1,
        128
      )
      const contourPath = contourToSvgPath(
        contour.heights,
        CONTOUR_VIEW_W,
        CONTOUR_VIEW_H
      )
      const playheadX = progress * CONTOUR_VIEW_W

      const roundGlyph = (kind) =>
        h(
          'svg',
          {
            class: 'transpose-round-icon',
            viewBox: '0 0 24 24',
            width: 18,
            height: 18,
            'aria-hidden': 'true',
          },
          [
            h('path', {
              d: kind === 'plus' ? 'M12 5v14M5 12h14' : 'M5 12h14',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': 2,
              'stroke-linecap': 'round',
            }),
          ]
        )
      const roundBtn = (kind, aria, next, disabled) =>
        h(
          'button',
          {
            type: 'button',
            class: 'transpose-round',
            'aria-label': aria,
            disabled,
            ...bindTap(() => commit(next, true), disabled),
          },
          [roundGlyph(kind)]
        )
      const playTriangle = h('path', {
        d: 'M8 5.5v13l11-6.5L8 5.5z',
        fill: 'currentColor',
      })
      const pauseBars = h('path', {
        d: 'M8 6h3v12H8zm5 0h3v12h-3z',
        fill: 'currentColor',
      })
      const stopSquare = h('rect', {
        x: 6,
        y: 6,
        width: 12,
        height: 12,
        rx: 1.5,
        fill: 'currentColor',
      })
      const audioIcon = (glyph) =>
        h(
          'svg',
          {
            class: 'transpose-audio-icon',
            viewBox: '0 0 24 24',
            width: 18,
            height: 18,
            'aria-hidden': 'true',
          },
          [glyph]
        )
      const transportLive = props.audioPlaying || progress > 0.01
      const stopDisabled = audioDisabled || !transportLive
      const playLabel = props.audioPlaying
        ? '暂停'
        : transportLive
          ? '继续播放'
          : '播放'
      const sliderTicks = []
      const tickCount = TRANSPOSE_LIMIT * 2
      for (let i = 0; i <= tickCount; i++) {
        const kind =
          i === 0 || i === TRANSPOSE_LIMIT || i === tickCount
            ? 'major'
            : i === TRANSPOSE_LIMIT / 2 || i === TRANSPOSE_LIMIT + TRANSPOSE_LIMIT / 2
              ? 'mid'
              : 'minor'
        sliderTicks.push(
          h('span', {
            class: ['transpose-slider-tick', `transpose-slider-tick--${kind}`],
            style: {
              left: `calc(10px + (100% - 20px) * ${i / tickCount})`,
            },
          })
        )
      }

      return h('div', { class: 'transpose-panel' }, [
        h('div', { class: 'transpose-panel-head' }, [
          h('div', { class: 'transpose-panel-title' }, '移调'),
          h(
            'button',
            {
              type: 'button',
              class: 'transpose-reset',
              disabled: !canReset,
              ...bindTap(() => {
                if (flushTimer) {
                  clearTimeout(flushTimer)
                  flushTimer = 0
                }
                pending = null
                sliderDraft.value = null
                emit('reset')
              }, !canReset),
            },
            '还原'
          ),
        ]),
        h('div', { class: 'transpose-stepper' }, [
          roundBtn('minus', '降低半音', n - 1, atMin),
          h('div', { class: 'transpose-stepper-status' }, [
            h('div', { class: 'transpose-panel-status' }, formatOffsetLabel(n)),
            h('div', { class: 'transpose-panel-current' }, [
              '原曲 ',
              ...keyInline(props.originalKeyName),
              '，当前 ',
              ...keyInline(currentKey),
            ]),
          ]),
          roundBtn('plus', '升高半音', n + 1, atMax),
        ]),
        h('div', { class: 'transpose-slider-wrap' }, [
          h('input', {
            type: 'range',
            class: 'transpose-slider',
            min: -TRANSPOSE_LIMIT,
            max: TRANSPOSE_LIMIT,
            step: 1,
            value: n,
            'aria-label': '移调半音',
            'aria-valuemin': -TRANSPOSE_LIMIT,
            'aria-valuemax': TRANSPOSE_LIMIT,
            'aria-valuenow': n,
            onInput: (e) => commit(Number(e.target.value), false),
            onChange: (e) => commit(Number(e.target.value), true),
          }),
          h('div', { class: 'transpose-slider-ticks' }, sliderTicks),
          h('div', { class: 'transpose-slider-labels' }, [
            h('span', '-1 八度'),
            h('span', '0'),
            h('span', '+1 八度'),
          ]),
        ]),
        h('div', { class: 'transpose-audio' }, [
          h(
            'button',
            {
              type: 'button',
              class: 'transpose-round',
              disabled: audioDisabled,
              'aria-label': playLabel,
              'aria-pressed': props.audioPlaying,
              ...bindTap(() => emit('audio-toggle'), audioDisabled),
            },
            [audioIcon(props.audioPlaying ? pauseBars : playTriangle)]
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'transpose-round',
              disabled: stopDisabled,
              'aria-label': '停止',
              ...bindTap(() => emit('audio-stop'), stopDisabled),
            },
            [audioIcon(stopSquare)]
          ),
          h(
            'div',
            {
              ref: waveEl,
              class: [
                'transpose-audio-wave',
                audioDisabled ? 'is-disabled' : '',
              ],
              role: 'slider',
              tabindex: audioDisabled ? -1 : 0,
              'aria-label': '试听进度',
              'aria-valuemin': 0,
              'aria-valuemax': 1000,
              'aria-valuenow': Math.round(progress * 1000),
              ...(hasPointerEvent
                ? {
                    onPointerdown: onScrubPointerDown,
                    onPointermove: onScrubPointerMove,
                    onPointerup: endScrub,
                    onPointercancel: endScrub,
                  }
                : {}),
            },
            [
              h(
                'svg',
                {
                  class: 'transpose-audio-wave-svg',
                  viewBox: `0 0 ${CONTOUR_VIEW_W} ${CONTOUR_VIEW_H}`,
                  preserveAspectRatio: 'none',
                  'aria-hidden': 'true',
                },
                [
                  h('defs', [
                    h(
                      'clipPath',
                      { id: waveClipId },
                      [
                        h('rect', {
                          x: 0,
                          y: 0,
                          width: Math.max(0, playheadX),
                          height: CONTOUR_VIEW_H,
                        }),
                      ]
                    ),
                  ]),
                  h('path', {
                    class: 'transpose-audio-wave-fill',
                    d: contourPath,
                  }),
                  ...(transportLive
                    ? [
                        h('path', {
                          class: 'transpose-audio-wave-played',
                          d: contourPath,
                          'clip-path': `url(#${waveClipId})`,
                        }),
                        h('line', {
                          class: 'transpose-audio-playhead',
                          x1: playheadX,
                          x2: playheadX,
                          y1: 0,
                          y2: CONTOUR_VIEW_H,
                        }),
                      ]
                    : []),
                ]
              ),
            ]
          ),
          h(AppSelect, {
            class: 'transpose-timbre',
            modelValue: props.audioInstrument,
            options: AUDIO_INSTRUMENTS,
            label: instrumentLabel,
            ariaLabel: `音色：${instrumentLabel}`,
            variant: 'chip',
            nowrap: true,
            panelMinWidth: 120,
            disabled: audioBusy,
            'onUpdate:modelValue': (value) => emit('audio-instrument', value),
          }),
        ]),
      ])
    }
  },
})
</script>

<style scoped>
.transpose-panel {
  box-sizing: border-box;
  width: 100%;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: var(--menu-radius);
  background: var(--color-page-bg);
  color: var(--color-text-primary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.transpose-panel .transpose-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 16px;
}

.transpose-panel .transpose-panel-head > * + * {
  margin-left: 12px;
}

.transpose-panel .transpose-panel-title {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.3;
}

.transpose-panel .transpose-reset {
  box-sizing: border-box;
  height: 36px;
  margin: 0;
  padding: 0 16px;
  border: 1px solid var(--color-accent);
  border-radius: 999px;
  background: transparent;
  color: var(--color-accent);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
}

.transpose-panel .transpose-reset:hover:not(:disabled) {
  background: var(--color-accent);
  color: #ffffff;
}

.transpose-panel .transpose-reset:disabled {
  border-color: var(--color-border);
  color: var(--color-text-secondary);
  cursor: not-allowed;
}

.transpose-panel .transpose-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 20px;
  padding: 16px;
  border-radius: 12px;
  background: var(--color-menu-light-bg);
}

.transpose-panel .transpose-stepper > * + * {
  margin-left: 8px;
}

.transpose-panel .transpose-stepper-status {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.transpose-panel .transpose-panel-status {
  font-size: 26px;
  font-weight: 500;
  line-height: 1.25;
}

.transpose-panel .transpose-panel-current {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.3;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.transpose-panel .transpose-accidental {
  font-size: 13px;
  vertical-align: 0.5em;
  margin-right: 1px;
}

.transpose-panel .transpose-round {
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-menu-divider);
  border-radius: 50%;
  background: var(--color-menu-light-bg);
  color: inherit;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  touch-action: manipulation;
}

.transpose-panel .transpose-round-icon {
  display: block;
  flex-shrink: 0;
}

.transpose-panel .transpose-round:hover:not(:disabled) {
  background: var(--color-menu-divider);
}

.transpose-panel .transpose-round:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.transpose-panel .transpose-slider-wrap {
  position: relative;
  margin: 0 0 4px;
}

.transpose-panel .transpose-slider {
  position: relative;
  z-index: 2;
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 4px;
  margin: 8px 0 0;
  padding: 0;
  background: var(--color-menu-divider);
  border-radius: 999px;
  outline: none;
  touch-action: none;
}

.transpose-panel .transpose-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.transpose-panel .transpose-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.transpose-panel .transpose-slider::-moz-range-track {
  height: 4px;
  background: var(--color-menu-divider);
  border-radius: 999px;
}

.transpose-panel .transpose-slider-ticks {
  position: relative;
  z-index: 1;
  height: 10px;
  margin-top: 0;
  pointer-events: none;
}

.transpose-panel .transpose-slider-tick {
  position: absolute;
  top: 0;
  width: 1px;
  background: var(--color-border);
}

.transpose-panel .transpose-slider-tick--minor {
  height: 4px;
}

.transpose-panel .transpose-slider-tick--mid {
  height: 7px;
}

.transpose-panel .transpose-slider-tick--major {
  height: 10px;
  background: var(--color-text-secondary);
}

.transpose-panel .transpose-slider-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--color-text-secondary);
}

.transpose-panel .transpose-audio {
  display: flex;
  align-items: center;
  margin: 16px 0 0;
}

.transpose-panel .transpose-audio > * + * {
  margin-left: 8px;
}

.transpose-panel .transpose-audio-icon {
  display: block;
  flex-shrink: 0;
}

.transpose-panel .transpose-timbre {
  flex: 0 0 auto;
  box-sizing: border-box;
  height: 44px;
  min-height: 0;
  padding: 0;
  border: 1px solid var(--color-menu-divider);
  border-radius: 8px;
  background: var(--color-menu-light-bg);
  color: inherit;
  font-size: 14px;
}

.transpose-panel :deep(.app-select-trigger) {
  box-sizing: border-box;
  height: 44px;
  min-height: 0;
  padding: 0 12px;
  font-size: 14px;
  line-height: 1;
}

.transpose-panel .transpose-audio-wave {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 44px;
  border-radius: 8px;
  background: var(--color-menu-light-bg);
  overflow: hidden;
  touch-action: none;
  cursor: ew-resize;
}

.transpose-panel .transpose-audio-wave.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.transpose-panel .transpose-audio-wave-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.transpose-panel .transpose-audio-wave-fill {
  fill: var(--color-accent);
  fill-opacity: 0.35;
}

.transpose-panel .transpose-audio-wave-played {
  fill: var(--color-accent);
  fill-opacity: 0.9;
}

.transpose-panel .transpose-audio-playhead {
  stroke: var(--color-accent);
  stroke-width: 2;
  stroke-linecap: round;
}
</style>
