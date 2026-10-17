<script setup>
/* global defineProps, defineEmits */
import { computed, ref, watch } from 'vue'
import { buildScoreNodes } from '../../utils/scoreLibrary.js'
import { useCompactSheet } from '../../composables/useCompactSheet.js'
import Dialog from '../ui/Dialog.vue'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  rootLabel: { type: String, default: '曲谱' },
})

const emit = defineEmits(['close', 'select'])

const { useSheet } = useCompactSheet()
const openMap = ref({ '': true })
const browseRel = ref('')

const tree = computed(() => buildScoreNodes(props.entries))

const frameProps = computed(() => {
  const raised = { raised: true }
  if (useSheet.value) {
    return {
      title: '选择曲谱',
      titleId: 'score-picker-title',
      ...raised,
    }
  }
  return {
    title: '选择曲谱',
    titleId: 'score-picker-title',
    fill: true,
    maxWidth: '800px',
    maxHeight: '540px',
    padded: false,
    titleAlign: 'start',
    ...raised,
  }
})

function dirOf(id) {
  const value = String(id || '')
  if (!value.includes('/')) return ''
  return value.slice(0, value.lastIndexOf('/'))
}

function parentRel(rel) {
  if (!rel || !rel.includes('/')) return ''
  return rel.slice(0, rel.lastIndexOf('/'))
}

function isOpen(rel) {
  if (rel === '') return openMap.value[''] !== false
  return !!openMap.value[rel]
}

function onAncestorPath(rel, dir) {
  if (rel === dir) return true
  if (!rel) return true
  return !!dir && dir.startsWith(`${rel}/`)
}

function onSelectedPath(rel) {
  if (!props.selected) return false
  return onAncestorPath(rel, dirOf(props.selected))
}

function onBrowsePath(rel) {
  return onAncestorPath(rel, browseRel.value)
}

function revealSelected() {
  const next = { ...openMap.value, '': true }
  let cursor = dirOf(props.selected)
  while (cursor) {
    next[cursor] = true
    cursor = parentRel(cursor)
  }
  openMap.value = next
}

function resetOpen() {
  openMap.value = { '': true }
  browseRel.value = dirOf(props.selected)
  revealSelected()
}

resetOpen()

watch(
  () => props.selected,
  () => {
    revealSelected()
  }
)

function toggle(rel) {
  const next = { ...openMap.value, [rel]: !isOpen(rel) }
  openMap.value = next
}

function findNode(node, rel) {
  if (!node) return null
  if (node.rel === rel) return node
  for (const dir of node.dirs) {
    const found = findNode(dir, rel)
    if (found) return found
  }
  return null
}

function childEntries(node, includeFiles) {
  const dirs = node.dirs.map((dir) => ({ kind: 'dir', name: dir.name, dir }))
  const files = includeFiles
    ? node.files.map((file) => ({ kind: 'file', name: file.name, file }))
    : []
  return [...dirs, ...files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

const rows = computed(() => {
  const list = []
  const includeFiles = useSheet.value
  function walk(node, depth) {
    const open = isOpen(node.rel)
    const hasChildren = includeFiles
      ? node.dirs.length + node.files.length > 0
      : node.dirs.length > 0
    list.push({
      kind: 'dir',
      rel: node.rel,
      name: node.rel ? node.name : props.rootLabel,
      depth,
      open,
      hasChildren,
      onPath: onSelectedPath(node.rel),
      opened: includeFiles ? open : onBrowsePath(node.rel),
    })
    if (!open) return
    for (const entry of childEntries(node, includeFiles)) {
      if (entry.kind === 'dir') walk(entry.dir, depth + 1)
      else {
        list.push({
          kind: 'file',
          id: entry.file.id,
          name: entry.file.name,
          depth: depth + 1,
          selected: entry.file.id === props.selected,
        })
      }
    }
  }
  walk(tree.value, 0)
  return list
})

const currentFiles = computed(() => {
  const node = findNode(tree.value, browseRel.value) || tree.value
  return node.files
})

const pathLabel = computed(() => {
  if (!browseRel.value) return props.rootLabel
  return [props.rootLabel, ...browseRel.value.split('/')].join(' › ')
})

function onDirClick(row) {
  if (useSheet.value) {
    if (row.hasChildren) toggle(row.rel)
    return
  }
  browseRel.value = row.rel
}

function onScore(id) {
  if (!id || id === props.selected) return
  emit('select', id)
}
</script>

<template>
  <component
    :is="useSheet ? Sheet : Dialog"
    v-bind="frameProps"
    @close="emit('close')"
  >
    <div class="score-picker" :class="{ 'score-picker--sheet': useSheet }">
      <div class="score-picker-side">
        <div class="score-picker-tree" role="tree" aria-label="曲谱目录">
          <div
            v-for="row in rows"
            :key="row.kind === 'file' ? row.id : `dir:${row.rel || 'root'}`"
            class="score-picker-row"
            :class="{
              'score-picker-row--current': row.kind === 'file' ? row.selected : row.onPath,
              'score-picker-row--open': row.kind === 'dir' && row.opened,
            }"
            role="treeitem"
            :aria-selected="row.kind === 'file' ? row.selected : row.onPath"
            :aria-expanded="row.kind === 'dir' && row.hasChildren ? row.open : undefined"
            :style="{ paddingLeft: `${8 + row.depth * 20}px` }"
            @click="row.kind === 'file' ? onScore(row.id) : onDirClick(row)"
          >
            <button
              v-if="row.kind === 'dir' && row.hasChildren"
              type="button"
              class="score-picker-chev"
              :class="{ 'score-picker-chev--open': row.open }"
              :aria-label="row.open ? '折叠' : '展开'"
              @click.stop="toggle(row.rel)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="m9 6 6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <span v-else class="score-picker-chev score-picker-chev--spacer" />
            <svg
              v-if="row.kind === 'dir'"
              class="score-picker-folder"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                v-if="row.opened"
                d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v.7H5.6L3 18.2V6.5z"
              />
              <path
                v-if="row.opened"
                d="M4.4 10.2h16.8l-1.7 7.1a1.5 1.5 0 0 1-1.46 1.15H5.7a1.5 1.5 0 0 1-1.46-1.2L4.4 10.2z"
              />
              <path
                v-else
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
              />
            </svg>
            <svg
              v-else
              class="score-picker-note"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="score-picker-name">{{ row.name }}</span>
            <svg
              v-if="row.kind === 'file' && row.selected"
              class="score-picker-check"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <path
                d="M5 12.5 9.2 17 19 7"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
      <div v-if="!useSheet" class="score-picker-main">
        <p class="score-picker-path">{{ pathLabel }}</p>
        <div class="score-picker-scores">
          <p v-if="!currentFiles.length" class="score-picker-empty">这个目录还没有曲谱</p>
          <button
            v-for="file in currentFiles"
            :key="file.id"
            type="button"
            class="score-picker-score"
            :class="{ 'score-picker-score--on': file.id === selected }"
            :aria-pressed="file.id === selected"
            @click="onScore(file.id)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="score-picker-name">{{ file.name }}</span>
            <svg
              v-if="file.id === selected"
              class="score-picker-check"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <path
                d="M5 12.5 9.2 17 19 7"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </component>
</template>

<style scoped>
.score-picker {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.score-picker--sheet {
  flex-direction: column;
}

.score-picker-side {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 270px;
  min-height: 0;
  border-right: var(--divider);
}

.score-picker--sheet .score-picker-side {
  flex: 1 1 auto;
  width: auto;
  border-right: 0;
}

.score-picker-tree,
.score-picker-scores {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.score-picker-tree {
  padding: 8px;
}

.score-picker-row,
.score-picker-score {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 38px;
  margin: 0;
  padding-top: 0;
  padding-right: 8px;
  padding-bottom: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: start;
  user-select: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.score-picker--sheet .score-picker-row {
  height: 50px;
  font-size: 15px;
}

.score-picker-row--open {
  font-weight: 600;
}

.score-picker-row--current,
.score-picker-score--on {
  color: var(--color-accent);
  font-weight: 600;
}

@media (hover: hover) and (pointer: fine) {
  .score-picker-row:hover,
  .score-picker-score:hover {
    font-weight: 600;
  }
}

.score-picker-chev {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.score-picker-chev--spacer {
  visibility: hidden;
}

.score-picker-chev--open {
  transform: rotate(90deg);
}

.score-picker-folder {
  flex: none;
  width: 20px;
  height: 20px;
  fill: #f5b83d;
}

.score-picker-note,
.score-picker-check {
  flex: none;
  display: block;
}

.score-picker-row > * + *,
.score-picker-score > * + * {
  margin-left: 6px;
}

.score-picker-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.score-picker-check {
  color: var(--color-accent);
}

.score-picker-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.score-picker-path {
  box-sizing: border-box;
  display: flex;
  flex: none;
  align-items: center;
  height: 46px;
  margin: 0 14px;
  padding: 8px 8px 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.4;
}

.score-picker-scores {
  padding: 0 14px 8px;
}

.score-picker-score {
  padding-left: 8px;
}

.score-picker-empty {
  margin: 8px;
  color: var(--color-text-secondary);
  font-size: 14px;
}
</style>
