<script>
import { SCORE_LIBRARY_DIR } from '../../utils/scoreLibrary.js'
import { openMusicXmlFiles, decodeFileName } from '../../utils/nativeFile.js'
import { isTauri } from '../../utils/platform.js'
import { showToast } from '../../utils/toast.js'

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
      dragging: false,
      sheetShift: 0,
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
    dialogStyle() {
      if (!this.sheet) return undefined
      return { transform: `translateY(${this.sheetShift}px)` }
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
        this.sheetShift = 0
        this.dragging = false
        this.unbindFileDrop()
        return
      }
      this.step = '1'
      this.reveal(this.selected)
      this.bindFileDrop()
      this.$nextTick(() => this.bindHandle())
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
    this.$nextTick(() => this.bindHandle())
  },
  beforeUnmount() {
    this.widthMql?.removeEventListener?.('change', this.syncLayout)
    this.widthMql?.removeListener?.(this.syncLayout)
    window.removeEventListener('keydown', this.onEscape, true)
    this.unbindHandle()
    this.unbindFileDrop()
  },
  methods: {
    syncLayout() {
      this.wide = !!this.widthMql?.matches
      this.$nextTick(() => this.bindHandle())
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
    bindHandle() {
      this.unbindHandle()
      const el = this.$refs.handle
      if (!el || !this.sheet) return
      const hasPointer = typeof window.PointerEvent === 'function'
      if (!hasPointer) {
        el.addEventListener('touchstart', this.onHandleTouchStart, { passive: false })
        el.addEventListener('touchmove', this.onHandleTouchMove, { passive: false })
        el.addEventListener('touchend', this.onHandlePointerUp)
        el.addEventListener('touchcancel', this.onHandlePointerCancel)
        this.handleEl = el
      }
    },
    unbindHandle() {
      const el = this.handleEl
      if (!el) return
      el.removeEventListener('touchstart', this.onHandleTouchStart)
      el.removeEventListener('touchmove', this.onHandleTouchMove)
      el.removeEventListener('touchend', this.onHandlePointerUp)
      el.removeEventListener('touchcancel', this.onHandlePointerCancel)
      this.handleEl = null
    },
    onHandlePointerDown(event) {
      if (this.busy || !this.sheet || this.confirmRel !== null) return
      this.dragging = true
      this.dragStartY = event.clientY
      this.sheetShift = 0
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId)
      } catch {
        /* 指针已结束时捕获会失败，拖动仍跟着后续移动 */
      }
    },
    onHandlePointerMove(event) {
      if (!this.dragging) return
      this.sheetShift = Math.max(0, event.clientY - this.dragStartY)
    },
    onHandlePointerUp() {
      if (!this.dragging) return
      const height = this.$refs.dialog?.getBoundingClientRect().height || 0
      const shift = this.sheetShift
      this.dragging = false
      if (height > 0 && shift > height * 0.25) {
        this.requestClose()
        return
      }
      this.sheetShift = 0
    },
    onHandlePointerCancel() {
      if (!this.dragging) return
      this.dragging = false
      this.sheetShift = 0
    },
    touchY(event) {
      const touch = event.touches?.[0] || event.changedTouches?.[0]
      return touch ? touch.clientY : null
    },
    onHandleTouchStart(event) {
      if (this.busy || !this.sheet || this.confirmRel !== null) return
      const y = this.touchY(event)
      if (y == null) return
      if (event.cancelable) event.preventDefault()
      this.dragging = true
      this.dragStartY = y
      this.sheetShift = 0
    },
    onHandleTouchMove(event) {
      if (!this.dragging) return
      const y = this.touchY(event)
      if (y == null) return
      if (event.cancelable) event.preventDefault()
      this.sheetShift = Math.max(0, y - this.dragStartY)
    },
  },
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="upload-dest-overlay"
      :class="{ 'upload-dest-overlay--sheet': sheet }"
      role="presentation"
      @click.self="requestClose"
    >
      <div
        ref="dialog"
        class="upload-dest-dialog"
        :class="{
          'upload-dest-dialog--sheet': sheet,
          'upload-dest-dialog--dragging': dragging,
        }"
        :style="dialogStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dest-title"
      >
        <div
          v-if="sheet"
          ref="handle"
          class="upload-dest-handle"
          @pointerdown="onHandlePointerDown"
          @pointermove="onHandlePointerMove"
          @pointerup="onHandlePointerUp"
          @pointercancel="onHandlePointerCancel"
        />
        <div class="upload-dest-head">
          <span class="upload-dest-head-side" aria-hidden="true"></span>
          <h2 id="upload-dest-title" class="upload-dest-title">上传曲谱</h2>
          <button type="button" class="upload-dest-x" aria-label="关闭" :disabled="busy" @click="requestClose">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3.15 3.15a.75.75 0 0 1 1.06 0L8 6.94l3.79-3.79a.75.75 0 1 1 1.06 1.06L9.06 8l3.79 3.79a.75.75 0 1 1-1.06 1.06L8 9.06l-3.79 3.79a.75.75 0 0 1-1.06-1.06L6.94 8 3.15 4.21a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>
        </div>
        <div v-if="sheet" class="upload-dest-seg" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="step === '1'"
            :class="{ 'upload-dest-seg-btn--on': step === '1' }"
            @click="step = '1'"
          >
            ① 选择目录
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="step === '2'"
            :class="{ 'upload-dest-seg-btn--on': step === '2' }"
            @click="step = '2'"
          >
            ② 选择文件{{ pending.length ? `（${pending.length}）` : '' }}
          </button>
        </div>
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
              <button type="submit" class="upload-dest-btn" :disabled="busy || !draft.trim()">创建</button>
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
        <div class="upload-dest-foot">
          <p class="upload-dest-sum">
            <template v-if="pending.length">
              <b>{{ pending.length }} 个文件</b> → {{ pathLabel }}
            </template>
            <template v-else>请选择要上传的文件</template>
          </p>
          <button
            type="button"
            class="upload-dest-btn upload-dest-btn--primary"
            :disabled="busy || !pending.length"
            @click="confirmSave"
          >
            {{ saveLabel }}
          </button>
          <button type="button" class="upload-dest-btn upload-dest-btn--ghost" :disabled="busy" @click="requestClose">
            取消
          </button>
        </div>
        <div v-if="confirmRel !== null" class="upload-dest-confirm" role="presentation">
          <div class="upload-dest-confirm-card" role="alertdialog" aria-labelledby="upload-dest-confirm-title">
            <h3 id="upload-dest-confirm-title">{{ confirmTitle }}</h3>
            <p>{{ confirmText }}</p>
            <div class="upload-dest-confirm-actions">
              <button type="button" class="upload-dest-btn upload-dest-btn--danger" :disabled="busy" @click="confirmDelete">
                删除
              </button>
              <button type="button" class="upload-dest-btn upload-dest-btn--ghost" :disabled="busy" @click="cancelDelete">取消</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.upload-dest-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px;
  background: rgba(20, 20, 30, 0.38);
  color: var(--color-menu-light-text);
  font-family: var(--font-ui);
}

.upload-dest-overlay--sheet {
  align-items: flex-end;
  padding: 0;
}

.upload-dest-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  height: min(540px, calc(100dvh - 32px));
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid var(--color-menu-divider);
  border-radius: 18px;
  background: var(--color-menu-light-bg);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.upload-dest-dialog--sheet {
  max-width: none;
  height: auto;
  max-height: 88dvh;
  border-bottom: 0;
  border-radius: 22px 22px 0 0;
  transition: transform 0.2s ease;
}

.upload-dest-dialog--sheet .upload-dest-body {
  overflow: hidden;
}

.upload-dest-dialog--dragging {
  transition: none;
}

.upload-dest-handle {
  width: 36px;
  height: 4px;
  margin: 0 auto;
  padding: 10px 40px 4px;
  border-radius: 2px;
  background: var(--color-menu-divider);
  background-clip: content-box;
  box-sizing: content-box;
  touch-action: none;
}

.upload-dest-head {
  display: grid;
  grid-template-columns: minmax(28px, 1fr) auto minmax(28px, 1fr);
  align-items: center;
  min-height: 28px;
  padding: 16px 16px 14px;
}

.upload-dest-dialog--sheet .upload-dest-head {
  padding: 8px 12px 10px;
}

.upload-dest-head-side {
  grid-column: 1;
  width: 28px;
  height: 28px;
}

.upload-dest-title {
  grid-column: 2;
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.3;
  text-align: center;
}

.upload-dest-x {
  display: flex;
  grid-column: 3;
  align-items: center;
  justify-content: center;
  justify-self: end;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  touch-action: manipulation;
}

.upload-dest-x:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (hover: hover) and (pointer: fine) {
  .upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-head {
    grid-template-columns: auto 1fr auto;
    padding: 16px 16px 14px 24px;
  }

  .upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-head-side {
    display: none;
  }

  .upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-title {
    grid-column: 1;
    text-align: left;
  }

  .upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-x {
    grid-column: 3;
  }
}

.upload-dest-seg {
  display: flex;
  flex-shrink: 0;
  margin: 0 20px 10px;
  padding: 3px;
  border-radius: 10px;
  background: #f2f2f5;
}

.upload-dest-seg button {
  flex: 1;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}

.upload-dest-seg button.upload-dest-seg-btn--on {
  background: #ffffff;
  color: #1d1d1f;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

html[data-scheme='dark'] .upload-dest-seg {
  background: #333338;
}

html[data-scheme='dark'] .upload-dest-seg button.upload-dest-seg-btn--on {
  background: #2c2c30;
  color: #f5f5f7;
}

@media (prefers-color-scheme: dark) {
  html:not([data-scheme='light']) .upload-dest-seg {
    background: #333338;
  }

  html:not([data-scheme='light']) .upload-dest-seg button.upload-dest-seg-btn--on {
    background: #2c2c30;
    color: #f5f5f7;
  }
}

.upload-dest-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--color-menu-divider);
}

.upload-dest-left {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 270px;
  min-height: 0;
  border-right: 1px solid var(--color-menu-divider);
}

.upload-dest-dialog--sheet .upload-dest-left,
.upload-dest-dialog--sheet .upload-dest-right {
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
.upload-dest-btn:disabled,
.upload-dest-delete:disabled,
.upload-dest-drop:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.upload-dest-newrow {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  padding: 0 12px 10px;
}

.upload-dest-newrow input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--color-menu-divider);
  border-radius: 9px;
  background: var(--color-page-bg);
  color: var(--color-menu-light-text);
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
  border-radius: 8px;
  font-size: 14px;
  user-select: none;
  cursor: pointer;
}

.upload-dest-dialog--sheet .upload-dest-row {
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
  border-radius: 7px;
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
  color: #e03131;
}

.upload-dest-right {
  flex: 1;
  min-width: 0;
  padding: 16px 22px;
  overflow: auto;
}

.upload-dest-dialog--sheet .upload-dest-right {
  padding: 14px 20px;
}

.upload-dest-crumb {
  margin: 0 0 12px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.upload-dest-crumb b {
  color: var(--color-menu-light-text);
}

.upload-dest-drop {
  display: block;
  width: 100%;
  padding: 22px 16px;
  border: 1.5px dashed var(--color-menu-divider);
  border-radius: 14px;
  background: var(--color-page-bg);
  color: var(--color-menu-light-text);
  font: inherit;
  text-align: center;
  cursor: pointer;
}

.upload-dest-dialog--sheet .upload-dest-drop {
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
  border-radius: 9px;
  font-size: 14px;
}

.upload-dest-file--new + .upload-dest-file--new {
  margin-top: 8px;
}

.upload-dest-dialog--sheet .upload-dest-file {
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
  flex-shrink: 0;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 12px 20px calc(16px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  border-top: 0.5px solid var(--color-border);
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
  color: var(--color-menu-light-text);
}

.upload-dest-btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--color-menu-divider);
  border-radius: 9px;
  background: var(--color-page-bg);
  color: var(--color-menu-light-text);
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}

.upload-dest-foot .upload-dest-btn,
.upload-dest-confirm-actions .upload-dest-btn {
  box-sizing: border-box;
  width: 100%;
  height: auto;
  margin: 0;
  padding: 11px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 14px;
  line-height: 1.2;
  touch-action: manipulation;
}

.upload-dest-foot .upload-dest-btn--primary,
.upload-dest-confirm-actions .upload-dest-btn--primary {
  border: none;
  background: var(--color-accent);
  color: #fff;
}

.upload-dest-foot .upload-dest-btn--danger,
.upload-dest-confirm-actions .upload-dest-btn--danger {
  border: none;
  background: #e03131;
  color: #fff;
}

.upload-dest-foot .upload-dest-btn--ghost,
.upload-dest-confirm-actions .upload-dest-btn--ghost {
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
}

.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-foot,
.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-confirm-actions {
  flex-direction: row;
  flex-wrap: nowrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-foot {
  padding: 14px 24px 18px;
}

.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-sum {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  margin: 0;
  order: 0;
}

.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-foot .upload-dest-btn--ghost,
.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-confirm-actions .upload-dest-btn--ghost {
  order: 1;
  flex: 0 0 auto;
  width: auto;
  padding: 6px 14px;
  border: 0.5px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 13px;
  white-space: nowrap;
}

.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-foot .upload-dest-btn--primary,
.upload-dest-dialog:not(.upload-dest-dialog--sheet) .upload-dest-confirm-actions .upload-dest-btn--danger {
  order: 2;
  flex: 0 0 auto;
  width: auto;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  white-space: nowrap;
}

.upload-dest-confirm-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
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
  background: rgba(20, 20, 30, 0.38);
}

.upload-dest-confirm-card {
  width: 100%;
  max-width: 340px;
  padding: 22px;
  border: 1px solid var(--color-menu-divider);
  border-radius: 16px;
  background: var(--color-menu-light-bg);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
}

.upload-dest-confirm-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.upload-dest-confirm-card p {
  margin: 0 0 18px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

@media (hover: hover) and (pointer: fine) {
  .upload-dest-x:hover:not(:disabled),
  .upload-dest-btn:hover:not(:disabled):not(.upload-dest-btn--primary):not(.upload-dest-btn--danger) {
    background: var(--color-menu-divider);
  }
}

@media (hover: none) {
  .upload-dest-delete {
    display: flex;
  }
}
</style>
