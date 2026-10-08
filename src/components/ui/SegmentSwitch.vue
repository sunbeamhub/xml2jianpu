<script>
import { defineComponent, h } from 'vue'
import { armPageZoomBlock } from '../../utils/pageZoomBlock.js'

export default defineComponent({
  name: 'SegmentSwitch',
  props: {
    modelValue: { type: String, default: '' },
    options: { type: Array, default: () => [] },
    label: { type: String, default: '' },
    stacked: { type: Boolean, default: false },
    block: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    let tapFromTouch = false
    const choose = (value) => {
      if (props.disabled || value === props.modelValue) return
      emit('update:modelValue', value)
    }
    const bindTap = (value) => ({
      onClick: () => {
        if (tapFromTouch) {
          tapFromTouch = false
          return
        }
        choose(value)
      },
      onTouchend: (e) => {
        if (e.cancelable) e.preventDefault()
        armPageZoomBlock()
        if (props.disabled) return
        tapFromTouch = true
        choose(value)
        window.setTimeout(() => {
          tapFromTouch = false
        }, 500)
      },
    })
    return () => {
      const options = (props.options || []).filter((item) => item && item.value != null)
      const count = Math.max(1, options.length)
      const index = Math.max(
        0,
        options.findIndex((item) => item.value === props.modelValue)
      )
      const pad = props.stacked ? 3 : 2
      return h(
        'div',
        {
          class: [
            'segment-switch',
            props.stacked ? 'segment-switch--stack' : '',
            props.block ? 'segment-switch--block' : '',
            props.disabled ? 'is-disabled' : '',
          ],
          role: 'group',
          'aria-label': props.label || undefined,
        },
        [
          h('span', {
            class: 'segment-switch__thumb',
            style: {
              width: `calc(${100 / count}% - ${(2 * pad) / count}px)`,
              transform: `translateX(${index * 100}%)`,
            },
            'aria-hidden': 'true',
          }),
          ...options.map((item) =>
            h(
              'button',
              {
                type: 'button',
                class: [
                  'segment-switch__btn',
                  item.value === props.modelValue ? 'segment-switch__btn--active' : '',
                ],
                'aria-pressed': item.value === props.modelValue,
                disabled: props.disabled,
                ...bindTap(item.value),
              },
              item.label
            )
          ),
        ]
      )
    }
  },
})
</script>

<style scoped>
.segment-switch {
  position: relative;
  box-sizing: border-box;
  display: inline-flex;
  align-items: stretch;
  height: 36px;
  padding: 2px;
  border-radius: var(--radius-control);
  background: var(--color-surface);
  box-shadow: var(--shadow-raised);
  overflow: hidden;
}

.segment-switch--block {
  display: flex;
  width: auto;
  align-self: stretch;
}

.segment-switch__thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  border-radius: calc(var(--radius-control) - 2px);
  background: var(--color-accent);
  pointer-events: none;
  z-index: 0;
  transition: transform 0.2s ease;
}

@media (prefers-reduced-motion: reduce) {
  .segment-switch__thumb {
    transition: none;
  }
}

.segment-switch__btn {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: calc(3em + 20px);
  margin: 0;
  padding: 0 10px;
  border: none;
  border-radius: calc(var(--radius-control) - 2px);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  touch-action: manipulation;
}

.segment-switch--block .segment-switch__btn {
  min-width: 0;
  padding: 0 6px;
}

.segment-switch__btn--active {
  color: #ffffff;
}

.segment-switch__btn:disabled {
  cursor: not-allowed;
}

.segment-switch.is-disabled {
  opacity: 0.55;
}

.segment-switch--stack {
  position: relative;
  isolation: isolate;
  display: flex;
  width: 100%;
  height: var(--menu-row-height);
  padding: 3px;
  border-radius: var(--menu-radius);
  background: transparent;
  box-shadow: none;
  overflow: hidden;
}

.segment-switch--stack .segment-switch__thumb {
  top: 3px;
  bottom: 3px;
  left: 3px;
  border-radius: calc(var(--menu-radius) - 3px);
}

.segment-switch--stack .segment-switch__btn {
  font-size: var(--font-size-menu);
}
</style>
