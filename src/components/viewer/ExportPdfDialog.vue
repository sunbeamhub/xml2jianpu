<script>
export default {
  props: {
    open: { type: Boolean, default: false },
    mode: { type: String, default: 'paper' },
    papers: { type: Array, default: () => [] },
    lastPaperId: { type: String, default: '' },
    exporting: { type: Boolean, default: false },
    showGuide: { type: Boolean, default: false },
  },
  emits: ['cancel', 'confirm'],
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="export-paper-overlay"
      role="presentation"
      @click.self="$emit('cancel')"
    >
      <div
        class="export-paper-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="mode === 'paper' ? 'export-paper-title' : 'legacy-pdf-guide-title'"
        :aria-describedby="mode === 'paper' ? 'export-paper-hint' : undefined"
      >
        <h2
          :id="mode === 'paper' ? 'export-paper-title' : 'legacy-pdf-guide-title'"
          class="export-paper-title"
        >
          导出 PDF
        </h2>
        <p
          v-if="mode === 'paper'"
          id="export-paper-hint"
          class="export-paper-hint"
        >
          当前按设备尺寸预览，导出必须选择 A3 或 A4。
        </p>
        <div v-if="showGuide" class="export-paper-guide">
          <p class="export-paper-guide-title">这台系统无法直接下载，请按下面步骤保存：</p>
          <ol v-if="mode === 'paper'">
            <li>选择纸张后会打开 PDF 预览</li>
            <li>点屏幕顶部的分享按钮（方框加向上箭头）</li>
            <li>选择「存储到文件」，再选保存位置</li>
          </ol>
          <ol v-else>
            <li>点「开始导出」后会打开 PDF 预览</li>
            <li>点屏幕顶部的分享按钮（方框加向上箭头）</li>
            <li>选择「存储到文件」，再选保存位置</li>
          </ol>
        </div>
        <div class="export-paper-actions">
          <template v-if="mode === 'paper'">
            <button
              v-for="paper in papers"
              :key="paper.id"
              type="button"
              class="export-paper-btn"
              :class="{ 'export-paper-btn--last': paper.id === lastPaperId }"
              :disabled="exporting"
              @click="$emit('confirm', paper.id)"
            >
              {{ paper.optionLabel }}
            </button>
            <button
              type="button"
              class="export-paper-btn export-paper-btn--ghost"
              :disabled="exporting"
              @click="$emit('cancel')"
            >
              取消
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="export-paper-btn export-paper-btn--last"
              :disabled="exporting"
              @click="$emit('confirm')"
            >
              开始导出
            </button>
            <button
              type="button"
              class="export-paper-btn export-paper-btn--ghost"
              :disabled="exporting"
              @click="$emit('cancel')"
            >
              取消
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.export-paper-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.4);
}

.export-paper-dialog {
  width: 320px;
  max-width: calc(100vw - 48px);
  padding: 20px 18px 16px;
  border-radius: var(--menu-radius);
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}

.export-paper-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}

.export-paper-hint {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.export-paper-guide {
  margin: 0 0 16px;
  padding: 12px 12px 10px;
  border-radius: 12px;
  background: var(--color-page-bg);
}

.export-paper-guide-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
}

.export-paper-guide ol {
  margin: 0;
  padding-left: 1.3em;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.export-paper-guide li + li {
  margin-top: 4px;
}

.export-paper-actions {
  display: flex;
  flex-direction: column;
}

.export-paper-btn {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--menu-row-height);
  margin: 8px 0 0;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-menu);
  cursor: pointer;
}

.export-paper-btn--last {
  border-color: var(--color-text-primary);
}

.export-paper-btn:hover:not(:disabled) {
  background: var(--color-menu-divider);
}

.export-paper-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.export-paper-btn--ghost {
  border-color: transparent;
  color: var(--color-text-secondary);
}

.export-paper-actions > .export-paper-btn:first-child {
  margin-top: 0;
}
</style>
