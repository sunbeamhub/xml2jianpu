<!-- eslint-disable vue/multi-word-component-names -->
<script>
export default {
  inheritAttrs: false,
}
</script>

<script setup>
/* global defineProps, defineEmits */
import { onBeforeUnmount, onMounted, ref, useSlots } from 'vue'
import Button from './Button.vue'

const props = defineProps({
  title: { type: String, default: '' },
  titleId: { type: String, default: 'overlay-sheet-title' },
  closeDisabled: { type: Boolean, default: false },
  dismissDisabled: { type: Boolean, default: false },
  raised: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const slots = useSlots()

const panelRef = ref(null)
const handleRef = ref(null)
const dragging = ref(false)
const sheetShift = ref(0)
let dragStartY = 0

const hasPointerEvent =
  typeof window !== 'undefined' && typeof window.PointerEvent === 'function'

function requestClose() {
  if (props.closeDisabled) return
  emit('close')
}

function onHandlePointerDown(event) {
  if (props.dismissDisabled || props.closeDisabled) return
  dragging.value = true
  dragStartY = event.clientY
  sheetShift.value = 0
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId)
  } catch {
    /* 指针已结束时捕获会失败，拖动仍跟着后续移动 */
  }
}

function onHandlePointerMove(event) {
  if (!dragging.value) return
  sheetShift.value = Math.max(0, event.clientY - dragStartY)
}

function onHandlePointerUp() {
  if (!dragging.value) return
  const height = panelRef.value?.getBoundingClientRect().height || 0
  const shift = sheetShift.value
  dragging.value = false
  if (
    !props.dismissDisabled &&
    !props.closeDisabled &&
    height > 0 &&
    shift > height * 0.25
  ) {
    emit('close')
    return
  }
  sheetShift.value = 0
}

function onHandlePointerCancel() {
  if (!dragging.value) return
  dragging.value = false
  sheetShift.value = 0
}

function touchClientY(event) {
  const touch = event.touches?.[0] || event.changedTouches?.[0]
  return touch ? touch.clientY : null
}

function onHandleTouchStart(event) {
  if (props.dismissDisabled || props.closeDisabled) return
  const y = touchClientY(event)
  if (y == null) return
  if (event.cancelable) event.preventDefault()
  dragging.value = true
  dragStartY = y
  sheetShift.value = 0
}

function onHandleTouchMove(event) {
  if (!dragging.value) return
  const y = touchClientY(event)
  if (y == null) return
  if (event.cancelable) event.preventDefault()
  sheetShift.value = Math.max(0, y - dragStartY)
}

function bindHandleTouch(el) {
  el.addEventListener('touchstart', onHandleTouchStart, { passive: false })
  el.addEventListener('touchmove', onHandleTouchMove, { passive: false })
  el.addEventListener('touchend', onHandlePointerUp)
  el.addEventListener('touchcancel', onHandlePointerCancel)
}

function unbindHandleTouch(el) {
  el.removeEventListener('touchstart', onHandleTouchStart)
  el.removeEventListener('touchmove', onHandleTouchMove)
  el.removeEventListener('touchend', onHandlePointerUp)
  el.removeEventListener('touchcancel', onHandlePointerCancel)
}

onMounted(() => {
  panelRef.value?.focus()
  if (!hasPointerEvent && handleRef.value) bindHandleTouch(handleRef.value)
})

onBeforeUnmount(() => {
  if (handleRef.value) unbindHandleTouch(handleRef.value)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="overlay-scrim overlay-scrim--sheet"
      :class="{ 'overlay-scrim--raised': raised }"
      role="presentation"
      @click.self="requestClose"
    >
      <div
        ref="panelRef"
        class="overlay-panel overlay-panel--sheet"
        :class="{ 'overlay-panel--dragging': dragging }"
        :style="{ transform: `translateY(${sheetShift}px)` }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <div
          ref="handleRef"
          class="overlay-handle"
          aria-hidden="true"
          @pointerdown="onHandlePointerDown"
          @pointermove="onHandlePointerMove"
          @pointerup="onHandlePointerUp"
          @pointercancel="onHandlePointerCancel"
        />
        <header class="overlay-head overlay-head--center">
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
    </div>
  </Teleport>
</template>
