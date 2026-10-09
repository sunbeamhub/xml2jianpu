<template>
  <Teleport to="body">
    <div
      class="score-dock"
      :class="{ 'score-dock--visible': visible }"
      role="tablist"
      aria-label="功能"
      :aria-hidden="visible ? 'false' : 'true'"
      @mouseenter="$emit('hover', true)"
      @mouseleave="$emit('hover', false)"
      @click.stop
    >
      <button
        type="button"
        class="score-dock-btn"
        role="tab"
        :class="{ 'score-dock-btn--selected': performSelected }"
        :tabindex="visible ? 0 : -1"
        :aria-selected="transposeOpen ? 'true' : 'false'"
        aria-label="演奏"
        @click="$emit('toggle-transpose')"
      >
        <TransposeIcon />
        <span class="score-dock-label">演奏</span>
      </button>
      <button
        type="button"
        class="score-dock-btn"
        role="tab"
        :class="{ 'score-dock-btn--selected': scoreOpen }"
        :tabindex="visible ? 0 : -1"
        :aria-selected="scoreOpen ? 'true' : 'false'"
        aria-label="乐谱"
        @click="$emit('toggle-score')"
      >
        <svg class="score-dock-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M3 7.2h18M3 10.2h18M3 13.2h18M3 16.2h18M3 19.2h18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <ellipse cx="8.6" cy="15.15" rx="1.7" ry="1.2" fill="currentColor" />
          <ellipse cx="15.2" cy="12.15" rx="1.7" ry="1.2" fill="currentColor" />
          <path
            d="M10.2 14.4V6.6h5.7V11.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="score-dock-label">乐谱</span>
      </button>
      <button
        type="button"
        class="score-dock-btn"
        role="tab"
        :class="{ 'score-dock-btn--selected': aboutOpen }"
        :tabindex="visible ? 0 : -1"
        :aria-selected="aboutOpen ? 'true' : 'false'"
        :aria-label="updateDot ? '关于，有新版本' : '关于'"
        @click="$emit('open-about')"
      >
        <svg class="score-dock-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="12" cy="12" r="8.1" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M12 11v5.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <circle cx="12" cy="8" r="1" fill="currentColor" />
        </svg>
        <span class="score-dock-label">关于</span>
        <span v-if="updateDot" class="score-dock-dot" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>

<script setup>
/* global defineProps, defineEmits */
import { computed } from 'vue'
import { TransposeIcon } from './TransposePanel.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  transposeDirty: { type: Boolean, default: false },
  transposeOpen: { type: Boolean, default: false },
  scoreOpen: { type: Boolean, default: false },
  aboutOpen: { type: Boolean, default: false },
  updateDot: { type: Boolean, default: false },
})

defineEmits(['hover', 'toggle-transpose', 'toggle-score', 'open-about'])

const performSelected = computed(() => props.transposeOpen || props.transposeDirty)
</script>

<style scoped>
.score-dock {
  position: fixed;
  left: calc(50% - var(--score-overview-reserve, 0px) / 2);
  bottom: calc(14px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  z-index: 80;
  box-sizing: border-box;
  display: flex;
  align-items: stretch;
  width: min(78vw, 300px);
  height: 60px;
  padding: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  transform: translateX(-50%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  touch-action: manipulation;
}

.score-dock--visible {
  opacity: 1;
  pointer-events: auto;
}

.score-dock-btn {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 24px;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.score-dock-btn--selected {
  background: rgba(10, 132, 255, 0.14);
  color: var(--color-accent);
}

.score-dock-btn:focus {
  outline: none;
}

.score-dock-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.score-dock-icon,
.score-dock-btn :deep(svg) {
  display: block;
  flex-shrink: 0;
}

.score-dock-label {
  margin-top: 1px;
  font-size: 10.5px;
  line-height: 1.2;
}

.score-dock-dot {
  position: absolute;
  top: 4px;
  right: 10px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-error);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.78);
}

.score-dock-btn--selected .score-dock-dot {
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.14);
}

html[data-scheme='dark'] .score-dock {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(44, 44, 46, 0.78);
}

html[data-scheme='dark'] .score-dock-dot {
  box-shadow: 0 0 0 2px rgba(44, 44, 46, 0.78);
}

@media (prefers-color-scheme: dark) {
  html:not([data-scheme='light']) .score-dock {
    border-color: rgba(255, 255, 255, 0.12);
    background: rgba(44, 44, 46, 0.78);
  }

  html:not([data-scheme='light']) .score-dock-dot {
    box-shadow: 0 0 0 2px rgba(44, 44, 46, 0.78);
  }
}

@media (prefers-reduced-motion: reduce) {
  .score-dock-btn {
    transition: none;
  }
}
</style>
