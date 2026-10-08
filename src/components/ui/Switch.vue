<!-- eslint-disable vue/multi-word-component-names -->
<script setup>
/* global defineProps, defineEmits */
import { armPageZoomBlock } from '../../utils/pageZoomBlock.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  label: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

let tapFromTouch = false

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}

function onClick() {
  if (tapFromTouch) {
    tapFromTouch = false
    return
  }
  toggle()
}

function onTouchend(e) {
  if (e.cancelable) e.preventDefault()
  armPageZoomBlock()
  if (props.disabled) return
  tapFromTouch = true
  toggle()
  window.setTimeout(() => {
    tapFromTouch = false
  }, 500)
}
</script>

<template>
  <button
    type="button"
    class="ui-switch"
    :class="{ 'is-on': modelValue }"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="label"
    :disabled="disabled"
    @click="onClick"
    @touchend="onTouchend"
  >
    <span class="ui-switch-thumb" />
  </button>
</template>
