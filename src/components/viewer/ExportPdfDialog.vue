<script>
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'

export default {
  components: { Button, Dialog },
  props: {
    open: { type: Boolean, default: false },
    mode: { type: String, default: 'paper' },
    papers: { type: Array, default: () => [] },
    lastPaperId: { type: String, default: '' },
    exporting: { type: Boolean, default: false },
    showGuide: { type: Boolean, default: false },
  },
  emits: ['cancel', 'confirm'],
  data() {
    return { selectedId: '' }
  },
  computed: {
    paperId() {
      const ids = (this.papers || []).map((paper) => paper.id)
      if (ids.includes(this.selectedId)) return this.selectedId
      if (ids.includes(this.lastPaperId)) return this.lastPaperId
      if (ids.includes('a4')) return 'a4'
      return ids[0] || ''
    },
  },
  watch: {
    open: {
      immediate: true,
      handler(open) {
        if (open) this.selectedId = this.lastPaperId
      },
    },
  },
  methods: {
    onConfirm() {
      if (this.mode === 'paper') this.$emit('confirm', this.paperId)
      else this.$emit('confirm')
    },
  },
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
      <template v-if="mode === 'paper'">当前按设备尺寸预览，导出必须选择 A3 或 A4。</template>
      <template v-else>导出前请先看下面的保存步骤。</template>
    </p>
    <div v-if="mode === 'paper'" class="segmented export-paper-seg" role="tablist" aria-label="纸张">
      <button
        v-for="paper in papers"
        :key="paper.id"
        type="button"
        class="segmented__btn"
        :class="{ 'segmented__btn--on': paper.id === paperId }"
        role="tab"
        :aria-selected="paper.id === paperId"
        :disabled="exporting"
        @click="selectedId = paper.id"
      >
        {{ paper.label }}
      </button>
    </div>
    <div v-if="showGuide" class="export-paper-guide">
      <p class="export-paper-guide-title">这台系统无法直接下载，请按下面步骤保存：</p>
      <ol v-if="mode === 'paper'">
        <li>确认纸张后会打开 PDF 预览</li>
        <li>点屏幕顶部的分享按钮（方框加向上箭头）</li>
        <li>选择「存储到文件」，再选保存位置</li>
      </ol>
      <ol v-else>
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
          :disabled="exporting || (mode === 'paper' && !paperId)"
          @click="onConfirm"
        >
          {{ mode === 'paper' ? '确认' : '开始导出' }}
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

.export-paper-seg {
  margin-bottom: 16px;
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
