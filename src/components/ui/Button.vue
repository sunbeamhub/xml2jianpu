<!-- eslint-disable vue/multi-word-component-names -->
<script setup>
defineProps({
  variant: {
    type: String,
    default: 'secondary',
  },
  size: {
    type: String,
    default: 'content',
  },
  type: {
    type: String,
    default: 'button',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <button
    :type="type"
    class="ui-button"
    :class="[`ui-button--${variant}`, size === 'icon' ? 'ui-button--icon' : '']"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>
