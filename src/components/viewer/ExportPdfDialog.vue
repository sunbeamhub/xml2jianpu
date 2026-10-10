<script>
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'

export default {
  components: { Button, Dialog },
  props: {
    open: { type: Boolean, default: false },
    exporting: { type: Boolean, default: false },
  },
  emits: ['cancel', 'confirm'],
}
</script>

<template>
  <Dialog
    v-if="open"
    title="导出 PDF"
    title-id="export-paper-title"
    :padded="false"
    width="max-content"
    described-by="export-paper-hint"
    :close-disabled="exporting"
    @close="$emit('cancel')"
  >
    <div class="export-paper-body">
      <p id="export-paper-hint" class="export-paper-hint">
        导出前请先看下面的保存步骤。
      </p>
      <div class="export-paper-guide">
        <p class="export-paper-guide-title">这台系统无法直接下载，请按下面步骤保存：</p>
        <ol>
          <li>点「开始导出」后会打开 PDF 预览</li>
          <li>点屏幕顶部的分享按钮（方框加向上箭头）</li>
          <li>选择「存储到文件」，再选保存位置</li>
        </ol>
      </div>
    </div>
    <template #footer>
      <div class="overlay-actions overlay-actions--half">
        <Button
          class="overlay-actions__confirm"
          variant="primary"
          :disabled="exporting"
          @click="$emit('confirm')"
        >
          开始导出
        </Button>
        <Button
          class="overlay-actions__cancel"
          variant="secondary"
          :disabled="exporting"
          @click="$emit('cancel')"
        >
          取消
        </Button>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
:deep(.overlay-body) {
  flex: none;
  min-width: auto;
  overflow: visible;
}

.export-paper-body {
  padding: 0 20px 16px;
}

.export-paper-hint {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

@media (max-width: 499px) {
  .export-paper-hint {
    white-space: normal;
  }
}

.export-paper-guide {
  margin: 0 0 4px;
  padding: 12px 12px 10px;
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
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
</style>
