<!-- eslint-disable vue/multi-word-component-names -->
<script>
export default {
  inheritAttrs: false,
}
</script>

<script setup>
/* global defineProps, defineEmits */
import { computed, onMounted, ref, useSlots } from 'vue'
import Button from './Button.vue'

const props = defineProps({
  title: { type: String, default: '' },
  titleId: { type: String, default: 'overlay-dialog-title' },
  titleAlign: { type: String, default: 'start' },
  closeDisabled: { type: Boolean, default: false },
  width: { type: String, default: '' },
  maxWidth: { type: String, default: '' },
  maxHeight: { type: String, default: '' },
  fill: { type: Boolean, default: false },
  padded: { type: Boolean, default: true },
  describedBy: { type: String, default: '' },
  widthTransition: { type: Boolean, default: false },
  raised: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const slots = useSlots()

const panelRef = ref(null)

const showHead = true

const fillStyle = computed(() => {
  if (!props.fill) return undefined
  return {
    '--overlay-fill-max-width': props.maxWidth || 'none',
    '--overlay-fill-max-height': props.maxHeight || 'none',
  }
})

const panelStyle = computed(() => {
  if (props.fill) return undefined
  const style = {}
  if (props.width) style.width = props.width
  if (props.maxWidth) style.maxWidth = props.maxWidth
  if (props.maxHeight) style.maxHeight = props.maxHeight
  return style
})

const panelClass = computed(() => ({
  'overlay-panel--padded': props.padded && !props.fill,
  'overlay-panel--flush': !props.padded && !props.fill,
  'overlay-panel--fill': props.fill,
  'overlay-panel--width': props.widthTransition,
}))

function requestClose() {
  if (props.closeDisabled) return
  emit('close')
}

onMounted(() => {
  panelRef.value?.focus()
})
</script>

<template>
  <Teleport to="body">
    <div
      class="overlay-scrim"
      :class="{ 'overlay-scrim--raised': raised }"
      role="presentation"
      @click.self="requestClose"
    >
      <div
        class="overlay-frame"
        :class="fill ? 'overlay-fill-slot' : 'overlay-frame--contents'"
        :style="fill ? fillStyle : undefined"
      >
        <div
          ref="panelRef"
          class="overlay-panel"
          :class="panelClass"
          :style="panelStyle"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="showHead ? titleId : undefined"
          :aria-describedby="describedBy || undefined"
          tabindex="-1"
        >
          <header
            v-if="showHead"
            class="overlay-head"
            :class="titleAlign === 'center' ? 'overlay-head--center' : 'overlay-head--start'"
          >
            <div class="overlay-head-main">
              <slot name="title">
                <h2 :id="titleId" class="overlay-title">{{ title }}</h2>
              </slot>
            </div>
            <Button
              class="overlay-close"
              size="icon"
              variant="plain"
              aria-label="关闭"
              :disabled="closeDisabled"
              @click="requestClose"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3.15 3.15a.75.75 0 0 1 1.06 0L8 6.94l3.79-3.79a.75.75 0 1 1 1.06 1.06L9.06 8l3.79 3.79a.75.75 0 1 1-1.06 1.06L8 9.06l-3.79 3.79a.75.75 0 0 1-1.06-1.06L6.94 8 3.15 4.21a.75.75 0 0 1 0-1.06Z"
                />
              </svg>
            </Button>
          </header>
          <div class="overlay-body" :class="{ 'overlay-body--end': !slots.footer }">
            <slot />
          </div>
          <div v-if="slots.footer" class="overlay-foot">
            <slot name="footer" />
          </div>
          <slot name="cover" />
        </div>
        <slot name="extra" />
      </div>
    </div>
  </Teleport>
</template>
