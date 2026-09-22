<template>
  <div
    class="about-anchor"
    :class="{ 'about-anchor--visible': visible }"
    :aria-hidden="visible ? 'false' : 'true'"
  >
    <button
      type="button"
      class="about-btn"
      :tabindex="visible ? 0 : -1"
      :aria-label="dot ? '关于，有新版本' : '关于'"
      @click.stop="$emit('open')"
      @mouseenter="$emit('hover', true)"
      @mouseleave="$emit('hover', false)"
    >
      关于
      <span v-if="dot" class="about-dot" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  dot: { type: Boolean, default: false },
})
defineEmits(['open', 'hover'])
</script>

<style scoped>
.about-anchor {
  position: fixed;
  left: 50%;
  bottom: calc(16px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  z-index: 80;
  transform: translateX(-50%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  touch-action: manipulation;
}

.about-anchor--visible {
  opacity: 1;
  pointer-events: auto;
}

.about-btn {
  position: relative;
  box-sizing: border-box;
  height: 36px;
  margin: 0;
  padding: 0 16px;
  border: none;
  border-radius: 12px;
  background: var(--color-menu-light-bg);
  color: var(--color-text-primary);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  font: inherit;
  font-size: 15px;
  line-height: 36px;
  cursor: pointer;
  touch-action: manipulation;
}

.about-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-error);
  box-shadow: 0 0 0 2px var(--color-menu-light-bg);
}
</style>
