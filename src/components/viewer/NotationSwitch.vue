<script>
import { defineComponent, h } from 'vue'
import { NOTATION_JIANPU, NOTATION_STAFF } from '../../utils/osmdRenderer.js'
import { armPageZoomBlock } from '../../utils/pageZoomBlock.js'

export default defineComponent({
  name: 'NotationSwitch',
  props: {
    modelValue: { type: String, default: NOTATION_JIANPU },
    stacked: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    let tapFromTouch = false
    const setMode = (mode) => {
      if (mode === props.modelValue) return
      emit('update:modelValue', mode)
    }
    const bindTap = (mode) => ({
      onClick: () => {
        if (tapFromTouch) {
          tapFromTouch = false
          return
        }
        setMode(mode)
      },
      onTouchend: (e) => {
        if (e.cancelable) e.preventDefault()
        armPageZoomBlock()
        tapFromTouch = true
        setMode(mode)
        window.setTimeout(() => {
          tapFromTouch = false
        }, 500)
      },
    })
    return () =>
      h(
        'div',
        {
          class: [
            'notation-switch',
            props.stacked ? 'notation-switch--stack' : '',
          ],
          role: 'group',
          'aria-label': '记谱方式',
        },
        [
          h('span', {
            class: [
              'notation-switch__thumb',
              props.modelValue === NOTATION_STAFF
                ? 'notation-switch__thumb--end'
                : '',
            ],
            'aria-hidden': 'true',
          }),
          h(
            'button',
            {
              type: 'button',
              class: [
                'notation-switch__btn',
                props.modelValue === NOTATION_JIANPU
                  ? 'notation-switch__btn--active'
                  : '',
              ],
              'aria-pressed': props.modelValue === NOTATION_JIANPU,
              ...bindTap(NOTATION_JIANPU),
            },
            '简谱'
          ),
          h(
            'button',
            {
              type: 'button',
              class: [
                'notation-switch__btn',
                props.modelValue === NOTATION_STAFF
                  ? 'notation-switch__btn--active'
                  : '',
              ],
              'aria-pressed': props.modelValue === NOTATION_STAFF,
              ...bindTap(NOTATION_STAFF),
            },
            '五线谱'
          ),
        ]
      )
  },
})
</script>

<style scoped>
.notation-switch {
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

.notation-switch__thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(50% - 2px);
  border-radius: calc(var(--radius-control) - 2px);
  background: var(--color-accent);
  pointer-events: none;
  z-index: 0;
  transform: translateX(0);
  transition: transform 0.2s ease;
}

.notation-switch__thumb--end {
  transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
  .notation-switch__thumb {
    transition: none;
  }
}

.notation-switch__btn {
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

.notation-switch__btn--active {
  background: transparent;
  color: #ffffff;
}

.notation-switch--stack {
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

.notation-switch--stack .notation-switch__thumb {
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: calc(var(--menu-radius) - 3px);
}

.notation-switch--stack .notation-switch__btn {
  font-size: var(--font-size-menu);
}
</style>
