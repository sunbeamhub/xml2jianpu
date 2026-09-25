<template>
  <div
    class="about-overlay"
    :class="{ 'about-overlay--popover': popover }"
    @click.self="requestClose"
  >
    <div
      ref="dialogRef"
      class="about-dialog"
      :class="{ 'about-dialog--dragging': dragging }"
      :style="dialogStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      tabindex="-1"
    >
      <header class="about-header">
        <div
          ref="handleRef"
          class="about-handle"
          aria-hidden="true"
          @pointerdown="onHandlePointerDown"
          @pointermove="onHandlePointerMove"
          @pointerup="onHandlePointerUp"
          @pointercancel="onHandlePointerCancel"
        />
        <div class="about-bar">
          <div class="about-heading">
            <img
              class="about-icon"
              :src="iconUrl"
              alt=""
              width="22"
              height="22"
            />
            <h1 id="about-title" class="about-title">
              <span class="about-title-long">关于易谱</span>
              <span class="about-title-short">关于</span>
            </h1>
          </div>
          <button
            type="button"
            class="about-close"
            aria-label="关闭"
            :disabled="updating"
            @click="requestClose"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3.15 3.15a.75.75 0 0 1 1.06 0L8 6.94l3.79-3.79a.75.75 0 1 1 1.06 1.06L9.06 8l3.79 3.79a.75.75 0 1 1-1.06 1.06L8 9.06l-3.79 3.79a.75.75 0 0 1-1.06-1.06L6.94 8 3.15 4.21a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>
        </div>
      </header>

      <div class="about-scroll">
        <div
          class="about-row"
          :class="{ 'about-row--solo': checkStatus === 'ready' && !updateAvailable }"
        >
          <span class="about-row-label">当前版本</span>
          <span class="about-row-value">{{ currentVersion }}</span>
        </div>

        <p v-if="checkStatus === 'idle' || checkStatus === 'checking'" class="about-status">
          正在检查更新…
        </p>
        <p v-else-if="checkStatus === 'error'" class="about-status">
          暂时无法检查更新
        </p>
        <template v-else-if="updateAvailable">
          <div class="about-row about-row--latest">
            <span class="about-row-label">最新版本</span>
            <span class="about-row-value about-row-value--latest">{{ latestVersion }}</span>
          </div>
          <p class="about-hint">{{ hint }}</p>
          <div v-if="releasesBetween.length" class="about-log">
            <section
              v-for="release in releasesBetween"
              :key="release.version"
              class="about-release"
            >
              <h2 class="about-release-title">{{ releaseLabel(release) }}</h2>
              <ReleaseNotes :body="releaseNotesBody(release.body)" />
            </section>
          </div>
        </template>
        <p v-else class="about-latest">
          <svg class="about-latest-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4" />
            <path
              d="M4.7 8.15 6.85 10.2 11.35 5.7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          已是最新版本
        </p>
      </div>

      <footer class="about-actions">
        <template v-if="showUpdateActions">
          <button
            type="button"
            class="about-action about-action--primary"
            :disabled="updating"
            @click="onUpdate"
          >
            立即更新
          </button>
          <button
            type="button"
            class="about-action about-action--text"
            :disabled="updating"
            @click="onLater"
          >
            稍后提醒
          </button>
        </template>
        <button v-else type="button" class="about-action" @click="requestClose">
          关闭
        </button>
      </footer>
      <span v-if="popover" class="about-arrow" aria-hidden="true" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  applyUpdateWithToast,
  checkStatus,
  currentVersion,
  latestVersion,
  releasesBetween,
  snoozeUpdate,
  updateAvailable,
} from '../utils/appUpdate.js'
import { isIosTauri, isTauri } from '../utils/platform.js'
import ReleaseNotes from './ReleaseNotes.vue'

const RELEASE_TITLE = /^##\s+\[[^\]]+\](?:\s+[-\u2013\u2014]\s+(\d{4}-\d{2}-\d{2}))?[^\S\n]*\n*/
const DESKTOP_QUERY = '(hover: hover) and (pointer: fine)'

const props = defineProps({
  popover: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const hasPointerEvent =
  typeof window !== 'undefined' && typeof window.PointerEvent === 'function'

const updating = ref(false)
const dragging = ref(false)
const sheetShift = ref(0)
const dialogRef = ref(null)
const handleRef = ref(null)
let dragStartY = 0

const iconUrl = `${import.meta.env.BASE_URL || '/'}favicon.svg`

const showUpdateActions = computed(
  () => checkStatus.value === 'ready' && updateAvailable.value
)

const dialogStyle = computed(() => {
  if (props.popover) return undefined
  return { transform: `translateY(${sheetShift.value}px)` }
})

watch(
  () => props.popover,
  () => {
    dragging.value = false
    sheetShift.value = 0
  },
)

const hint = computed(() => {
  if (isIosTauri()) {
    return 'iOS 安装包不能在这里更新，请用浏览器打开网页，或添加到主屏幕。'
  }
  if (isTauri()) {
    return '将打开安装包或发布页，下载后请自行安装。'
  }
  return '点「立即更新」会刷新页面。若仍是旧版本，请关掉标签再打开。iPhone / iPad 添加到主屏幕的，请从多任务界面划掉后再进。'
})

function releaseDate(body) {
  return String(body || '').replace(/^\uFEFF/, '').match(RELEASE_TITLE)?.[1] || ''
}

function releaseNotesBody(body) {
  return String(body || '').replace(/^\uFEFF/, '').replace(RELEASE_TITLE, '')
}

function releaseLabel(release) {
  const date = releaseDate(release?.body)
  return date ? `${release.version} · ${date}` : release.version
}

function close() {
  emit('close')
}

function requestClose() {
  if (updating.value) return
  close()
}

function isDesktopPointer() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DESKTOP_QUERY).matches
}

function isSheet() {
  return !isDesktopPointer() && !props.popover
}

function onKeydown(event) {
  if (event.key !== 'Escape' || updating.value) return
  event.preventDefault()
  event.stopPropagation()
  close()
}

function onHandlePointerDown(event) {
  if (updating.value || !isSheet()) return
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
  const height = dialogRef.value?.getBoundingClientRect().height || 0
  const shift = sheetShift.value
  dragging.value = false
  if (height > 0 && shift > height * 0.25) {
    close()
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
  if (updating.value || !isSheet()) return
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

function onLater() {
  snoozeUpdate()
  close()
}

async function onUpdate() {
  if (updating.value) return
  if (isIosTauri()) return
  updating.value = true
  try {
    const kind = await applyUpdateWithToast()
    if (kind !== 'web') updating.value = false
  } catch {
    updating.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  dialogRef.value?.focus()
  if (!hasPointerEvent && handleRef.value) bindHandleTouch(handleRef.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (handleRef.value) unbindHandleTouch(handleRef.value)
})
</script>

<style scoped>
.about-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 130;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.45);
  color: var(--color-text-primary);
  font-family: var(--font-ui);
}

.about-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 75vh;
  max-height: 75dvh;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 18px calc(16px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  border-radius: 16px 16px 0 0;
  background: var(--color-menu-light-bg);
  overflow: hidden;
  outline: none;
  transition: transform 0.2s ease;
}

.about-dialog--dragging {
  transition: none;
}

.about-header {
  flex: 0 0 auto;
}

.about-handle {
  width: 36px;
  height: 4px;
  margin: 0 auto 6px;
  padding: 10px 40px 12px;
  border-radius: 2px;
  background: var(--color-menu-divider);
  background-clip: content-box;
  box-sizing: content-box;
  touch-action: none;
}

.about-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  margin-bottom: 14px;
}

.about-heading {
  display: flex;
  align-items: center;
  min-width: 0;
}

.about-icon {
  display: none;
  width: 22px;
  height: 22px;
  margin-right: 8px;
  border-radius: 6px;
  object-fit: cover;
}

.about-title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.3;
}

.about-title-long {
  display: none;
}

.about-close {
  position: absolute;
  top: 50%;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  transform: translateY(-50%);
  cursor: pointer;
  touch-action: manipulation;
}

.about-close:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.about-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.about-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  font-size: 14px;
  line-height: 1.4;
}

.about-row--solo,
.about-row--latest {
  padding-bottom: 14px;
}

.about-row-label {
  color: var(--color-text-secondary);
}

.about-row-value {
  font-weight: 500;
}

.about-row-value--latest {
  color: var(--color-accent);
}

.about-status,
.about-hint {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.about-status {
  padding: 4px 0 2px;
}

.about-hint {
  margin-bottom: 2px;
}

.about-latest {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0 0 2px;
  font-size: 14px;
  line-height: 1;
  color: var(--color-success);
}

.about-latest-icon {
  display: block;
  flex: 0 0 auto;
  margin-right: 6px;
}

.about-log {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 0.5px solid var(--color-border);
}

.about-release + .about-release {
  margin-top: 16px;
}

.about-release-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.about-actions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 0.5px solid var(--color-border);
}

.about-action {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 11px 14px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  font-size: 14px;
  line-height: 1.2;
  cursor: pointer;
  touch-action: manipulation;
}

.about-action--primary {
  border: none;
  background: var(--color-accent);
  color: #ffffff;
}

.about-action--text {
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
}

.about-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.about-close:focus-visible,
.about-action:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .about-overlay {
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: transparent;
  }

  .about-dialog {
    width: 380px;
    max-width: 100%;
    padding: 20px;
    border: 0.5px solid var(--color-border);
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  }

  .about-handle {
    display: none;
  }

  .about-bar {
    justify-content: flex-start;
    margin-bottom: 16px;
  }

  .about-icon {
    display: block;
  }

  .about-title {
    font-size: 14px;
  }

  .about-title-long {
    display: inline;
  }

  .about-title-short {
    display: none;
  }

  .about-row,
  .about-status,
  .about-hint,
  .about-latest {
    font-size: 13px;
  }

  .about-row {
    padding: 2px 0;
  }

  .about-row--solo {
    padding-bottom: 16px;
  }

  .about-row--latest {
    padding-bottom: 12px;
  }

  .about-actions {
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    padding-top: 14px;
  }

  .about-action,
  .about-action--text {
    width: auto;
    padding: 6px 14px;
    border: 0.5px solid var(--color-border);
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 13px;
  }

  .about-action--primary {
    order: 2;
    border: none;
    background: var(--color-accent);
    color: #ffffff;
  }

  .about-action--text {
    order: 1;
  }
}

@media (hover: hover) and (pointer: fine) {
  .about-close:hover:not(:disabled),
  .about-action:hover:not(:disabled):not(.about-action--primary) {
    background: var(--color-menu-divider);
  }
}

.about-overlay--popover {
  align-items: center;
  justify-content: flex-end;
  padding: 12px 16px calc(16px + 36px + 10px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  background: transparent;
}

.about-overlay--popover .about-dialog {
  position: relative;
  width: 380px;
  max-width: 100%;
  max-height: calc(
    100dvh - 12px - 16px - 36px - 10px - var(--safe-area-top, env(safe-area-inset-top, 0px)) -
      var(--safe-area-bottom, env(safe-area-inset-bottom, 0px))
  );
  padding: 0;
  border: 0.5px solid var(--color-border);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  overflow: visible;
}

.about-overlay--popover .about-handle,
.about-overlay--popover .about-close {
  display: none;
}

.about-overlay--popover .about-bar {
  justify-content: flex-start;
  margin-bottom: 0;
  padding: 16px 18px 0;
}

.about-overlay--popover .about-icon {
  display: block;
  width: 20px;
  height: 20px;
}

.about-overlay--popover .about-title {
  font-size: 14px;
}

.about-overlay--popover .about-title-long {
  display: inline;
}

.about-overlay--popover .about-title-short {
  display: none;
}

.about-overlay--popover .about-scroll {
  padding: 12px 18px 16px;
}

.about-overlay--popover .about-row,
.about-overlay--popover .about-status,
.about-overlay--popover .about-hint,
.about-overlay--popover .about-latest {
  font-size: 13px;
}

.about-overlay--popover .about-actions {
  flex-direction: row;
  gap: 0;
  margin-top: 0;
  padding-top: 0;
  border-top: 0.5px solid var(--color-border);
}

.about-overlay--popover .about-action,
.about-overlay--popover .about-action--text,
.about-overlay--popover .about-action--primary {
  flex: 1 1 0;
  width: auto;
  padding: 13px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 400;
}

.about-overlay--popover .about-action--text {
  order: 1;
  border-right: 0.5px solid var(--color-border);
}

.about-overlay--popover .about-action--primary {
  order: 2;
}

.about-overlay--popover .about-action--primary,
.about-overlay--popover .about-action:only-child {
  font-weight: 600;
  color: var(--color-accent);
}

.about-arrow {
  position: absolute;
  z-index: 1;
  left: 50%;
  bottom: -7px;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  background: var(--color-menu-light-bg);
  border-right: 0.5px solid var(--color-border);
  border-bottom: 0.5px solid var(--color-border);
  transform: rotate(45deg);
  pointer-events: none;
}
</style>
