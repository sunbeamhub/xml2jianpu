<template>
  <div class="page-wrap">
    <div class="toolbar">
      <label class="select-wrap">
        <span class="select-label">上传曲谱</span>
        <span class="btn file-btn">
          <input type="file" accept=".musicxml,.xml,application/xml" @change="onFileChange" hidden />
          选择 MusicXML
        </span>
      </label>
      <label class="select-wrap">
        <span class="select-label">内置示例</span>
        <select class="btn select" v-model="selectedExample" @change="onExampleChange">
          <option value="" disabled>请选择示例</option>
          <option
            v-for="item in examples"
            :key="item.name"
            :value="item.name"
          >
            {{ item.name }}
          </option>
        </select>
      </label>
      <button
        class="btn"
        :disabled="!currentXml || exporting"
        @click="onExportPdf"
      >
        {{ exporting ? '导出中…' : '导出 PDF' }}
      </button>
    </div>

    <!-- 窄屏横向滚动，避免谱面被压窄截断 -->
    <div class="canvas-wrap">
      <svg ref="svg" class="score-svg"></svg>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import initApp from './MusicXMLViewer.js'
import { exportA4Pdf } from '../utils/exportA4Pdf.js'

/** 动态收集 assets 下全部 .musicxml，按文件名字母序排列 */
const musicxmlCtx = require.context('../assets', false, /\.musicxml$/)
const examples = musicxmlCtx
  .keys()
  .map((key) => {
    const filename = key.replace(/^\.\//, '')
    const name = filename.replace(/\.musicxml$/i, '')
    return { name, url: musicxmlCtx(key) }
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

const svg = ref(null)
const currentXml = ref('')
const currentTitle = ref('')
const exporting = ref(false)
const selectedExample = ref(examples[0]?.name || '')

async function fitSvgSize(svgEl, padding = 16) {
  await nextTick()
  const bbox = svgEl.getBBox()
  const attrW = Number(svgEl.getAttribute('width')) || 0
  const contentWidth = Math.max(
    attrW,
    Math.ceil(Math.max(0, bbox.x) + bbox.width + padding)
  )
  const contentHeight = Math.max(0, Math.ceil(bbox.y + bbox.height + padding))
  svgEl.removeAttribute('viewBox')
  svgEl.setAttribute('width', String(contentWidth || 1))
  svgEl.setAttribute('height', String(contentHeight || 1))
}

async function renderWithUrl(url) {
  if (!svg.value) return
  const result = await initApp(svg.value, url)
  if (result) {
    currentXml.value = result.xmlString
    currentTitle.value = result.title || ''
  }
  await fitSvgSize(svg.value)
}

async function renderWithXmlString(xmlString) {
  if (!svg.value) return
  const result = await initApp(svg.value, xmlString)
  if (result) {
    currentXml.value = result.xmlString
    currentTitle.value = result.title || ''
  }
  await fitSvgSize(svg.value)
}

function loadSelectedExample() {
  const item = examples.find((e) => e.name === selectedExample.value)
  if (!item) return
  renderWithUrl(item.url)
}

function onExampleChange() {
  if (!selectedExample.value) return
  loadSelectedExample()
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    // 上传后清空下拉：避免与当前谱面不一致，并允许再次选中同一示例触发加载
    selectedExample.value = ''
    await renderWithXmlString(text)
  } finally {
    e.target.value = ''
  }
}

async function onExportPdf() {
  if (!currentXml.value || exporting.value) return
  exporting.value = true
  try {
    await exportA4Pdf(currentXml.value, { title: currentTitle.value })
  } catch (err) {
    console.error('[export PDF]', err)
    alert(err?.message || '导出 PDF 失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  loadSelectedExample()
})
</script>

<style scoped>
.page-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 不强制高度，交给内容决定；让页面整体滚动 */
}

.toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.btn {
  padding: 8px 12px;
  border: 1px solid #dcdcdc;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: .15s;
  font-size: 14px;
}
.btn:hover:not(:disabled) { background: #f7f7f7; }
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.file-btn {
  display: inline-block;
}

.select-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.select-label {
  color: #555;
  white-space: nowrap;
}

.select {
  min-width: 180px;
  appearance: auto;
}

/* 窄于谱面最小宽度时出现横向滚动条 */
.canvas-wrap {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* 使用 SVG 自身 width/height 像素，勿强制 100% 缩放导致裁切感 */
.score-svg {
  display: block;
  margin: 0 auto;
  flex-shrink: 0;
}
</style>
