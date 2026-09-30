<template>
  <component
    :is="useSheet ? Sheet : Dialog"
    v-bind="frameBind"
    @close="requestClose"
  >
    <template #title>
      <div class="about-heading">
        <img
          v-if="!useSheet && !popover"
          class="about-icon"
          :src="iconUrl"
          alt=""
          width="22"
          height="22"
        />
        <h1 id="about-title" class="overlay-title">
          {{ useSheet ? '关于' : '关于易谱' }}
        </h1>
      </div>
    </template>

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

    <template #footer>
      <div class="overlay-actions overlay-actions--half">
        <template v-if="showUpdateActions">
          <Button
            class="overlay-actions__confirm"
            variant="primary"
            :disabled="updating"
            @click="onUpdate"
          >
            立即更新
          </Button>
          <Button
            class="overlay-actions__cancel"
            variant="secondary"
            :disabled="updating"
            @click="onLater"
          >
            稍后提醒
          </Button>
        </template>
        <Button
          v-else
          class="overlay-actions__confirm"
          variant="secondary"
          @click="requestClose"
        >
          关闭
        </Button>
      </div>
    </template>

    <template #extra>
      <span v-if="popover" class="about-arrow" aria-hidden="true" />
    </template>
  </component>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
import Button from './ui/Button.vue'
import Dialog from './ui/Dialog.vue'
import Sheet from './ui/Sheet.vue'
import ReleaseNotes from './ReleaseNotes.vue'

const RELEASE_TITLE = /^##\s+\[[^\]]+\](?:\s+[-\u2013\u2014]\s+(\d{4}-\d{2}-\d{2}))?[^\S\n]*\n*/
const DESKTOP_QUERY = '(hover: hover) and (pointer: fine)'

const props = defineProps({
  popover: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const updating = ref(false)
const isDesktop = ref(readDesktop())
let desktopMql = null

const iconUrl = `${import.meta.env.BASE_URL || '/'}favicon.svg`

const showUpdateActions = computed(
  () => checkStatus.value === 'ready' && updateAvailable.value
)

const useSheet = computed(() => !isDesktop.value && !props.popover)

const frameBind = computed(() => {
  if (useSheet.value) {
    return {
      titleId: 'about-title',
      closeDisabled: updating.value,
      dismissDisabled: updating.value,
    }
  }
  return {
    titleId: 'about-title',
    placement: props.popover ? 'popover' : 'center',
    hideClose: props.popover,
    titleAlign: props.popover ? 'center' : 'start',
    closeDisabled: updating.value,
    width: '380px',
    padded: false,
  }
})

const hint = computed(() => {
  if (isIosTauri()) {
    return 'iOS 安装包不能在这里更新，请用浏览器打开网页，或添加到主屏幕。'
  }
  if (isTauri()) {
    return '将打开安装包或发布页，下载后请自行安装。'
  }
  return '点「立即更新」会刷新页面。若仍是旧版本，请关掉标签再打开。iPhone / iPad 添加到主屏幕的，请从多任务界面划掉后再进。'
})

function readDesktop() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DESKTOP_QUERY).matches
}

function syncDesktop() {
  isDesktop.value = !!desktopMql?.matches
}

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

function onKeydown(event) {
  if (event.key !== 'Escape' || updating.value) return
  event.preventDefault()
  event.stopPropagation()
  close()
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
  desktopMql = window.matchMedia(DESKTOP_QUERY)
  syncDesktop()
  desktopMql.addEventListener?.('change', syncDesktop)
  desktopMql.addListener?.(syncDesktop)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  desktopMql?.removeEventListener?.('change', syncDesktop)
  desktopMql?.removeListener?.(syncDesktop)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.about-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.about-icon {
  width: 22px;
  height: 22px;
  margin-right: 8px;
  border-radius: var(--radius-control);
  object-fit: cover;
}

.about-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0 20px 12px;
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
  border-top: var(--divider);
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

.about-arrow {
  position: absolute;
  z-index: 1;
  left: 50%;
  bottom: -7px;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  background: var(--color-surface);
  border-right: var(--divider);
  border-bottom: var(--divider);
  transform: rotate(45deg);
  pointer-events: none;
}
</style>
