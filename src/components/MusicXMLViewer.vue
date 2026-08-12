<template>
  <div class="page-wrap">
    <div class="toolbar">
      <label class="select-wrap">
        <span class="select-label">上传曲谱</span>
        <span class="btn file-btn">
          <!-- iOS Safari：勿用 hidden/display:none，否则点按常无法打开文件选择器；
               accept 过严也会把未登记的 .musicxml 滤掉，故放宽并由 JS 校验 -->
          <input
            type="file"
            class="file-input"
            accept=".musicxml,.xml,text/xml,application/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,*/*"
            @change="onFileChange"
          />
          选择 MusicXML
        </span>
      </label>
      <label class="select-wrap">
        <span class="select-label">内置示例</span>
        <select class="select" v-model="selectedExample" @change="onExampleChange">
          <option value="" disabled>请选择曲谱</option>
          <!-- 根目录歌曲可直接选 -->
          <option
            v-for="item in rootExamples"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }}
          </option>
          <!-- 专辑仅作分组，不可选；组内才是曲谱 -->
          <optgroup
            v-for="album in albumGroups"
            :key="album.name"
            :label="album.name"
          >
            <option
              v-for="item in album.songs"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }}
            </option>
          </optgroup>
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

/**
 * 递归收集 assets 下全部 .musicxml，支持两种路径：
 * - 歌曲.musicxml
 * - 专辑/歌曲.musicxml
 */
const musicxmlCtx = require.context('../assets', true, /\.musicxml$/)
const examples = musicxmlCtx.keys().map((key) => {
  const relativePath = key.replace(/^\.\//, '')
  const id = relativePath.replace(/\.musicxml$/i, '')
  const parts = id.split('/')
  const name = parts[parts.length - 1]
  const album = parts.length > 1 ? parts.slice(0, -1).join('/') : null
  return { id, name, album, url: musicxmlCtx(key) }
})

const byZh = (a, b) => a.name.localeCompare(b.name, 'zh-CN')

/** 根目录曲谱（无专辑） */
const rootExamples = examples.filter((e) => !e.album).sort(byZh)

/** 按专辑分组；专辑本身不可选，仅作树形分组 */
const albumGroups = (() => {
  const map = new Map()
  for (const item of examples) {
    if (!item.album) continue
    if (!map.has(item.album)) map.set(item.album, [])
    map.get(item.album).push(item)
  }
  return [...map.entries()]
    .map(([name, songs]) => ({ name, songs: songs.sort(byZh) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
})()

const defaultExampleId =
  rootExamples[0]?.id || albumGroups[0]?.songs[0]?.id || ''

const svg = ref(null)
const currentXml = ref('')
const currentTitle = ref('')
const exporting = ref(false)
const selectedExample = ref(defaultExampleId)

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
  const item = examples.find((e) => e.id === selectedExample.value)
  if (!item) return
  renderWithUrl(item.url)
}

function onExampleChange() {
  if (!selectedExample.value) return
  loadSelectedExample()
}

function isMusicXmlFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return true
  const type = (file.type || '').toLowerCase()
  // iOS 常给未知扩展名空 MIME；空类型也放行，交给解析阶段报错
  return (
    !type ||
    type.includes('xml') ||
    type === 'application/octet-stream' ||
    type === 'text/plain'
  )
}

async function readFileAsText(file) {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    if (!isMusicXmlFile(file)) {
      alert('请选择 MusicXML 或 XML 文件')
      return
    }
    const text = await readFileAsText(file)
    // 上传后清空下拉：避免与当前谱面不一致，并允许再次选中同一示例触发加载
    selectedExample.value = ''
    await renderWithXmlString(text)
  } catch (err) {
    console.error('[upload MusicXML]', err)
    alert(err?.message || '读取文件失败')
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
  position: relative;
  display: inline-block;
  overflow: hidden;
}

/* 覆盖在按钮上：兼容 iOS Safari（hidden 会导致无法唤起选择器） */
.file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 16px; /* 避免部分 WebKit 缩放异常 */
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

/* 与 .btn 分离：Safari 对带自定义按钮样式的原生 select 渲染易错位/截断 */
.select {
  box-sizing: border-box;
  min-width: 220px;
  max-width: min(360px, 70vw);
  height: 36px;
  padding: 0 32px 0 12px;
  border: 1px solid #dcdcdc;
  border-radius: 8px;
  color: #222;
  font-size: 14px;
  line-height: 34px;
  background-color: #fff;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23666' d='M1.4.6 6 5.2 10.6.6 12 2 6 8 0 2z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px 8px;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}
.select:hover {
  background-color: #f7f7f7;
}
.select:focus {
  outline: 2px solid #c8c8c8;
  outline-offset: 1px;
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
