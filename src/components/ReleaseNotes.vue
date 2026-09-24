<template>
  <div class="release-notes">
    <pre v-if="failed" class="release-notes-fallback">{{ fallbackText }}</pre>
    <template v-else>
      <p v-if="!blocks.length" class="release-notes-note">（无说明）</p>
      <template v-for="(block, index) in blocks" :key="index">
        <p v-if="block.type === 'date'" class="release-notes-date">{{ block.text }}</p>
        <h3 v-else-if="block.type === 'heading'" class="release-notes-heading">{{ block.text }}</h3>
        <ul v-else-if="block.type === 'list'" class="release-notes-list">
          <li v-for="(item, itemIndex) in block.items || []" :key="itemIndex">
            <ReleaseInline :text="item" />
          </li>
        </ul>
        <img
          v-else-if="block.type === 'image' && block.src"
          class="release-notes-image"
          :src="block.src"
          :alt="block.alt || ''"
        />
        <p v-else-if="block.type === 'note'" class="release-notes-note">
          <ReleaseInline :text="block.text" />
        </p>
        <p v-else class="release-notes-paragraph">
          <ReleaseInline :text="block.text" />
        </p>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { parseReleaseNotes } from '../utils/releaseNotes.js'
import ReleaseInline from './ReleaseInline.vue'

const props = defineProps({
  body: { type: String, default: '' },
})

const parsed = computed(() => {
  try {
    return parseReleaseNotes(props.body)
  } catch {
    return null
  }
})

const failed = computed(() => parsed.value == null)
const blocks = computed(() => parsed.value || [])
const fallbackText = computed(() => String(props.body ?? ''))
</script>

<style scoped>
.release-notes-date,
.release-notes-paragraph,
.release-notes-note {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
}

.release-notes-date,
.release-notes-note {
  color: var(--color-text-secondary);
}

.release-notes-paragraph {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-primary);
}

.release-notes-heading {
  margin: 8px 0 4px;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.release-notes-list {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-text-primary);
}

.release-notes-list li {
  position: relative;
  padding-left: 12px;
}

.release-notes-list li::before {
  content: '·';
  position: absolute;
  left: 0;
}

.release-notes-list li + li {
  margin-top: 2px;
}

.release-notes-image {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 0 12px;
  border-radius: 12px;
}

.release-notes-note {
  white-space: pre-wrap;
  word-break: break-word;
}

.release-notes-fallback {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
</style>
