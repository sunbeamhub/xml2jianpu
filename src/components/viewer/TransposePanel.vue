<script>
import {
  defineComponent,
  h,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
} from 'vue'
import {
  AUDIO_INSTRUMENT_SYNTH,
  AUDIO_INSTRUMENTS,
} from '../../utils/scoreAudioPlayer.js'
import { buildPitchContour, contourToSvgPath } from '../../utils/pitchContour.js'
import { armPageZoomBlock } from '../../utils/pageZoomBlock.js'
import AppSelect from '../AppSelect.vue'
import Button from '../ui/Button.vue'
import SegmentSwitch from '../ui/SegmentSwitch.vue'
import Switch from '../ui/Switch.vue'
import { FOLLOW_RHYTHM_TOLERANCES, DURATION_HUD_STYLES } from '../../utils/viewerPrefs.js'

function motionReduced() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** 用明确高度过渡，结束后回到 auto，里面再变高还能继续过渡 */
const HeightCollapse = defineComponent({
  name: 'HeightCollapse',
  props: {
    open: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const el = ref(null)
    const height = ref(props.open ? 'auto' : '0px')
    let armed = false
    let token = 0

    function settle(open, id) {
      if (id !== token) return
      height.value = open ? 'auto' : '0px'
    }

    onMounted(() => {
      height.value = props.open ? 'auto' : '0px'
      armed = true
    })

    onBeforeUnmount(() => {
      token += 1
    })

    function measureOpenHeight(node) {
      const height = node.style.height
      const align = node.style.alignSelf
      node.style.height = 'auto'
      node.style.alignSelf = 'flex-start'
      const full = node.scrollHeight
      node.style.height = height
      node.style.alignSelf = align
      return full
    }

    watch(
      () => props.open,
      (open) => {
        const node = el.value
        const id = ++token
        if (!node || !armed || motionReduced()) {
          settle(open, id)
          return
        }
        const from = node.getBoundingClientRect().height
        const full = measureOpenHeight(node)
        const fillRow = node.classList.contains('transpose-side-slot')
        const row = fillRow && node.parentElement
          ? node.parentElement.getBoundingClientRect().height
          : 0
        const target = open ? Math.max(full, from > 0 ? from : row) : 0
        if (Math.abs(from - target) < 1) {
          settle(open, id)
          return
        }
        height.value = `${from}px`
        setTimeout(() => {
          if (id !== token || !el.value) return
          void el.value.offsetHeight
          height.value = `${target}px`
          const onEnd = (event) => {
            if (event.target !== el.value || event.propertyName !== 'height') return
            el.value.removeEventListener('transitionend', onEnd)
            settle(open, id)
          }
          el.value.addEventListener('transitionend', onEnd)
        }, 20)
      },
      { flush: 'post' }
    )

    return () =>
        h(
          'div',
          {
            ref: el,
            class: 'transpose-collapse',
            style: { height: height.value },
            inert: props.open ? undefined : '',
          },
          slots.default ? slots.default() : []
        )
  },
})

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
          h('rect', {
            x: 2.2,
            y: 6,
            width: 19.6,
            height: 13,
            rx: 1.6,
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.8,
          }),
          h('path', {
            d: 'M7.1 19v-5.4M12 19v-5.4M16.9 19v-5.4',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.2,
            'stroke-linecap': 'round',
          }),
          h('rect', { x: 5.7, y: 6, width: 2.3, height: 7.2, rx: 0.4, fill: 'currentColor' }),
          h('rect', { x: 10.85, y: 6, width: 2.3, height: 7.2, rx: 0.4, fill: 'currentColor' }),
          h('rect', { x: 15.95, y: 6, width: 2.3, height: 7.2, rx: 0.4, fill: 'currentColor' }),
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
    instrumentOptions: { type: Array, default: () => AUDIO_INSTRUMENTS },
    midiSupported: { type: Boolean, default: false },
    midiPhase: { type: String, default: 'off' },
    midiStatusText: { type: String, default: '未连接设备' },
    midiHasDevice: { type: Boolean, default: false },
    midiFollow: { type: Boolean, default: false },
    followRhythm: { type: Boolean, default: false },
    followRhythmTolerance: { type: String, default: 'standard' },
    followHudStyle: { type: String, default: 'arc' },
    /** stack：抽屉纵向；columns：对话框左右两列 */
    layout: { type: String, default: 'stack' },
    sideOpen: { type: Boolean, default: false },
  },
  emits: [
    'update:sideOpen',
    'set',
    'reset',
    'engage',
    'audio-toggle',
    'audio-stop',
    'audio-seek',
    'audio-instrument',
    'midi-connect',
    'midi-disconnect',
    'midi-follow',
    'follow-rhythm',
    'follow-rhythm-tolerance',
    'follow-hud-style',
  ],
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
      const transposed =
        n !== 0 || (props.fixedDo && props.originalKeyName !== 'C')
      const progress = Math.max(
        0,
        Math.min(1, Number(props.audioProgress) || 0)
      )
      const audioBusy = props.audioLoading || props.audioInstrumentLoading
      const audioDisabled = audioBusy || !props.audioReady
      const instrumentOptions = props.instrumentOptions.length
        ? props.instrumentOptions
        : AUDIO_INSTRUMENTS
      const instrumentLabel =
        instrumentOptions.find((item) => item.value === props.audioInstrument)
          ?.label || '电子'
      const practice = !!props.midiFollow
      const midiOn = props.midiPhase === 'on'
      const midiBusy = props.midiPhase === 'connecting'
      const showFollowSwitch = midiOn && props.midiHasDevice
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

      const pianoIcon = () => h(
        'svg',
        {
          class: 'transpose-midi-icon',
          viewBox: '0 0 24 24',
          width: 18,
          height: 18,
          'aria-hidden': 'true',
        },
        [
          h('rect', {
            x: 3,
            y: 5,
            width: 18,
            height: 14,
            rx: 2,
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.6,
          }),
          h('path', {
            d: 'M9 5v8M15 5v8',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.6,
          }),
        ]
      )

      const switchRow = h('div', { class: 'transpose-panel-head' }, [
        h('span', { class: 'transpose-switch-label' }, transposed ? '回到原调' : '移调'),
        h(Switch, {
          modelValue: transposed,
          label: transposed ? '回到原调' : '移调',
          'onUpdate:modelValue': (on) => {
            if (flushTimer) {
              clearTimeout(flushTimer)
              flushTimer = 0
            }
            pending = null
            sliderDraft.value = null
            if (on) emit('engage')
            else emit('reset')
          },
        }),
      ])

      const pitchNodes = [
        switchRow,
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
      ]

      const listenNode = practice
        ? h('div', { class: 'transpose-follow-hint' }, [
              pianoIcon(),
              h(
                'span',
                props.followRhythm
                  ? '跟弹模式已开启，请在已连接的电子琴上演奏对应音符，并尽量按原速弹奏'
                  : '跟弹模式已开启，请在已连接的电子琴上演奏对应音符'
              ),
            ])
          : h('div', { class: 'transpose-audio' }, [
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
            options: instrumentOptions,
            label: instrumentLabel,
            ariaLabel: `音色：${instrumentLabel}`,
            variant: 'chip',
            nowrap: true,
            panelMinWidth: instrumentOptions.length > 2 ? 180 : 120,
            disabled: audioBusy,
            'onUpdate:modelValue': (value) => emit('audio-instrument', value),
          }),
        ])

      const midiIdentity = h('div', { class: 'transpose-midi-id' }, [
        h('div', { class: 'transpose-midi-mark' }, [pianoIcon()]),
        h('div', { class: 'transpose-midi-copy' }, [
          h('div', { class: 'transpose-midi-title' }, '电子琴'),
          h('div', { class: 'transpose-midi-status' }, props.midiStatusText),
        ]),
      ])
      const connectButton = h(
        Button,
        {
          variant: midiOn ? 'secondary' : 'primary',
          disabled: midiBusy,
          ...bindTap(() => {
            if (midiOn) emit('midi-disconnect')
            else emit('midi-connect')
          }, midiBusy),
        },
        () => (midiOn ? '断开' : '连接设备')
      )
      const followCollapse = h(HeightCollapse, { open: showFollowSwitch }, [
        h('div', { class: 'transpose-follow-row' }, [
          h('span', { class: 'transpose-follow-label' }, '跟弹模式'),
          h(Switch, {
            modelValue: !!props.midiFollow,
            label: props.midiFollow ? '关闭跟弹模式' : '开启跟弹模式',
            'onUpdate:modelValue': (on) => emit('midi-follow', on),
          }),
        ]),
        h(HeightCollapse, { open: practice }, [
          h('div', { class: 'transpose-judge' }, [
            h('div', { class: 'transpose-judge-row' }, [
              h('div', { class: 'transpose-judge-copy' }, [
                h('div', { class: 'transpose-judge-title' }, '音高判定'),
                h('div', { class: 'transpose-judge-desc' }, '判断音符音高是否准确'),
              ]),
              h(Switch, {
                modelValue: true,
                disabled: true,
                label: '音高判定始终开启',
              }),
            ]),
            h('div', { class: 'transpose-judge-row' }, [
              h('div', { class: 'transpose-judge-copy' }, [
                h('div', { class: 'transpose-judge-title' }, '节奏判定'),
                h('div', { class: 'transpose-judge-desc' }, '判断音符时值是否准确'),
              ]),
              h(Switch, {
                modelValue: !!props.followRhythm,
                label: props.followRhythm ? '关闭节奏判定' : '开启节奏判定',
                'onUpdate:modelValue': (on) => emit('follow-rhythm', on),
              }),
            ]),
            h(HeightCollapse, { open: !!props.followRhythm }, [
              h('div', { class: 'transpose-judge-tolerance' }, [
                h('div', { class: 'transpose-judge-desc' }, '容错难度'),
                h(SegmentSwitch, {
                  class: 'transpose-judge-levels',
                  block: true,
                  label: '容错难度',
                  modelValue: props.followRhythmTolerance,
                  options: FOLLOW_RHYTHM_TOLERANCES.map((item) => ({
                    value: item.value,
                    label: item.label,
                  })),
                  'onUpdate:modelValue': (value) =>
                    emit('follow-rhythm-tolerance', value),
                }),
                h(
                  'div',
                  { class: 'transpose-judge-range' },
                  `当前容错范围：该音时值±${
                    FOLLOW_RHYTHM_TOLERANCES.find(
                      (item) => item.value === props.followRhythmTolerance
                    )?.percent || 16
                  }%`
                ),
              ]),
              h('div', { class: 'transpose-judge-style' }, [
                h('div', { class: 'transpose-judge-desc' }, '反馈样式'),
                h(SegmentSwitch, {
                  class: 'transpose-judge-levels',
                  block: true,
                  label: '反馈样式',
                  modelValue: props.followHudStyle,
                  options: DURATION_HUD_STYLES.map((item) => ({
                    value: item.value,
                    label: item.label,
                  })),
                  'onUpdate:modelValue': (value) => emit('follow-hud-style', value),
                }),
              ]),
            ]),
          ]),
        ]),
      ])

      const columns = props.layout === 'columns'
      const mainNodes = [...pitchNodes, listenNode]
      const midiBody = props.midiSupported
        ? [
            h('div', { class: 'transpose-midi-row' }, [
              midiIdentity,
              connectButton,
            ]),
            followCollapse,
          ]
        : []
      const stackMidi = props.midiSupported
        ? [h('div', { class: 'transpose-midi-divider' }), ...midiBody]
        : []
      const panelClass = [
        'transpose-panel',
        columns ? 'transpose-panel--columns' : '',
      ]
      if (columns) {
        const sideArrow = h(
          'svg',
          {
            class: 'transpose-side-arrow',
            viewBox: '0 0 24 24',
            width: 18,
            height: 18,
            'aria-hidden': 'true',
          },
          [
            h('path', {
              d: props.sideOpen ? 'M14.5 6.5 9 12l5.5 5.5' : 'M9.5 6.5 15 12l-5.5 5.5',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': 1.8,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            }),
          ]
        )
        return h('div', { class: panelClass }, [
          h('div', { class: 'transpose-columns' }, [
            h('div', { class: 'transpose-main' }, [
              ...mainNodes,
              ...(props.midiSupported
                ? [
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'transpose-side-trigger',
                        'aria-expanded': props.sideOpen ? 'true' : 'false',
                        'aria-label': props.sideOpen ? '隐藏电子琴' : '显示电子琴',
                        ...bindTap(
                          () => emit('update:sideOpen', !props.sideOpen),
                          false
                        ),
                      },
                      [
                        h('span', { class: 'transpose-side-trigger-id' }, [
                          pianoIcon(),
                          h('span', '电子琴'),
                        ]),
                        sideArrow,
                      ]
                    ),
                  ]
                : []),
            ]),
            props.midiSupported
              ? h(
                  HeightCollapse,
                  {
                    class: [
                      'transpose-side-slot',
                      props.sideOpen ? 'is-open' : '',
                    ],
                    open: props.sideOpen,
                    'aria-hidden': props.sideOpen ? 'false' : 'true',
                  },
                  () => [h('aside', { class: 'transpose-side' }, midiBody)]
                )
              : null,
          ]),
        ])
      }

      return h('div', { class: panelClass }, [
        h('div', { class: 'transpose-stack' }, [
          ...mainNodes,
          ...stackMidi,
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
  padding: 0 20px;
  color: var(--color-text-primary);
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

.transpose-panel .transpose-switch-label {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.3;
}

.transpose-columns {
  display: flex;
  align-items: stretch;
}

.transpose-panel--columns .transpose-main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.transpose-collapse {
  overflow: hidden;
  min-height: 0;
  transition: height 0.28s ease;
}

.transpose-side-trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin: 16px 0 0;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1.3;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-appearance: none;
  appearance: none;
}

.transpose-side-trigger-id {
  display: flex;
  align-items: center;
  min-width: 0;
}

.transpose-side-trigger-id > * + * {
  margin-left: 8px;
}

.transpose-side-arrow {
  display: block;
  flex-shrink: 0;
  margin-left: 12px;
}

.transpose-side-slot {
  display: flex;
  align-self: stretch;
  flex: 0 0 0;
  width: 0;
  min-width: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition:
    flex-basis 0.28s ease,
    width 0.28s ease,
    height 0.28s ease,
    opacity 0.28s ease;
}

.transpose-side-slot.is-open {
  flex-basis: 380px;
  width: 380px;
  opacity: 1;
  pointer-events: auto;
}

.transpose-side {
  box-sizing: border-box;
  width: 360px;
  align-self: stretch;
  margin-left: 20px;
  padding-left: 20px;
  border-left: 1px solid var(--color-border);
}

.transpose-panel--columns .transpose-side > .transpose-midi-row {
  margin-top: 0;
}

@media (prefers-reduced-motion: reduce) {
  .transpose-collapse,
  .transpose-side-slot {
    transition: none;
  }
}

.transpose-panel .transpose-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 20px;
  padding: 16px;
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
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
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
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
  background: var(--color-border);
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
  background: var(--color-border);
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
  flex: 0 0 calc(2em + 46px);
  box-sizing: border-box;
  width: calc(2em + 46px);
  max-width: calc(2em + 46px);
  min-width: 0;
  height: 44px;
  overflow: hidden;
  min-height: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
  color: inherit;
  font-size: 14px;
}

.transpose-panel :deep(.app-select-trigger) {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  height: 44px;
  min-width: 0;
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
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
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

.transpose-panel .transpose-follow-hint {
  display: flex;
  align-items: flex-start;
  margin-top: 16px;
  padding: 14px;
  border-radius: var(--radius-control);
  background: rgba(10, 132, 255, 0.14);
  color: var(--color-accent);
  font-size: 13px;
  line-height: 1.45;
}

.transpose-panel .transpose-follow-hint > * + * {
  margin-left: 8px;
}

.transpose-panel .transpose-midi-icon {
  display: block;
  flex-shrink: 0;
}

.transpose-panel .transpose-midi-divider {
  height: 0;
  margin: 16px 0 0;
  border: 0;
  border-top: 1px solid var(--color-border);
}

.transpose-panel .transpose-midi-row,
.transpose-panel .transpose-follow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.transpose-panel .transpose-follow-row {
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}

.transpose-panel .transpose-midi-id {
  display: flex;
  align-items: center;
  min-width: 0;
  margin-right: 12px;
}

.transpose-panel .transpose-midi-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-right: 10px;
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--color-surface-sunken);
  color: var(--color-text-primary);
}

.transpose-panel .transpose-midi-copy {
  min-width: 0;
}

.transpose-panel .transpose-midi-title,
.transpose-panel .transpose-follow-label {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
}

.transpose-panel .transpose-midi-status {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--color-text-secondary);
}

.transpose-panel .transpose-judge {
  margin-top: 12px;
  padding: 4px 14px 12px;
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
}

.transpose-panel .transpose-judge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
}

.transpose-panel .transpose-judge-row + .transpose-judge-row {
  border-top: 1px solid var(--color-border);
}

.transpose-panel .transpose-judge-copy {
  min-width: 0;
  margin-right: 12px;
}

.transpose-panel .transpose-judge-title {
  font-size: 13px;
  line-height: 1.3;
}

.transpose-panel .transpose-judge-desc,
.transpose-panel .transpose-judge-range {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--color-text-secondary);
}

.transpose-panel .transpose-judge-tolerance {
  padding-top: 2px;
}

.transpose-panel .transpose-judge-levels {
  margin-top: 8px;
}

.transpose-panel .transpose-judge-range {
  margin-top: 8px;
}

.transpose-panel .transpose-judge-style {
  margin-top: 12px;
}
</style>
