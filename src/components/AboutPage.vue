<template>
  <div
    class="about-page"
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-title"
  >
    <header class="about-bar">
      <button type="button" class="about-back" @click="close">返回</button>
      <h1 id="about-title" class="about-title">关于</h1>
    </header>

    <div class="about-body">
      <p class="about-version">当前版本 {{ currentVersion }}</p>

      <p v-if="checkStatus === 'idle' || checkStatus === 'checking'" class="about-status">
        正在检查更新…
      </p>
      <p v-else-if="checkStatus === 'error'" class="about-status">
        暂时无法检查更新
      </p>
      <template v-else-if="updateAvailable">
        <p class="about-version">最新版本 {{ latestVersion }}</p>
        <p class="about-hint">{{ hint }}</p>
        <section
          v-for="release in releasesBetween"
          :key="release.version"
          class="about-release"
        >
          <h2 class="about-release-title">{{ release.version }}</h2>
          <pre class="about-release-body">{{ release.body || '（无说明）' }}</pre>
        </section>
      </template>
      <p v-else class="about-status">已是最新</p>
    </div>

    <footer v-if="showUpdateActions" class="about-actions">
      <button type="button" class="about-action" :disabled="updating" @click="onLater">
        稍后提醒
      </button>
      <button
        type="button"
        class="about-action about-action--primary"
        :disabled="updating"
        @click="onUpdate"
      >
        立即更新
      </button>
    </footer>
    <footer v-else class="about-actions">
      <button type="button" class="about-action" @click="close">关闭</button>
    </footer>
  </div>
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

const emit = defineEmits(['close'])
const updating = ref(false)

const showUpdateActions = computed(
  () => checkStatus.value === 'ready' && updateAvailable.value
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

function close() {
  emit('close')
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
    await applyUpdateWithToast()
  } catch {
    updating.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.about-page {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 130;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-top: var(--safe-area-top, env(safe-area-inset-top, 0px));
  background: var(--color-page-bg);
  color: var(--color-text-primary);
  font-family: var(--font-ui);
}

.about-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-height: 48px;
  padding: 8px 16px;
}

.about-back {
  position: absolute;
  left: 12px;
  margin: 0;
  padding: 6px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--color-accent);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
  touch-action: manipulation;
}

.about-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}

.about-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 8px 20px 20px;
}

.about-version,
.about-status,
.about-hint {
  margin: 0 0 12px;
  font-size: 16px;
  line-height: 1.45;
}

.about-status,
.about-hint {
  color: var(--color-text-secondary);
}

.about-release {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.about-release-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
}

.about-release-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.about-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 12px;
  padding: 12px 16px calc(16px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
}

.about-action {
  box-sizing: border-box;
  flex: 1 1 0;
  min-height: var(--menu-row-height);
  margin: 0;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
  font: inherit;
  font-size: var(--font-size-menu);
  cursor: pointer;
  touch-action: manipulation;
}

.about-action--primary {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: #ffffff;
}

.about-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
