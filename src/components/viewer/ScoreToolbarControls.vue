<script>
import { defineComponent, h, ref, onBeforeUnmount } from 'vue'
import { NOTATION_JIANPU } from '../../utils/osmdRenderer.js'
import { isTauri } from '../../utils/platform.js'
import { buildScoreTree, scoreFileLabel } from '../../utils/scoreLibrary.js'
import {
  SCORE_FONT_SIZE_DEFAULT,
  SCORE_FONT_SIZE_MIN,
  SCORE_FONT_SIZE_MAX,
  SCORE_FONT_SIZE_LEVELS,
} from '../../utils/scoreMetrics.js'
import { DEFAULT_PAPER_SIZE, DISPLAY_SIZES } from '../../utils/pageLayout.js'
import { armPageZoomBlock, clearPageZoomBlock } from '../../utils/pageZoomBlock.js'
import AppSelect from '../AppSelect.vue'
import NotationSwitch from './NotationSwitch.vue'

/** 可复用功能区（上传 / 示例 / 纸张 / 换行 / 导出） */
export default defineComponent({
  name: 'ScoreToolbarControls',
  props: {
    layout: { type: String, default: 'row' },
    /** start=上传+示例；end=纸张+换行+导出；all=全部 */
    group: { type: String, default: 'all' },
    rootExamples: { type: Array, required: true },
    albumGroups: { type: Array, required: true },
    selectedExample: { type: String, default: '' },
    lineBreak: { type: String, default: 'auto' },
    paperSize: { type: String, default: DEFAULT_PAPER_SIZE },
    currentXml: { type: String, default: '' },
    exporting: { type: Boolean, default: false },
    scoreFontSize: { type: Number, default: SCORE_FONT_SIZE_DEFAULT },
    theme: { type: String, default: 'auto' },
    notationMode: { type: String, default: NOTATION_JIANPU },
    /** APP 曲谱目录里的相对路径 */
    scoreFiles: { type: Array, default: () => [] },
    beforeScoreMenu: { type: Function, default: null },
  },
  emits: [
    'update:selectedExample',
    'update:lineBreak',
    'update:paperSize',
    'update:theme',
    'update:notationMode',
    'font-size-step',
    'example-change',
    'file-change',
    'native-file-open',
    'export-pdf',
    'select-menu-open',
    'select-menu-close',
  ],
  setup(props, { emit }) {
    const fileAccept =
      '.musicxml,.xml,text/xml,application/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,*/*'

    const menuIcon = (pathD, size = 18) =>
      h(
        'svg',
        {
          class: 'menu-row-icon',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': 'true',
        },
        [h('path', { fill: 'currentColor', d: pathD })]
      )

    const themeIcon = (theme) => {
      const size = 18
      if (theme === 'dark') {
        return h(
          'svg',
          {
            class: 'theme-icon',
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            'aria-hidden': 'true',
          },
          [
            h('path', {
              fill: 'currentColor',
              d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
            }),
          ]
        )
      }
      if (theme === 'auto') {
        return h(
          'svg',
          {
            class: 'theme-icon',
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            'aria-hidden': 'true',
          },
          [
            h('path', {
              fill: 'currentColor',
              d: 'M12 2a10 10 0 1 0 0 20V2z',
            }),
            h('circle', {
              cx: '12',
              cy: '12',
              r: '9',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '1.6',
            }),
          ]
        )
      }
      return h(
        'svg',
        {
          class: 'theme-icon',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': 'true',
        },
        [
          h('circle', { cx: '12', cy: '12', r: '4.5', fill: 'currentColor' }),
          h('path', {
            d: 'M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.8',
            'stroke-linecap': 'round',
          }),
        ]
      )
    }

    const libraryMode = isTauri()

    const resolveExampleName = () => {
      const id = props.selectedExample
      if (!id) return '选择曲谱'
      if (libraryMode) return scoreFileLabel(id)
      const root = props.rootExamples.find((item) => item.id === id)
      if (root) return root.name
      for (const album of props.albumGroups) {
        const song = album.songs.find((item) => item.id === id)
        if (song) return song.name
      }
      return '选择曲谱'
    }

    const paperLabel = () =>
      Object.values(DISPLAY_SIZES).find((paper) => paper.id === props.paperSize)
        ?.label || props.paperSize

    const lineBreakLabel = () => {
      if (props.lineBreak === 'auto') return '自动'
      if (props.lineBreak === 'musicxml') return '原谱换行'
      return `每行${props.lineBreak}小节`
    }

    const selectMenuEvents = {
      onOpen: () => emit('select-menu-open'),
      onClose: () => emit('select-menu-close'),
    }

    const fontSizeDotsVisible = ref(false)
    let fontSizeDotsTimer = 0
    let fontTapFromTouch = false

    const revealFontSizeDots = () => {
      fontSizeDotsVisible.value = true
      window.clearTimeout(fontSizeDotsTimer)
      fontSizeDotsTimer = window.setTimeout(() => {
        fontSizeDotsVisible.value = false
        fontSizeDotsTimer = 0
      }, 2000)
    }

    const stepScoreFontSize = (delta) => {
      revealFontSizeDots()
      emit('font-size-step', delta)
    }

    const onFontSizeClick = (delta) => () => {
      if (fontTapFromTouch) {
        fontTapFromTouch = false
        return
      }
      stepScoreFontSize(delta)
    }

    const onFontSizeTouchEnd = (delta) => (e) => {
      if (e.cancelable) e.preventDefault()
      fontTapFromTouch = true
      stepScoreFontSize(delta)
      armPageZoomBlock()
      window.setTimeout(() => {
        fontTapFromTouch = false
      }, 500)
    }

    onBeforeUnmount(() => {
      window.clearTimeout(fontSizeDotsTimer)
      clearPageZoomBlock()
    })

    return () => {
      const stacked = props.layout === 'stack'
      const showStart = props.group !== 'end'
      const showEnd = props.group !== 'start'
      const scoreIconPath =
        'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
      const albumIconPath =
        'M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z'
      const exampleOptions = libraryMode
        ? [
            { value: '', label: '请选择曲谱', disabled: true },
            ...buildScoreTree(props.scoreFiles).map((item) => ({
              ...item,
              icon: item.group ? albumIconPath : scoreIconPath,
            })),
          ]
        : [
            { value: '', label: '请选择曲谱', disabled: true },
            ...props.rootExamples.map((item) => ({
              value: item.id,
              label: item.name,
              icon: scoreIconPath,
            })),
          ]
      if (!libraryMode) {
        for (const album of props.albumGroups) {
          exampleOptions.push({
            value: `__album__${album.name}`,
            label: album.name,
            group: true,
            icon: albumIconPath,
          })
          for (const item of album.songs) {
            exampleOptions.push({
              value: item.id,
              label: item.name,
              icon: scoreIconPath,
              indent: 1,
            })
          }
        }
      }

      const exampleSelect = () =>
        h(
          AppSelect,
          {
            modelValue: props.selectedExample,
            options: exampleOptions,
            label: resolveExampleName(),
            ariaLabel: libraryMode ? '曲谱' : '内置示例',
            variant: 'row',
            showCaret: false,
            nowrap: true,
            beforeOpen: libraryMode ? props.beforeScoreMenu : null,
            ...selectMenuEvents,
            'onUpdate:modelValue': (value) => {
              emit('update:selectedExample', value)
              emit('example-change')
            },
          },
          {
            trailing: () => menuIcon(scoreIconPath),
          }
        )

      const uploadChip = (extraClass) => {
        const label = h('span', { class: 'menu-row-label' }, '上传曲谱')
        const icon = menuIcon(
          'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V9h5.5'
        )
        if (isTauri()) {
          return h(
            'button',
            {
              type: 'button',
              class: extraClass,
              onClick: () => emit('native-file-open'),
            },
            [label, icon]
          )
        }
        return h('label', { class: extraClass }, [
          label,
          icon,
          h('input', {
            type: 'file',
            class: 'menu-row-overlay file-input',
            accept: fileAccept,
            'aria-label': '上传曲谱',
            onChange: (e) => emit('file-change', e),
          }),
        ])
      }

      const paperSizeOptions = [
        { value: '', label: '请选择纸张大小', disabled: true },
        ...Object.values(DISPLAY_SIZES).map((paper) => ({
          value: paper.id,
          label: paper.optionLabel,
        })),
      ]
      const paperChip = h(AppSelect, {
        class: 'control-chip--paper',
        modelValue: props.paperSize,
        options: paperSizeOptions,
        label: paperLabel(),
        ariaLabel: '纸张大小',
        variant: 'chip',
        nowrap: true,
        ...selectMenuEvents,
        'onUpdate:modelValue': (value) => emit('update:paperSize', value),
      })

      const lineBreakOptions = [
        { value: '', label: '请选择换行方式', disabled: true },
        { value: 'auto', label: '自动（按纸宽估算每行小节数）' },
        { value: 'musicxml', label: '原谱换行' },
        ...['2', '3', '4', '5', '6'].map((n) => ({
          value: n,
          label: `每行${n}小节`,
        })),
      ]
      const lineBreakChip = h(AppSelect, {
        class: 'control-chip--linebreak',
        modelValue: props.lineBreak,
        options: lineBreakOptions,
        label: lineBreakLabel(),
        ariaLabel: '换行',
        variant: 'chip',
        nowrap: true,
        ...selectMenuEvents,
        'onUpdate:modelValue': (value) => emit('update:lineBreak', value),
      })

      const exportIcon = props.exporting
        ? h(
            'svg',
            {
              class: 'export-spinner',
              viewBox: '0 0 24 24',
              width: '18',
              height: '18',
              'aria-hidden': 'true',
            },
            [
              h('circle', {
                cx: '12',
                cy: '12',
                r: '9',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2.5',
                'stroke-linecap': 'round',
                'stroke-dasharray': '14 42',
              }),
            ]
          )
        : h(
            'svg',
            {
              class: 'export-icon',
              viewBox: '0 0 24 24',
              width: '18',
              height: '18',
              'aria-hidden': 'true',
            },
            [
              h('path', {
                fill: 'currentColor',
                d: 'M5 20h14v-2H5v2zm7-16v10.17l3.59-3.58L17 12l-5 5-5-5 1.41-1.41L11 14.17V4h2z',
              }),
            ]
          )

      const exportNode = h(
        'button',
        {
          type: 'button',
          class: ['btn', 'btn--icon', props.exporting ? 'btn--icon--busy' : ''],
          disabled: !props.currentXml || props.exporting,
          title: '导出 PDF',
          'aria-label': props.exporting ? '导出中' : '导出 PDF',
          onClick: () => emit('export-pdf'),
        },
        [exportIcon]
      )

      const actionsSeg = h('div', { class: 'menu-seg menu-seg--actions' }, [
        h('div', { class: 'toolbar-actions-row' }, [
          paperChip,
          lineBreakChip,
          exportNode,
        ]),
      ])
      const appearanceSeg = h('div', { class: 'toolbar-appearance-block' }, [
        h(
          'div',
          { class: 'menu-seg menu-seg--actions menu-seg--appearance' },
          [
            h('div', { class: 'toolbar-appearance-row' }, [
              h(
                'button',
                {
                  type: 'button',
                  class: 'control-font-btn control-font-btn--small',
                  disabled: props.scoreFontSize <= SCORE_FONT_SIZE_MIN,
                  title: '缩小字号',
                  'aria-label': `缩小字号，当前 ${props.scoreFontSize}`,
                  onClick: onFontSizeClick(-1),
                  onTouchend: onFontSizeTouchEnd(-1),
                  onDblclick: (e) => e.preventDefault(),
                },
                '小'
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'control-font-btn control-font-btn--large',
                  disabled: props.scoreFontSize >= SCORE_FONT_SIZE_MAX,
                  title: '增大字号',
                  'aria-label': `增大字号，当前 ${props.scoreFontSize}`,
                  onClick: onFontSizeClick(1),
                  onTouchend: onFontSizeTouchEnd(1),
                  onDblclick: (e) => e.preventDefault(),
                },
                '大'
              ),
              h(AppSelect, {
                class: 'control-chip--theme',
                modelValue: props.theme,
                options: [
                  { value: 'auto', label: '自动' },
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' },
                ],
                label: '',
                ariaLabel: '主题',
                variant: 'chip',
                showCaret: false,
                nowrap: true,
                ...selectMenuEvents,
                'onUpdate:modelValue': (value) => emit('update:theme', value),
              }, {
                leading: () => themeIcon(props.theme),
              }),
            ]),
          ]
        ),
        h(
          'div',
          {
            class: [
              'font-size-dots-row',
              fontSizeDotsVisible.value ? 'font-size-dots-row--visible' : '',
            ],
          },
          [
          h(
            'div',
            { class: 'font-size-dots', 'aria-hidden': 'true' },
            SCORE_FONT_SIZE_LEVELS.map((size) =>
              h('span', {
                class: [
                  'font-size-dot',
                  size <= props.scoreFontSize ? 'font-size-dot--on' : '',
                ],
              })
            )
          ),
          h('div', { class: 'font-size-dots-spacer', 'aria-hidden': 'true' }),
        ]),
      ])
      const exampleSeg = h('div', { class: 'menu-seg menu-seg--example' }, [
        exampleSelect(),
      ])
      const uploadSeg = h('div', { class: 'menu-seg menu-seg--light' }, [
        uploadChip('menu-row'),
      ])
      const notationSeg = h(
        'div',
        { class: 'menu-seg menu-seg--actions menu-seg--notation' },
        [
          h(NotationSwitch, {
            modelValue: props.notationMode,
            stacked: true,
            'onUpdate:modelValue': (value) => emit('update:notationMode', value),
          }),
        ]
      )

      if (stacked) {
        return h(
          'div',
          { class: 'toolbar-controls toolbar-controls--stack' },
          [
            ...(showStart ? [exampleSeg, uploadSeg, notationSeg] : []),
            ...(showEnd ? [appearanceSeg, actionsSeg] : []),
          ]
        )
      }

      return h(
        'div',
        { class: 'toolbar-controls toolbar-controls--row' },
        [
          ...(showStart ? [uploadSeg, exampleSeg] : []),
          ...(showEnd ? [appearanceSeg, actionsSeg] : []),
        ]
      )
    }
  },
})
</script>

<style scoped>
.toolbar-controls {
  display: flex;
  align-items: center;
}

.toolbar-controls--row {
  flex-wrap: nowrap;
}

.toolbar-controls--row > * + * {
  margin-left: var(--menu-gap);
}

.toolbar-controls--row .menu-seg--example,
.toolbar-controls--row .menu-seg--light,
.toolbar-controls--row .menu-seg--actions {
  flex: 0 0 auto;
}

.toolbar-controls--row .menu-seg--actions {
  min-width: var(--menu-width);
}

.toolbar-controls--row .menu-seg--appearance {
  min-width: 0;
}

.toolbar-controls--row .toolbar-appearance-block {
  flex: 0 0 auto;
}

.toolbar-controls--stack {
  flex-direction: column;
  align-items: stretch;
}

.toolbar-controls--stack > * + * {
  margin-top: var(--menu-gap);
}

.menu-seg {
  border-radius: var(--menu-radius);
  overflow: hidden;
  box-shadow: var(--shadow-overlay);
}

.menu-seg--dark {
  background: var(--color-menu-dark-bg);
  color: var(--color-menu-dark-text);
}

.menu-seg--example {
  background: var(--color-menu-current-bg);
  color: var(--color-menu-current-text);
}

.menu-seg--example .menu-row:hover,
.menu-seg--example button.menu-row:hover {
  background: transparent;
}

.menu-seg--light,
.menu-seg--actions {
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
}

.menu-row,
.control-chip {
  position: relative;
  display: flex;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-menu);
  color: inherit;
  cursor: pointer;
}

.menu-row {
  justify-content: space-between;
  min-height: var(--menu-row-height);
  padding: 0 14px;
}

.menu-row:hover {
  background: var(--color-menu-divider);
}

button.menu-row {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  font: inherit;
  font-size: var(--font-size-menu);
  line-height: inherit;
  text-align: inherit;
  -webkit-appearance: none;
  appearance: none;
  touch-action: manipulation;
}

button.menu-row:hover {
  background: var(--color-menu-divider);
}

.menu-row > * + * {
  margin-left: 12px;
}

.control-chip {
  justify-content: center;
  min-height: var(--menu-row-height);
  padding: 0 12px;
  touch-action: manipulation;
}

.control-chip > * + * {
  margin-left: 4px;
}

.menu-row-label,
.control-chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

.toolbar-controls--row .menu-seg--example .menu-row-label,
.toolbar-controls--row .menu-seg--example .control-chip-text {
  max-width: 12em;
}

.menu-row-icon,
.control-chip-caret {
  flex-shrink: 0;
  display: block;
}

.control-chip-caret {
  display: block;
}

.file-input {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 16px;
}

.toolbar-actions-row {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: var(--menu-row-height);
}

.toolbar-actions-row > * {
  position: relative;
  min-width: 0;
}

.toolbar-actions-row .control-chip--paper,
.toolbar-actions-row .control-chip--linebreak,
.toolbar-actions-row .btn {
  min-width: 0;
  width: auto;
}

.toolbar-actions-row .control-chip--paper {
  flex: 3 1 0;
  padding: 0 6px;
}

.toolbar-actions-row .control-chip--linebreak {
  flex: 4 1 0;
  padding: 0 6px;
}

.toolbar-actions-row > * + *::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--color-border);
  pointer-events: none;
  z-index: 1;
}

.toolbar-actions-row .btn {
  box-sizing: border-box;
  flex: 3 1 0;
  height: var(--menu-row-height);
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
}

.toolbar-actions-row .btn:hover:not(:disabled),
.control-chip:hover {
  background: var(--color-menu-divider);
}

.toolbar-actions-row .btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.export-icon {
  display: block;
}

.export-spinner {
  display: block;
  animation: export-spin 0.8s linear infinite;
}

@keyframes export-spin {
  to {
    transform: rotate(360deg);
  }
}

.toolbar-appearance-row {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: var(--menu-row-height);
}

.toolbar-appearance-row > * {
  position: relative;
  min-width: 0;
}

.toolbar-appearance-block {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
}

.control-font-btn {
  box-sizing: border-box;
  position: relative;
  min-width: 0;
  width: auto;
  height: var(--menu-row-height);
  margin: 0;
  padding: 0 6px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-menu);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
}

.control-font-btn--small {
  flex: 3 1 0;
}

.control-font-btn--large {
  flex: 4 1 0;
}

.control-font-btn:hover:not(:disabled) {
  background: var(--color-menu-divider);
}

.control-font-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.font-size-dots-row {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  z-index: 3;
  display: flex;
  align-items: center;
  width: 100%;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}

.font-size-dots-row--visible {
  opacity: 1;
  visibility: visible;
}

.font-size-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 7 1 0;
  min-width: 0;
}

.font-size-dot + .font-size-dot {
  margin-left: 5px;
}

.font-size-dots-spacer {
  flex: 3 1 0;
  min-width: 0;
}

.font-size-dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.22;
}

.font-size-dot--on {
  opacity: 1;
}

.control-chip--theme {
  flex: 3 1 0;
  width: auto;
  padding: 0;
  justify-content: center;
}

.toolbar-appearance-row > * + *::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--color-border);
  pointer-events: none;
  z-index: 1;
}

.theme-icon {
  display: block;
}

/* PC：小/大仍是一组，主题单独一格，避免撑成整行 320 */
.toolbar-controls--row .control-font-btn--small,
.toolbar-controls--row .control-font-btn--large {
  flex: 0 0 auto;
  padding: 0 12px;
}

.toolbar-controls--row .control-chip--theme {
  flex: 0 0 44px;
  width: 44px;
}

.toolbar-controls--row .control-font-btn--large::before {
  display: none;
}

.toolbar-controls--row .font-size-dots-row {
  right: 44px;
}

.toolbar-controls--row .font-size-dots {
  flex: 1 1 auto;
}

.toolbar-controls--row .font-size-dots-spacer {
  display: none;
}
</style>
