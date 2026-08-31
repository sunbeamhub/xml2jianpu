<template>
  <div
    ref="rootEl"
    class="app-select"
    :class="[
      variant === 'row' ? 'menu-row' : 'control-chip',
      `app-select--${variant}`,
    ]"
  >
    <button
      ref="triggerEl"
      type="button"
      class="app-select-trigger"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      :aria-activedescendant="open && activeOptionId ? activeOptionId : undefined"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <slot name="leading" />
      <span
        v-if="label"
        class="app-select-label"
        :class="variant === 'row' ? 'menu-row-label' : 'control-chip-text'"
      >{{ label }}</span>
      <slot name="trailing" />
      <svg
        v-if="caretVisible"
        class="control-chip-caret app-select-caret"
        :class="{ 'app-select-caret--open': open }"
        viewBox="0 0 12 12"
        width="10"
        height="10"
        aria-hidden="true"
      >
        <path
          d="M2.5 4.5 6 8l3.5-3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <Teleport to="body">
      <ul
        v-if="open"
        ref="panelEl"
        class="app-select-panel"
        :class="{ 'app-select-panel--nowrap': nowrap }"
        role="listbox"
        :aria-label="ariaLabel"
        :style="panelStyle"
        @keydown="onPanelKeydown"
      >
        <li
          v-for="(opt, index) in options"
          v-show="isOptionVisible(index)"
          :id="optionId(index)"
          :key="`${opt.value}-${index}`"
          class="app-select-option"
          :class="{
            'app-select-option--selected': !opt.group && !opt.disabled && opt.value === modelValue,
            'app-select-option--highlighted': index === highlightIndex,
            'app-select-option--disabled': opt.disabled,
            'app-select-option--group': opt.group,
            'app-select-option--indent': opt.indent,
            'app-select-option--collapsed': opt.group && isGroupCollapsed(opt.value),
          }"
          role="option"
          :aria-selected="!opt.group && !opt.disabled && opt.value === modelValue"
          :aria-disabled="opt.disabled || undefined"
          :aria-expanded="opt.group ? !isGroupCollapsed(opt.value) : undefined"
          @click="onOptionClick(opt, index)"
          @mouseenter="onOptionMouseEnter(opt, index)"
        >
          <svg
            v-if="opt.icon"
            class="app-select-option-icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path :d="opt.icon" fill="currentColor" />
          </svg>
          <span class="app-select-option-label">{{ opt.label }}</span>
          <svg
            v-if="opt.group"
            class="app-select-group-caret"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<script setup>
import {
  ref,
  computed,
  watch,
  nextTick,
  onBeforeUnmount,
} from 'vue'

const PANEL_MAX_HEIGHT = 280
const PANEL_GAP = 4
const PANEL_Z_INDEX = 100
const VIEWPORT_MARGIN = 8

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  label: { type: String, default: '' },
  ariaLabel: { type: String, required: true },
  variant: {
    type: String,
    default: 'chip',
    validator: (v) => v === 'row' || v === 'chip',
  },
  panelWidth: { type: [String, Number], default: 'auto' },
  panelMinWidth: { type: [String, Number], default: undefined },
  nowrap: { type: Boolean, default: false },
  showCaret: { type: Boolean, default: undefined },
})

const emit = defineEmits(['update:modelValue', 'open', 'close'])

const uid = `app-select-${Math.random().toString(36).slice(2, 9)}`

const rootEl = ref(null)
const triggerEl = ref(null)
const panelEl = ref(null)
const open = ref(false)
const openUpward = ref(false)
const highlightIndex = ref(-1)
const panelStyle = ref({})

const caretVisible = computed(() => {
  if (props.showCaret !== undefined) return props.showCaret
  return props.variant === 'chip'
})

const activeOptionId = computed(() => {
  if (highlightIndex.value < 0) return null
  return optionId(highlightIndex.value)
})

function optionId(index) {
  return `${uid}-opt-${index}`
}

function toCssLength(value) {
  if (value == null) return null
  if (typeof value === 'number') return `${value}px`
  return String(value)
}

function parsePx(value) {
  if (value == null || value === '') return NaN
  if (typeof value === 'number') return value
  const match = String(value).trim().match(/^([\d.]+)px$/)
  return match ? Number(match[1]) : NaN
}

function readCssPx(raw) {
  if (typeof document === 'undefined' || raw == null || raw === '') return NaN
  const trimmed = String(raw).trim()
  const varMatch = trimmed.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/)
  if (varMatch) {
    const fromRoot = getComputedStyle(document.documentElement)
      .getPropertyValue(varMatch[1])
      .trim()
    const parsed = parsePx(fromRoot)
    if (Number.isFinite(parsed)) return parsed
    if (varMatch[2]) return readCssPx(varMatch[2])
  }
  const parsed = parsePx(trimmed)
  if (Number.isFinite(parsed)) return parsed
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;width:${trimmed};pointer-events:none;`
  document.body.appendChild(probe)
  const px = probe.getBoundingClientRect().width
  document.body.removeChild(probe)
  return px
}

function resolveDesiredWidthPx(rect, panel) {
  const minWidthRaw = toCssLength(props.panelMinWidth)
  const minWidthPx = minWidthRaw ? readCssPx(minWidthRaw) : 0
  let desired

  if (props.panelWidth === 'auto') {
    desired = panel?.scrollWidth || panel?.offsetWidth || 0
  } else if (props.panelWidth === 'trigger') {
    desired = rect.width
  } else {
    const raw = toCssLength(props.panelWidth)
    const parsed = parsePx(raw)
    desired = Number.isFinite(parsed) ? parsed : readCssPx(raw)
  }

  return Math.max(desired || 0, minWidthPx || 0)
}

function clampToViewport(preferredLeft, widthPx) {
  const maxWidth = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2)
  const width = Math.min(widthPx, maxWidth)
  let left = preferredLeft
  if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
    left = window.innerWidth - VIEWPORT_MARGIN - width
  }
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN
  return { left, width }
}

const collapsedGroups = ref(new Set())

function isGroupCollapsed(value) {
  return collapsedGroups.value.has(value)
}

function parentGroupValue(index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const opt = props.options[i]
    if (opt.group) return opt.value
    if (!opt.indent) return null
  }
  return null
}

function isOptionVisible(index) {
  const opt = props.options[index]
  if (!opt || opt.group || opt.disabled || !opt.indent) return true
  const parent = parentGroupValue(index)
  if (!parent) return true
  return !collapsedGroups.value.has(parent)
}

function syncCollapsedGroups() {
  const next = new Set()
  let selectedParent = null
  props.options.forEach((opt, index) => {
    if (opt.group) next.add(opt.value)
    if (opt.value === props.modelValue && isSelectable(opt)) {
      selectedParent = parentGroupValue(index)
    }
  })
  if (selectedParent) next.delete(selectedParent)
  collapsedGroups.value = next
}

function toggleGroup(value) {
  const next = new Set(collapsedGroups.value)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  collapsedGroups.value = next
  if (next.has(value) && parentGroupValue(highlightIndex.value) === value) {
    const groupIndex = props.options.findIndex((opt) => opt.group && opt.value === value)
    if (groupIndex >= 0) highlightIndex.value = groupIndex
  }
  nextTick(updatePosition)
}

function isSelectable(opt) {
  return opt && !opt.disabled && !opt.group
}

function isInteractive(opt, index) {
  if (!opt || opt.disabled) return false
  if (opt.group) return true
  return isSelectable(opt) && isOptionVisible(index)
}

function selectableIndices() {
  return props.options.reduce((acc, opt, index) => {
    if (isSelectable(opt) && isOptionVisible(index)) acc.push(index)
    return acc
  }, [])
}

function interactiveIndices() {
  return props.options.reduce((acc, opt, index) => {
    if (isInteractive(opt, index)) acc.push(index)
    return acc
  }, [])
}

function findSelectedIndex() {
  const indices = selectableIndices()
  const hit = indices.find((i) => props.options[i].value === props.modelValue)
  return hit ?? indices[0] ?? -1
}

function setOpen(next) {
  if (open.value === next) return
  open.value = next
  if (next) {
    syncCollapsedGroups()
    highlightIndex.value = findSelectedIndex()
    emit('open')
    nextTick(() => {
      updatePosition()
      if (props.panelWidth === 'auto') {
        nextTick(updatePosition)
      }
      bindGlobalListeners()
    })
  } else {
    openUpward.value = false
    emit('close')
    unbindGlobalListeners()
  }
}

function toggle() {
  setOpen(!open.value)
}

function close() {
  setOpen(false)
}

function selectOption(opt) {
  if (!isSelectable(opt)) return
  emit('update:modelValue', opt.value)
  close()
  nextTick(() => triggerEl.value?.focus())
}

function onOptionClick(opt, index) {
  if (opt.group) {
    toggleGroup(opt.value)
    highlightIndex.value = index
    return
  }
  if (!isSelectable(opt)) return
  highlightIndex.value = index
  selectOption(opt)
}

function onOptionMouseEnter(opt, index) {
  if (isInteractive(opt, index)) highlightIndex.value = index
}

function activateHighlighted() {
  const opt = props.options[highlightIndex.value]
  if (opt?.group) {
    toggleGroup(opt.value)
    return
  }
  if (isSelectable(opt)) selectOption(opt)
}

function moveHighlight(delta) {
  const indices = interactiveIndices()
  if (!indices.length) return
  const currentPos = indices.indexOf(highlightIndex.value)
  let nextPos
  if (currentPos === -1) {
    nextPos = delta > 0 ? 0 : indices.length - 1
  } else {
    nextPos = (currentPos + delta + indices.length) % indices.length
  }
  highlightIndex.value = indices[nextPos]
  scrollHighlightedIntoView()
}

function scrollHighlightedIntoView() {
  nextTick(() => {
    const panel = panelEl.value
    if (!panel || highlightIndex.value < 0) return
    const el = panel.querySelector(`#${optionId(highlightIndex.value)}`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onTriggerKeydown(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (!open.value) {
      setOpen(true)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      activateHighlighted()
    }
  } else if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    close()
  }
}

function onPanelKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    triggerEl.value?.focus()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveHighlight(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveHighlight(-1)
  } else if (e.key === 'Home') {
    e.preventDefault()
    const indices = interactiveIndices()
    if (indices.length) highlightIndex.value = indices[0]
    scrollHighlightedIntoView()
  } else if (e.key === 'End') {
    e.preventDefault()
    const indices = interactiveIndices()
    if (indices.length) highlightIndex.value = indices[indices.length - 1]
    scrollHighlightedIntoView()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    activateHighlighted()
  }
}

function updatePosition() {
  const trigger = triggerEl.value
  if (!trigger || !open.value) return

  const rect = trigger.getBoundingClientRect()
  const panel = panelEl.value
  const panelHeight = panel?.offsetHeight ?? PANEL_MAX_HEIGHT
  const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP
  const spaceAbove = rect.top - PANEL_GAP
  const opensUp =
    spaceBelow < Math.min(panelHeight, PANEL_MAX_HEIGHT) && spaceAbove > spaceBelow
  openUpward.value = opensUp
  const maxHeight = Math.max(
    120,
    Math.min(PANEL_MAX_HEIGHT, opensUp ? spaceAbove : spaceBelow)
  )
  const vertical = opensUp
    ? { bottom: `${window.innerHeight - rect.top + PANEL_GAP}px`, top: 'auto' }
    : { top: `${rect.bottom + PANEL_GAP}px`, bottom: 'auto' }

  const isAuto = props.panelWidth === 'auto'
  if (isAuto && !panel) {
    panelStyle.value = {
      position: 'fixed',
      left: `${rect.left}px`,
      width: 'max-content',
      maxWidth: `${Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2)}px`,
      maxHeight: `${maxHeight}px`,
      zIndex: PANEL_Z_INDEX,
      ...vertical,
    }
    return
  }

  if (isAuto && panel) {
    panel.style.width = 'max-content'
  }

  const desiredWidth = resolveDesiredWidthPx(rect, panel)
  const { left, width } = clampToViewport(rect.left, desiredWidth || rect.width)

  panelStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    zIndex: PANEL_Z_INDEX,
    ...vertical,
  }
}

function onPointerDownOutside(e) {
  const target = e.target
  if (triggerEl.value?.contains(target)) return
  if (panelEl.value?.contains(target)) return
  close()
}

function onViewportChange() {
  if (open.value) updatePosition()
}

function bindGlobalListeners() {
  document.addEventListener('pointerdown', onPointerDownOutside, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
}

function unbindGlobalListeners() {
  document.removeEventListener('pointerdown', onPointerDownOutside, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
}

watch(
  () => props.options,
  () => {
    if (open.value) nextTick(updatePosition)
  }
)

onBeforeUnmount(() => {
  unbindGlobalListeners()
})
</script>

<style scoped>
.app-select {
  position: relative;
}

.app-select-trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: inherit;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  font: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-appearance: none;
  appearance: none;
}

.app-select--row .app-select-trigger {
  justify-content: space-between;
  min-height: var(--menu-row-height);
}

.app-select--chip .app-select-trigger {
  justify-content: center;
  min-height: var(--menu-row-height);
}

.app-select-trigger > :deep(* + *) {
  margin-left: 12px;
}

.app-select--chip .app-select-trigger > :deep(* + *) {
  margin-left: 4px;
}

.app-select-trigger:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.app-select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

.app-select-caret {
  flex-shrink: 0;
  transform: translateY(0.5px);
  transition: transform 0.15s ease;
}

.app-select-caret.app-select-caret--open {
  transform: translateY(0.5px) rotate(180deg);
}

.app-select-panel {
  box-sizing: border-box;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: var(--menu-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  font-family: var(--font-ui);
  font-size: var(--font-size-menu);
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
  -webkit-overflow-scrolling: touch;
}

.app-select-panel--nowrap {
  overflow-x: auto;
}

.app-select-panel--nowrap .app-select-option {
  white-space: nowrap;
}

.app-select-option {
  display: flex;
  align-items: center;
  min-width: max-content;
  min-height: var(--menu-row-height);
  padding: 0 14px;
  cursor: pointer;
  line-height: 1.2;
  user-select: none;
}

.app-select-option-icon {
  flex-shrink: 0;
  display: block;
  margin-right: 8px;
}

.app-select-option-label {
  flex-shrink: 0;
}

.app-select-option--indent {
  padding-left: 32px;
}

.app-select-option--highlighted:not(.app-select-option--disabled) {
  background: var(--color-menu-divider);
}

.app-select-option--selected:not(.app-select-option--group) {
  color: var(--color-accent);
}

.app-select-option--disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}

.app-select-option--group {
  font-size: 0.85em;
  font-weight: 600;
  opacity: 0.85;
  cursor: pointer;
}

.app-select-group-caret {
  flex-shrink: 0;
  margin-left: 8px;
  transform: translateY(0.5px) rotate(180deg);
  transition: transform 0.15s ease;
}

.app-select-option--collapsed .app-select-group-caret {
  transform: translateY(0.5px);
}

.app-select-option--group + .app-select-option--group,
.app-select-option:not(.app-select-option--group) + .app-select-option--group {
  border-top: 1px solid var(--color-menu-divider);
}
</style>
