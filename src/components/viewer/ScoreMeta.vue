<script>
export default {
  props: {
    scoreMeta: { type: Object, required: true },
    columnCount: { type: Number, default: 1 },
    metaStackMood: { type: Boolean, default: false },
    metaStackAuthors: { type: Boolean, default: false },
    metaWrapAuthors: { type: Boolean, default: false },
    metaStyle: { type: Object, default: () => ({}) },
  },
  computed: {
    keyAccidental() {
      const name = this.scoreMeta?.keyName || ''
      if (name.startsWith('b') || name.startsWith('#')) return name[0]
      return ''
    },
    keyLetter() {
      const name = this.scoreMeta?.keyName || ''
      if (name.startsWith('b') || name.startsWith('#')) return name.slice(1)
      return name
    },
  },
}
</script>

<template>
          <div
            class="score-meta"
            :class="{
              'score-meta--overlay': columnCount > 1,
              'score-meta--stack-mood': metaStackMood,
              'score-meta--stack-authors': metaStackAuthors,
              'score-meta--wrap-authors': metaWrapAuthors,
            }"
            :style="metaStyle"
          >
            <div class="score-meta-left">
              <div class="score-meta-keytime">
                <span class="score-key">
                  1=<template v-if="keyAccidental"><span class="score-accidental">{{ keyAccidental }}</span></template>{{ keyLetter }}
                </span>
                <span
                  v-if="scoreMeta.beats"
                  class="score-time"
                  :aria-label="`${scoreMeta.beats}/${scoreMeta.beatType}`"
                >
                  <span class="score-time-num">{{ scoreMeta.beats }}</span>
                  <span class="score-time-bar" />
                  <span class="score-time-num">{{ scoreMeta.beatType }}</span>
                </span>
              </div>
              <div
                v-if="scoreMeta.tempo || scoreMeta.expression"
                class="score-meta-mood"
              >
                <span v-if="scoreMeta.tempo" class="score-tempo">
                  <svg
                    class="score-tempo-note"
                    viewBox="0 0 12 18"
                    aria-hidden="true"
                  >
                    <ellipse
                      cx="5"
                      cy="14.5"
                      rx="5"
                      ry="3.6"
                      transform="rotate(-25 5 14.5)"
                      fill="currentColor"
                    />
                    <line
                      x1="9.2"
                      y1="14.5"
                      x2="9.2"
                      y2="0.5"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                  </svg>
                  ={{ scoreMeta.tempo }}
                </span>
                <span v-if="scoreMeta.expression" class="score-expression">{{
                  scoreMeta.expression
                }}</span>
              </div>
            </div>
            <div
              v-if="scoreMeta.authorLines?.length"
              class="score-meta-authors"
            >
              <div
                v-for="(line, i) in scoreMeta.authorLines"
                :key="i"
                class="score-author-line"
              >
                {{ line }}
              </div>
            </div>
          </div>
</template>

<style scoped>
.score-meta {
  box-sizing: border-box;
  flex-shrink: 0;
  font-family: var(--font-score);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: calc(var(--font-size-score-meta) * 4 / 16) 0
    calc(var(--font-size-score-meta) * 16 / 16);
  color: var(--color-text-primary);
  pointer-events: none;
  user-select: none;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}

.score-meta > * + * {
  margin-left: calc(var(--font-size-score-meta) * 16 / 16);
}

.score-meta--overlay {
  padding-bottom: calc(var(--font-size-score-meta) * 8 / 16);
  z-index: 1;
}

.score-meta-left {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  min-width: 0;
}

.score-meta-left > * + * {
  margin-left: calc(var(--font-size-score-meta) * 18 / 16);
}

.score-meta--stack-mood {
  align-items: flex-start;
}

.score-meta--stack-mood .score-meta-left {
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: flex-start;
}

.score-meta--stack-mood .score-meta-left > * + * {
  margin-left: 0;
  margin-top: calc(var(--font-size-score-meta) * 8 / 16);
}

.score-meta--stack-authors {
  flex-direction: column;
  align-items: stretch;
}

.score-meta--stack-authors > * + * {
  margin-left: 0;
  margin-top: calc(var(--font-size-score-meta) * 16 / 16);
}

.score-meta--stack-authors .score-meta-authors {
  width: 100%;
}

.score-meta-keytime {
  display: flex;
  align-items: center;
}

.score-meta-keytime > * + * {
  margin-left: calc(var(--font-size-score-meta) * 18 / 16);
}

.score-key,
.score-accidental,
.score-time-num,
.score-meta-mood,
.score-meta-authors {
  font-size: var(--font-size-score-meta);
}

.score-key {
  line-height: 1;
  white-space: nowrap;
}

.score-accidental {
  vertical-align: calc(var(--font-size-score-meta) * 0.5);
  margin-right: calc(var(--font-size-score-meta) * 1 / 16);
}

.score-time {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: calc(var(--font-size-score-meta) * 18 / 16);
  line-height: 1;
}

.score-time-num {
  font-weight: 600;
}

.score-time-bar {
  display: block;
  width: calc(var(--font-size-score-meta) * 18 / 16);
  height: calc(var(--font-size-score-meta) * 1.2 / 16);
  margin: calc(var(--font-size-score-meta) * 2 / 16) 0;
  background: var(--color-text-primary);
}

.score-meta-mood {
  display: flex;
  align-items: center;
  line-height: 1;
}

.score-meta-mood > * + * {
  margin-left: calc(var(--font-size-score-meta) * 14 / 16);
}

.score-tempo {
  display: inline-flex;
  align-items: center;
}

.score-tempo > * + * {
  margin-left: calc(var(--font-size-score-meta) * 2 / 16);
}

.score-tempo-note {
  display: block;
  flex-shrink: 0;
  width: calc(var(--font-size-score-meta) * 12 / 16);
  height: calc(var(--font-size-score-meta) * 18 / 16);
}

.score-meta-authors {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.3;
  text-align: right;
  flex-shrink: 0;
}

.score-meta-authors > * + * {
  margin-top: calc(var(--font-size-score-meta) * 4 / 16);
}

.score-author-line {
  white-space: nowrap;
}

.score-meta--wrap-authors .score-author-line {
  white-space: normal;
}
</style>
