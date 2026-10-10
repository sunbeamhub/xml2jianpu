<script>
import { SCORE_LIBRARY_DIR } from '../../utils/scoreLibrary.js'
import { openMusicXmlFiles, decodeFileName } from '../../utils/nativeFile.js'
import { isTauri } from '../../utils/platform.js'
import { showToast } from '../../utils/toast.js'
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'
import SegmentSwitch from '../ui/SegmentSwitch.vue'
import Sheet from '../ui/Sheet.vue'

const WIDE_QUERY = '(min-width: 680px)'
const SCORE_FILE = /\.(musicxml|xml)$/i

function parentRel(rel) {
  if (!rel || !rel.includes('/')) return ''
  return rel.slice(0, rel.lastIndexOf('/'))
}

function dirOfFile(file) {
  return file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
}

function fileLabel(file) {
  return String(file || '').split('/').pop()
}

function buildNodes(dirs, files) {
  const map = new Map()
  const ensure = (rel) => {
    if (map.has(rel)) return map.get(rel)
    const node = {
      rel,
      name: rel ? rel.split('/').pop() : SCORE_LIBRARY_DIR,
      children: [],
      directCount: 0,
      totalCount: 0,
    }
    map.set(rel, node)
    return node
  }
  ensure('')
  for (const dir of dirs || []) {
    if (!dir) continue
    ensure(dir)
    ensure(parentRel(dir))
  }
  for (const rel of map.keys()) {
    if (!rel) continue
    const parent = map.get(parentRel(rel))
    if (parent) parent.children.push(map.get(rel))
  }
  for (const node of map.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }
  for (const file of files || []) {
    if (!SCORE_FILE.test(file)) continue
    const dir = dirOfFile(file)
    if (map.has(dir)) map.get(dir).directCount += 1
    let cursor = dir
    const seen = new Set()
    while (!seen.has(cursor)) {
      seen.add(cursor)
      if (map.has(cursor)) map.get(cursor).totalCount += 1
      if (!cursor) break
      cursor = parentRel(cursor)
    }
  }
  return map.get('')
}

async function readLocalScore(file) {
  const name = file?.name || ''
  if (!SCORE_FILE.test(name)) return null
  const text = typeof file.text === 'function'
    ? await file.text()
    : await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
      reader.readAsText(file)
    })
  return { name, text }
}

export default {
  components: { Button, Dialog, SegmentSwitch, Sheet },
  props: {
    open: { type: Boolean, default: false },
    dirs: { type: Array, default: () => [] },
    files: { type: Array, default: () => [] },
    selected: { type: String, default: '' },
    busy: { type: Boolean, default: false },
  },
  emits: ['cancel', 'confirm', 'select', 'create', 'remove'],
  data() {
    return {
      creating: false,
      draft: '',
      openMap: { '': true },
      confirmRel: null,
      wide: true,
      step: '1',
      pending: [],
      dragOver: false,
      picking: false,
    }
  },
  computed: {
    root() {
      return buildNodes(this.dirs, this.files)
    },
    rows() {
      const rows = []
      const walk = (node, depth) => {
        const shownOpen = node.rel === ''
          ? this.openMap[''] !== false
          : !!this.openMap[node.rel]
        rows.push({
          rel: node.rel,
          name: node.name,
          depth,
          directCount: node.directCount,
          hasChildren: node.children.length > 0,
          open: shownOpen,
        })
        if (node.children.length && shownOpen) {
          for (const child of node.children) walk(child, depth + 1)
        }
      }
      walk(this.root, 0)
      return rows
    },
    pathLabel() {
      if (!this.selected) return SCORE_LIBRARY_DIR
      return [SCORE_LIBRARY_DIR, ...this.selected.split('/')].join(' › ')
    },
    existingNames() {
      return (this.files || [])
        .filter((file) => SCORE_FILE.test(file) && dirOfFile(file) === (this.selected || ''))
        .map(fileLabel)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    },
    confirmNode() {
      if (this.confirmRel === null) return null
      return this.findNode(this.root, this.confirmRel || '')
    },
    confirmTitle() {
      const node = this.confirmNode
      if (!node) return ''
      if (!this.confirmRel) return `删除「${node.name}」里的内容？`
      return `删除「${node.name}」？`
    },
    confirmText() {
      const node = this.confirmNode
      if (!node) return ''
      const subdirs = this.countSubdirs(node)
      const folderPart = subdirs ? `其中的 ${subdirs} 个子文件夹将一并删除，` : ''
      const keep = this.confirmRel ? '' : `${node.name}文件夹会保留。`
      return `${keep}${folderPart}共 ${node.totalCount} 个曲谱会被删除，此操作无法撤销。`
    },
    saveLabel() {
      return this.pending.length ? `保存 ${this.pending.length} 个文件` : '保存'
    },
    sheet() {
      return !this.wide
    },
    stepOptions() {
      const count = this.pending.length
      return [
        { value: '1', label: '① 选择目录' },
        { value: '2', label: count ? `② 选择文件（${count}）` : '② 选择文件' },
      ]
    },
    frameProps() {
      const raised = { raised: true }
      if (this.sheet) {
        return {
          title: '上传曲谱',
          titleId: 'upload-dest-title',
          closeDisabled: this.busy,
          dismissDisabled: this.busy || this.confirmRel !== null,
          ...raised,
        }
      }
      return {
        title: '上传曲谱',
        titleId: 'upload-dest-title',
        closeDisabled: this.busy,
        fill: true,
        maxWidth: '800px',
        maxHeight: '540px',
        padded: false,
        titleAlign: 'start',
        ...raised,
      }
    },
  },
  watch: {
    open(open) {
      if (!open) {
        this.creating = false
        this.draft = ''
        this.confirmRel = null
        this.pending = []
        this.step = '1'
        this.dragOver = false
        this.unbindFileDrop()
        return
      }
      this.step = '1'
      this.reveal(this.selected)
      this.bindFileDrop()
    },
    selected(rel) {
      if (this.open) this.reveal(rel)
    },
  },
  mounted() {
    this.widthMql = window.matchMedia(WIDE_QUERY)
    this.syncLayout()
    this.widthMql.addEventListener?.('change', this.syncLayout)
    this.widthMql.addListener?.(this.syncLayout)
    window.addEventListener('keydown', this.onEscape, true)
  },
  beforeUnmount() {
    this.widthMql?.removeEventListener?.('change', this.syncLayout)
    this.widthMql?.removeListener?.(this.syncLayout)
    window.removeEventListener('keydown', this.onEscape, true)
    this.unbindFileDrop()
  },
  methods: {
    syncLayout() {
      this.wide = !!this.widthMql?.matches
    },
    findNode(node, rel) {
      if (!node) return null
      if (node.rel === rel) return node
      for (const child of node.children) {
        const found = this.findNode(child, rel)
        if (found) return found
      }
      return null
    },
    countSubdirs(node) {
      return node.children.reduce((sum, child) => sum + 1 + this.countSubdirs(child), 0)
    },
    reveal(rel) {
      const next = { ...this.openMap, '': true }
      let cursor = parentRel(rel)
      while (cursor) {
        next[cursor] = true
        cursor = parentRel(cursor)
      }
      this.openMap = next
    },
    toggle(rel) {
      const open = rel === '' ? this.openMap[''] !== false : !!this.openMap[rel]
      this.openMap = { ...this.openMap, [rel]: !open }
    },
    onRowClick(row) {
      if (this.busy) return
      this.$emit('select', row.rel)
      if (row.hasChildren && !row.open) this.toggle(row.rel)
    },
    onChevron(row) {
      if (this.busy || !row.hasChildren) return
      this.$emit('select', row.rel)
      this.toggle(row.rel)
    },
    askDelete(rel) {
      if (this.busy) return
      if (!rel) {
        const root = this.root
        if (!root || (!root.directCount && !root.children.length)) return
      }
      this.confirmRel = rel || ''
    },
    cancelDelete() {
      this.confirmRel = null
    },
    confirmDelete() {
      const rel = this.confirmRel
      this.confirmRel = null
      if (rel !== null) this.$emit('remove', rel || '')
    },
    startCreate() {
      if (this.busy) return
      this.creating = true
      this.$nextTick(() => {
        this.$refs.nameInput?.focus()
      })
    },
    cancelCreate() {
      this.creating = false
      this.draft = ''
    },
    submitCreate() {
      const name = this.draft.trim()
      if (!name || this.busy) return
      this.$emit('create', name, () => {
        this.draft = ''
        this.creating = false
        this.reveal(this.selected)
        this.$nextTick(() => {
          this.$refs.tree?.querySelector('.upload-dest-row--selected')
            ?.scrollIntoView({ block: 'nearest' })
        })
      })
    },
    onDraftKeydown(event) {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.submitCreate()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.cancelCreate()
      }
    },
    addPending(items) {
      const next = this.pending.slice()
      for (const item of items) {
        if (!item?.name) continue
        const index = next.findIndex((file) => file.name === item.name)
        if (index >= 0) next.splice(index, 1, item)
        else next.push(item)
      }
      this.pending = next
      if (this.sheet && next.length) this.step = '2'
    },
    removePending(name) {
      this.pending = this.pending.filter((file) => file.name !== name)
    },
    onDropPointerUp(event) {
      if (event.pointerType === 'mouse') return
      this.pickFiles()
    },
    async pickFiles() {
      if (this.busy || this.picking) return
      this.picking = true
      try {
        const { files, skipped } = await openMusicXmlFiles()
        if (files?.length) this.addPending(files)
        if (skipped) showToast(`已跳过 ${skipped} 个非 MusicXML 文件`)
      } catch (err) {
        showToast(err?.message || '读取文件失败', { type: 'error' })
      } finally {
        this.picking = false
      }
    },
    async onDrop(event) {
      this.dragOver = false
      if (this.busy) return
      const list = [...(event.dataTransfer?.files || [])]
      if (!list.length) return
      const accepted = []
      let skipped = 0
      try {
        for (const file of list) {
          const score = await readLocalScore(file)
          if (score) accepted.push(score)
          else skipped += 1
        }
        this.finishPicked(accepted, skipped)
      } catch (err) {
        showToast(err?.message || '读取文件失败', { type: 'error' })
      }
    },
    finishPicked(accepted, skipped) {
      if (!accepted.length && skipped) {
        showToast('请选择 MusicXML 或 XML 文件', { type: 'error' })
        return
      }
      if (accepted.length) this.addPending(accepted)
      if (skipped) showToast(`已跳过 ${skipped} 个非 MusicXML 文件`)
    },
    async bindFileDrop() {
      if (!isTauri() || this.dropUnlisten || this.dropBinding) return
      this.dropBinding = true
      const generation = (this.dropGeneration || 0) + 1
      this.dropGeneration = generation
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          this.onTauriDragDrop(event)
        })
        if (this.dropGeneration !== generation || !this.open) {
          unlisten()
          return
        }
        this.dropUnlisten = unlisten
      } catch (err) {
        console.error('[upload drop]', err)
      } finally {
        this.dropBinding = false
      }
    },
    unbindFileDrop() {
      this.dropGeneration = (this.dropGeneration || 0) + 1
      const unlisten = this.dropUnlisten
      this.dropUnlisten = null
      if (typeof unlisten === 'function') unlisten()
    },
    onTauriDragDrop(event) {
      if (!this.open) return
      const type = event?.payload?.type
      if (type === 'enter' || type === 'over') {
        this.dragOver = true
        return
      }
      if (type === 'leave') {
        this.dragOver = false
        return
      }
      if (type !== 'drop' || this.busy) {
        this.dragOver = false
        return
      }
      this.dragOver = false
      this.readDroppedPaths(event.payload.paths || [])
    },
    async readDroppedPaths(paths) {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const accepted = []
      let skipped = 0
      try {
        for (const path of paths) {
          const name = decodeFileName(String(path).split(/[/\\]/).pop() || '')
          if (!SCORE_FILE.test(name)) {
            skipped += 1
            continue
          }
          try {
            accepted.push({ name, text: await readTextFile(path) })
          } catch {
            skipped += 1
          }
        }
        this.finishPicked(accepted, skipped)
      } catch (err) {
        showToast(err?.message || '读取文件失败', { type: 'error' })
      }
    },
    onDragLeave(event) {
      if (event.currentTarget.contains(event.relatedTarget)) return
      this.dragOver = false
    },
    clearPending() {
      if (this.busy) return
      this.pending = []
    },
    confirmSave() {
      if (!this.pending.length || this.busy) return
      const items = this.pending.map((file) => ({ name: file.name, text: file.text }))
      this.$emit('confirm', items, (written) => {
        const done = new Set(written || [])
        this.pending = this.pending.filter((file) => !done.has(file.name))
      })
    },
    onEscape(event) {
      if (!this.open || event.key !== 'Escape' || this.busy) return
      if (this.confirmRel !== null) {
        event.preventDefault()
        event.stopPropagation()
        this.cancelDelete()
      } else if (this.creating) {
        event.preventDefault()
        event.stopPropagation()
        this.cancelCreate()
      }
    },
    requestClose() {
      if (this.busy || this.confirmRel !== null) return
      this.$emit('cancel')
    },
  },
}
</script>

<template>
  <component
    :is="sheet ? 'Sheet' : 'Dialog'"
    v-if="open"
    v-bind="frameProps"
    @close="requestClose"
  >
    <div class="upload-dest" :class="{ 'upload-dest--sheet': sheet }">
        <SegmentSwitch
          v-if="sheet"
          class="upload-dest-seg"
          label="上传步骤"
          block
          :model-value="step"
          :options="stepOptions"
          @update:model-value="step = $event"
        />
        <div class="upload-dest-body">
          <div v-show="!sheet || step === '1'" class="upload-dest-left">
            <div class="upload-dest-left-head">
              <span>目录</span>
              <button type="button" class="upload-dest-newbtn" :disabled="busy" @click="startCreate">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
                </svg>
                新建文件夹
              </button>
            </div>
            <form v-if="creating" class="upload-dest-newrow" @submit.prevent="submitCreate">
              <input
                ref="nameInput"
                v-model="draft"
                type="text"
                maxlength="80"
                placeholder="在所选目录下新建"
                aria-label="新文件夹名"
                :disabled="busy"
                @keydown="onDraftKeydown"
              />
              <Button type="submit" variant="secondary" :disabled="busy || !draft.trim()">创建</Button>
            </form>
            <div ref="tree" class="upload-dest-tree" role="tree" aria-label="目标目录">
              <div
                v-for="row in rows"
                :key="row.rel || 'root'"
                class="upload-dest-row"
                :class="{ 'upload-dest-row--selected': selected === row.rel }"
                role="treeitem"
                :aria-selected="selected === row.rel"
                :aria-expanded="row.hasChildren ? row.open : undefined"
                :style="{ paddingLeft: `${8 + row.depth * 20}px` }"
                @click="onRowClick(row)"
              >
                <button
                  v-if="row.hasChildren"
                  type="button"
                  class="upload-dest-chev"
                  :class="{ 'upload-dest-chev--open': row.open }"
                  :aria-label="row.open ? '折叠' : '展开'"
                  @click.stop="onChevron(row)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <span v-else class="upload-dest-chev upload-dest-chev--spacer" />
                <svg class="upload-dest-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span class="upload-dest-name">{{ row.name }}</span>
                <span class="upload-dest-count">{{ row.directCount }}</span>
                <button
                  v-if="row.rel || row.directCount || row.hasChildren"
                  type="button"
                  class="upload-dest-delete"
                  aria-label="删除"
                  :disabled="busy"
                  @click.stop="askDelete(row.rel)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div v-show="!sheet || step === '2'" class="upload-dest-right">
            <p class="upload-dest-crumb">
              保存到
              <b>{{ pathLabel }}</b>
            </p>
            <button
              type="button"
              class="upload-dest-drop"
              :class="{ 'upload-dest-drop--over': dragOver }"
              :disabled="busy || picking"
              @click="pickFiles"
              @pointerup="onDropPointerUp"
              @dragover.prevent="dragOver = true"
              @dragleave="onDragLeave"
              @drop.prevent="onDrop"
            >
              <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <p><b>选择曲谱文件</b>，或拖到这里</p>
              <small>支持 MusicXML、XML</small>
            </button>
            <template v-if="pending.length">
              <div class="upload-dest-sec">
                <span>待保存 · {{ pending.length }} 个</span>
              </div>
              <div
                v-for="file in pending"
                :key="file.name"
                class="upload-dest-file upload-dest-file--new"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span class="upload-dest-name">{{ file.name }}</span>
                <button type="button" aria-label="移除" :disabled="busy" @click="removePending(file.name)">✕</button>
              </div>
            </template>
            <div class="upload-dest-sec">
              <span>该目录已有 {{ existingNames.length }} 个文件</span>
            </div>
            <p v-if="!existingNames.length" class="upload-dest-empty">这个目录还是空的</p>
            <div
              v-for="name in existingNames"
              :key="name"
              class="upload-dest-file upload-dest-file--old"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span class="upload-dest-name">{{ name }}</span>
            </div>
          </div>
        </div>
    </div>
    <template #footer>
      <div class="upload-dest-foot">
        <p class="upload-dest-sum">
          <template v-if="pending.length">
            <b>{{ pending.length }} 个文件</b> → {{ pathLabel }}
          </template>
          <template v-else>请选择要上传的文件</template>
        </p>
        <div class="overlay-actions overlay-actions--half">
          <Button
            class="overlay-actions__confirm"
            variant="primary"
            :disabled="busy || !pending.length"
            @click="confirmSave"
          >
            {{ saveLabel }}
          </Button>
          <Button
            class="overlay-actions__cancel"
            variant="secondary"
            :disabled="busy || !pending.length"
            @click="clearPending"
          >
            取消
          </Button>
        </div>
      </div>
    </template>
    <template #cover>
      <div v-if="confirmRel !== null" class="upload-dest-confirm" role="presentation">
        <div class="overlay-panel upload-dest-confirm-card" role="alertdialog" aria-labelledby="upload-dest-confirm-title">
          <h3 id="upload-dest-confirm-title" class="overlay-title">{{ confirmTitle }}</h3>
          <p>{{ confirmText }}</p>
          <div class="overlay-actions overlay-actions--half">
            <Button
              class="overlay-actions__confirm"
              variant="danger"
              :disabled="busy"
              @click="confirmDelete"
            >
              删除
            </Button>
            <Button
              class="overlay-actions__cancel"
              variant="secondary"
              :disabled="busy"
              @click="cancelDelete"
            >
              取消
            </Button>
          </div>
        </div>
      </div>
    </template>
  </component>
</template>

<style scoped>
.upload-dest {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.upload-dest-seg {
  flex-shrink: 0;
  margin: 0 16px 10px;
}

.upload-dest-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-top: var(--divider);
}

.upload-dest-left {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 270px;
  min-height: 0;
  border-right: var(--divider);
}

.upload-dest--sheet .upload-dest-left,
.upload-dest--sheet .upload-dest-right {
  width: 100%;
  border: 0;
}

.upload-dest-left-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 6px;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.upload-dest-newbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.upload-dest-newbtn:disabled,
.upload-dest-delete:disabled,
.upload-dest-drop:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.upload-dest-newrow {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 0 12px 10px;
}

.upload-dest-newrow input {
  flex: 1;
  min-width: 0;
  height: var(--control-height);
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 13.5px;
  outline: 0;
}

.upload-dest-newrow input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.16);
}

.upload-dest-tree {
  flex: 1;
  min-height: 0;
  padding: 0 8px 8px;
  overflow: auto;
}

.upload-dest-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding-right: 8px;
  border-radius: var(--radius-control);
  font-size: 14px;
  user-select: none;
  cursor: pointer;
}

.upload-dest--sheet .upload-dest-row {
  height: 50px;
  font-size: 15px;
}

.upload-dest-row:hover {
  background: var(--color-menu-divider);
}

.upload-dest-row--selected,
.upload-dest-row--selected:hover {
  background: rgba(10, 132, 255, 0.14);
  color: var(--color-accent);
  font-weight: 600;
}

.upload-dest-chev,
.upload-dest-delete {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.upload-dest-delete {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-control);
}

.upload-dest-chev--spacer {
  visibility: hidden;
}

.upload-dest-chev--open {
  transform: rotate(90deg);
}

.upload-dest-ico {
  flex: none;
  width: 20px;
  height: 20px;
  fill: #f5b83d;
}

.upload-dest-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-dest-count {
  flex: none;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 400;
}

.upload-dest-row--selected .upload-dest-count {
  color: var(--color-accent);
}

.upload-dest-delete {
  display: none;
}

.upload-dest-row:hover .upload-dest-delete,
.upload-dest-delete:focus-visible {
  display: flex;
}

.upload-dest-delete:hover {
  background: rgba(224, 49, 49, 0.12);
  color: var(--color-danger);
}

.upload-dest-right {
  flex: 1;
  min-width: 0;
  padding: 16px 22px;
  overflow: auto;
}

.upload-dest--sheet .upload-dest-right {
  padding: 14px 20px;
}

.upload-dest-crumb {
  margin: 0 0 12px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.upload-dest-crumb b {
  color: var(--color-text-primary);
}

.upload-dest-drop {
  display: block;
  width: 100%;
  padding: 22px 16px;
  border: 1.5px dashed var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-sunken);
  color: var(--color-text-primary);
  font: inherit;
  text-align: center;
  cursor: pointer;
}

.upload-dest--sheet .upload-dest-drop {
  padding: 30px 16px;
}

.upload-dest-drop svg {
  color: var(--color-accent);
}

.upload-dest-drop p {
  margin: 6px 0 0;
  font-size: 13.5px;
}

.upload-dest-drop small {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.upload-dest-drop--over,
.upload-dest-drop:hover:not(:disabled) {
  border-color: var(--color-accent);
  background: rgba(10, 132, 255, 0.14);
}

.upload-dest-sec {
  display: flex;
  justify-content: space-between;
  margin: 16px 0 6px;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.upload-dest-file {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  font-size: 14px;
}

.upload-dest-file--new + .upload-dest-file--new {
  margin-top: 8px;
}

.upload-dest--sheet .upload-dest-file {
  height: 46px;
}

.upload-dest-file--new {
  background: rgba(10, 132, 255, 0.14);
  color: var(--color-accent);
  font-weight: 600;
}

.upload-dest-file--old {
  color: var(--color-text-secondary);
}

.upload-dest-file button {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.upload-dest-file button:hover {
  background: rgba(0, 0, 0, 0.08);
}

.upload-dest-empty {
  margin: 0;
  padding: 8px 10px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.upload-dest-foot {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.upload-dest-sum {
  width: 100%;
  margin: 0 0 8px;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-dest-sum b {
  color: var(--color-text-primary);
}

@media (hover: hover) and (pointer: fine) {
  .upload-dest-foot {
    flex-direction: row;
    align-items: center;
  }

  .upload-dest-sum {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    margin: 0;
  }
}

.upload-dest-confirm {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--color-scrim);
}

.upload-dest-confirm-card {
  width: 100%;
  max-width: 340px;
  height: auto;
  max-height: none;
  padding: var(--overlay-space);
}

.upload-dest-confirm-card h3 {
  margin: 0 0 8px;
}

.upload-dest-confirm-card p {
  margin: 0 0 18px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

@media (hover: none) {
  .upload-dest-delete {
    display: flex;
  }
}
</style>
