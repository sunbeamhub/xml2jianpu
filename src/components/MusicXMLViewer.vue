<template>
  <div class="page-wrap" ref="pageEl" :style="pageWrapStyle" @click="onPageClick">
    <header
      class="score-header"
      ref="headerEl"
      @mouseenter="onHeaderEnter"
      @mouseleave="onHeaderLeave"
    >
      <div
        class="score-title"
        role="heading"
        aria-level="1"
      >
        {{ currentTitle }}
      </div>

      <div
        v-if="isDesktop"
        class="header-actions header-actions--start"
        :style="headerStartActionsStyle"
      >
        <div
          v-show="headerHovered || transposeOpen"
          class="transpose-anchor"
          @click.stop
        >
          <button
            type="button"
            class="menu-btn"
            :class="{ 'menu-btn--active': transposeDirty }"
            :aria-expanded="transposeOpen"
            aria-label="固定调移调"
            @click="toggleTranspose"
          >
            <TransposeIcon />
          </button>
          <div
            v-if="transposeOpen"
            class="toolbar-panel toolbar-panel--sheet toolbar-panel--sheet-start toolbar-panel--transpose"
          >
            <TransposePanel
              :original-key-name="originalKeyName"
              :transpose-semitones="fixedDo ? transposeSemitones : 0"
              :fixed-do="fixedDo"
              @set="setTranspose"
              @reset="resetTranspose"
            />
          </div>
        </div>
        <!-- PC 左侧：上传 + 内置示例 -->
        <div v-show="headerHovered || headerMenuOpen" class="toolbar-inline">
          <ScoreToolbarControls
            group="start"
            :root-examples="rootExamples"
            :album-groups="albumGroups"
            :selected-example="selectedExample"
            :line-break="lineBreak"
            :paper-size="paperSize"
            :score-font-size="scoreFontSize"
            :theme="theme"
            :current-xml="currentXml"
            :exporting="exporting"
            @update:selected-example="onSelectedExampleUpdate"
            @update:line-break="onLineBreakUpdate"
            @update:paper-size="onPaperSizeUpdate"
            @update:theme="onThemeUpdate"
            @font-size-step="onFontSizeStep"
            @example-change="onExampleChange"
            @file-change="onFileChange"
            @native-file-open="onNativeFileOpen"
            @export-pdf="onExportPdf"
            @select-menu-open="onSelectMenuOpen"
            @select-menu-close="onSelectMenuClose"
          />
        </div>
      </div>

      <div
        v-if="isDesktop"
        class="header-actions header-actions--end"
        :style="headerActionsStyle"
      >
        <!-- PC 右侧：字号/主题 + 纸张、换行、导出 -->
        <div v-show="headerHovered || headerMenuOpen" class="toolbar-inline">
          <ScoreToolbarControls
            group="end"
            :root-examples="rootExamples"
            :album-groups="albumGroups"
            :selected-example="selectedExample"
            :line-break="lineBreak"
            :paper-size="paperSize"
            :score-font-size="scoreFontSize"
            :theme="theme"
            :current-xml="currentXml"
            :exporting="exporting"
            @update:selected-example="onSelectedExampleUpdate"
            @update:line-break="onLineBreakUpdate"
            @update:paper-size="onPaperSizeUpdate"
            @update:theme="onThemeUpdate"
            @font-size-step="onFontSizeStep"
            @example-change="onExampleChange"
            @file-change="onFileChange"
            @native-file-open="onNativeFileOpen"
            @export-pdf="onExportPdf"
            @select-menu-open="onSelectMenuOpen"
            @select-menu-close="onSelectMenuClose"
          />
        </div>
      </div>
    </header>

    <!-- 按屏宽缩放 + 双指捏合；放大后拖动平移 -->
    <div
      class="canvas-wrap"
      ref="viewport"
      :style="wrapStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="canvas-spacer" :style="spacerStyle">
        <div class="canvas-stage" :style="stageStyle">
          <div
            v-if="scoreMeta"
            ref="metaEl"
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
          <svg ref="svg" class="score-svg"></svg>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="!isDesktop"
      class="menu-anchor menu-anchor--fixed menu-anchor--start"
      :class="{ 'menu-anchor--visible': fabVisible || sheetOpen || transposeOpen }"
      @click.stop
    >
      <div
        v-if="transposeOpen"
        class="toolbar-panel toolbar-panel--sheet toolbar-panel--sheet-start toolbar-panel--transpose"
      >
        <TransposePanel
          :original-key-name="originalKeyName"
          :transpose-semitones="fixedDo ? transposeSemitones : 0"
          :fixed-do="fixedDo"
          @set="setTranspose"
          @reset="resetTranspose"
        />
      </div>
      <button
        type="button"
        class="menu-btn"
        :class="{ 'menu-btn--active': transposeDirty }"
        :aria-expanded="transposeOpen"
        aria-label="固定调移调"
        @click="toggleTranspose"
      >
        <TransposeIcon />
      </button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="!isDesktop"
      class="menu-anchor menu-anchor--fixed"
      :class="{ 'menu-anchor--visible': fabVisible || sheetOpen || transposeOpen }"
      @click.stop
    >
      <div v-if="sheetOpen" class="toolbar-panel toolbar-panel--sheet">
        <ScoreToolbarControls
          layout="stack"
          :root-examples="rootExamples"
          :album-groups="albumGroups"
          :selected-example="selectedExample"
          :line-break="lineBreak"
          :paper-size="paperSize"
          :score-font-size="scoreFontSize"
          :theme="theme"
          :current-xml="currentXml"
          :exporting="exporting"
          @update:selected-example="onSelectedExampleUpdate"
          @update:line-break="onLineBreakUpdate"
          @update:paper-size="onPaperSizeUpdate"
          @update:theme="onThemeUpdate"
          @font-size-step="onFontSizeStep"
          @example-change="onExampleChange"
          @file-change="onFileChange"
          @native-file-open="onNativeFileOpen"
          @export-pdf="onExportPdf"
        />
      </div>
      <button
        type="button"
        class="menu-btn"
        :aria-expanded="sheetOpen"
        aria-label="打开功能菜单"
        @click="toggleSheet"
      >
        <svg
          class="menu-icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M4 7h16v2H4V7zm0 4h16v2H4v-2zm0 4h16v2H4v-2z"
          />
        </svg>
      </button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="exportPaperDialogOpen"
      class="export-paper-overlay"
      role="presentation"
      @click.self="cancelExportPaperDialog"
    >
      <div
        class="export-paper-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-paper-title"
        aria-describedby="export-paper-hint"
      >
        <h2 id="export-paper-title" class="export-paper-title">导出 PDF</h2>
        <p id="export-paper-hint" class="export-paper-hint">
          当前按设备尺寸预览，导出必须选择 A3 或 A4。
        </p>
        <div v-if="needsManualSaveGuide" class="export-paper-guide">
          <p class="export-paper-guide-title">这台系统无法直接下载，请按下面步骤保存：</p>
          <ol>
            <li>选择纸张后会打开 PDF 预览</li>
            <li>点屏幕顶部的分享按钮（方框加向上箭头）</li>
            <li>选择「存储到文件」，再选保存位置</li>
          </ol>
        </div>
        <div class="export-paper-actions">
          <button
            v-for="paper in exportPaperOptions"
            :key="paper.id"
            type="button"
            class="export-paper-btn"
            :class="{ 'export-paper-btn--last': paper.id === lastExportPaperSize }"
            :disabled="exporting"
            @click="confirmExportPaper(paper.id)"
          >
            {{ paper.optionLabel }}
          </button>
          <button
            type="button"
            class="export-paper-btn export-paper-btn--ghost"
            :disabled="exporting"
            @click="cancelExportPaperDialog"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="legacyPdfGuideOpen"
      class="export-paper-overlay"
      role="presentation"
      @click.self="cancelLegacyPdfGuide"
    >
      <div
        class="export-paper-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-pdf-guide-title"
      >
        <h2 id="legacy-pdf-guide-title" class="export-paper-title">导出 PDF</h2>
        <div class="export-paper-guide">
          <p class="export-paper-guide-title">这台系统无法直接下载，请按下面步骤保存：</p>
          <ol>
            <li>点「开始导出」后会打开 PDF 预览</li>
            <li>点屏幕顶部的分享按钮（方框加向上箭头）</li>
            <li>选择「存储到文件」，再选保存位置</li>
          </ol>
        </div>
        <div class="export-paper-actions">
          <button
            type="button"
            class="export-paper-btn export-paper-btn--last"
            :disabled="exporting"
            @click="confirmLegacyPdfGuide"
          >
            开始导出
          </button>
          <button
            type="button"
            class="export-paper-btn export-paper-btn--ghost"
            :disabled="exporting"
            @click="cancelLegacyPdfGuide"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  nextTick,
  defineComponent,
  h,
} from 'vue'
import initApp, { applyFirstColumnHeaderH } from './MusicXMLViewer.js'
import { exportPdf } from '../utils/exportPdf.js'
import { openMusicXmlFile } from '../utils/nativeFile.js'
import { isTauri } from '../utils/platform.js'
import {
  needsManualSaveGuide as checkNeedsManualSaveGuide,
  needsPdfPopupGuard,
  openPdfPopupGuard,
} from '../utils/savePdf.js'
import { ensureScoreFont } from '../utils/scoreFont.js'
import {
  SCORE_FONT_SIZE_DEFAULT,
  SCORE_FONT_SIZE_MIN,
  SCORE_FONT_SIZE_MAX,
  SCORE_FONT_SIZE_LEVELS,
  clampScoreFontSize,
} from '../utils/scoreMetrics.js'
import {
  THEME_VALUES,
  applyTheme,
  bindSchemeListenersWhenReady,
  onThemeSchemeApplied,
  persistTheme,
  readStoredTheme,
} from '../utils/theme.js'
import {
  bindTauriWindowResized,
  unbindTauriWindowListeners,
} from '../utils/tauriWindow.js'
import {
  DEFAULT_PAPER_SIZE,
  DEFAULT_EXPORT_PAPER_SIZE,
  DISPLAY_SIZES,
  PAPER_SIZES,
  SCORE_PAD_X,
  getPageLayout,
  isDevicePaperSize,
  isExportPaperSize,
} from '../utils/pageLayout.js'
import AppSelect from './AppSelect.vue'

/**
 * iOS 12 不支持 touch-action: manipulation，双击按钮会缩放页面。
 * 点击后 400ms 内拦截后续 touchend，避免双击缩放，同时按钮自己的 touchend 仍能连点。
 */
let pageZoomBlockTimer = 0
let pageZoomBlockHandler = null

function clearPageZoomBlock() {
  window.clearTimeout(pageZoomBlockTimer)
  pageZoomBlockTimer = 0
  if (pageZoomBlockHandler) {
    document.removeEventListener('touchend', pageZoomBlockHandler, true)
    pageZoomBlockHandler = null
  }
}

function armPageZoomBlock() {
  if (!pageZoomBlockHandler) {
    pageZoomBlockHandler = (e) => {
      if (e.cancelable) e.preventDefault()
    }
    document.addEventListener('touchend', pageZoomBlockHandler, {
      capture: true,
      passive: false,
    })
  }
  window.clearTimeout(pageZoomBlockTimer)
  pageZoomBlockTimer = window.setTimeout(clearPageZoomBlock, 400)
}

/** 可复用功能区（上传 / 示例 / 纸张 / 换行 / 导出） */
const ScoreToolbarControls = defineComponent({
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
  },
  emits: [
    'update:selectedExample',
    'update:lineBreak',
    'update:paperSize',
    'update:theme',
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

    const resolveExampleName = () => {
      const id = props.selectedExample
      if (!id) return '选择曲谱'
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
      const exampleOptions = [
        { value: '', label: '请选择曲谱', disabled: true },
        ...props.rootExamples.map((item) => ({
          value: item.id,
          label: item.name,
          icon: scoreIconPath,
        })),
      ]
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

      const exampleSelect = () =>
        h(
          AppSelect,
          {
            modelValue: props.selectedExample,
            options: exampleOptions,
            label: resolveExampleName(),
            ariaLabel: '内置示例',
            variant: 'row',
            showCaret: false,
            nowrap: true,
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

      const exportNode = h(
        'button',
        {
          type: 'button',
          class: 'btn btn--icon',
          disabled: !props.currentXml || props.exporting,
          title: '导出 PDF',
          'aria-label': props.exporting ? '导出中' : '导出 PDF',
          onClick: () => emit('export-pdf'),
        },
        [
          h(
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
          ),
        ]
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

      if (stacked) {
        return h(
          'div',
          { class: 'toolbar-controls toolbar-controls--stack' },
          [
            ...(showStart ? [exampleSeg, uploadSeg] : []),
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

const TRANSPOSE_LIMIT = 12

function formatOffsetLabel(n) {
  if (n > 0) return `+${n} 半音`
  if (n < 0) return `${n} 半音`
  return '0 半音'
}

function splitKeyName(name) {
  const n = name || 'C'
  if (n.startsWith('b') || n.startsWith('#')) {
    return { accidental: n[0], letter: n.slice(1) }
  }
  return { accidental: '', letter: n }
}

function keyInline(name) {
  const { accidental, letter } = splitKeyName(name)
  return [
    '1=',
    accidental
      ? h('span', { class: 'transpose-accidental' }, accidental)
      : null,
    letter,
  ]
}

const TransposeIcon = defineComponent({
  name: 'TransposeIcon',
  setup() {
    return () =>
      h(
        'svg',
        {
          class: 'menu-icon',
          viewBox: '0 0 24 24',
          width: 22,
          height: 22,
          'aria-hidden': 'true',
        },
        [
          h('path', {
            fill: 'currentColor',
            d: 'M4 4h16v2H4V4zm0 7h16v2H4v-2zm0 7h16v2H4v-2z',
          }),
          h('path', {
            d: 'M9.5 9.3 12 6.8l2.5 2.5',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.7,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
          h('path', {
            d: 'M9.5 14.7 12 17.2l2.5-2.5',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.7,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        ]
      )
  },
})

const TransposePanel = defineComponent({
  name: 'TransposePanel',
  props: {
    originalKeyName: { type: String, default: 'C' },
    transposeSemitones: { type: Number, default: 0 },
    fixedDo: { type: Boolean, default: false },
  },
  emits: ['set', 'reset'],
  setup(props, { emit }) {
    const sliderDraft = ref(null)
    let flushTimer = 0
    let pending = null

    const displayedN = () =>
      sliderDraft.value != null
        ? sliderDraft.value
        : props.fixedDo
          ? props.transposeSemitones
          : 0

    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = 0
      }
      if (pending == null) return
      const n = pending
      pending = null
      sliderDraft.value = null
      emit('set', n)
    }

    const commit = (value, immediate) => {
      const n = Math.max(
        -TRANSPOSE_LIMIT,
        Math.min(TRANSPOSE_LIMIT, Math.round(Number(value) || 0))
      )
      sliderDraft.value = n
      pending = n
      if (immediate) {
        flush()
        return
      }
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = window.setTimeout(flush, 280)
    }

    onBeforeUnmount(flush)

    let tapFromTouch = false
    const bindTap = (handler, isDisabled) => ({
      onClick: () => {
        if (isDisabled) return
        if (tapFromTouch) {
          tapFromTouch = false
          return
        }
        handler()
      },
      onTouchend: (e) => {
        if (e.cancelable) e.preventDefault()
        armPageZoomBlock()
        if (isDisabled) return
        tapFromTouch = true
        handler()
        window.setTimeout(() => {
          tapFromTouch = false
        }, 500)
      },
      onDblclick: (e) => e.preventDefault(),
    })

    return () => {
      const n = displayedN()
      const atMin = n <= -TRANSPOSE_LIMIT
      const atMax = n >= TRANSPOSE_LIMIT
      const dragging = sliderDraft.value != null
      const currentKey = dragging || props.fixedDo ? 'C' : props.originalKeyName
      const canReset =
        n !== 0 || (props.fixedDo && props.originalKeyName !== 'C')
      const roundGlyph = (kind) =>
        h(
          'svg',
          {
            class: 'transpose-round-icon',
            viewBox: '0 0 24 24',
            width: 18,
            height: 18,
            'aria-hidden': 'true',
          },
          [
            h('path', {
              d: kind === 'plus' ? 'M12 5v14M5 12h14' : 'M5 12h14',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': 2,
              'stroke-linecap': 'round',
            }),
          ]
        )
      const roundBtn = (kind, aria, next, disabled) =>
        h(
          'button',
          {
            type: 'button',
            class: 'transpose-round',
            'aria-label': aria,
            disabled,
            ...bindTap(() => commit(next, true), disabled),
          },
          [roundGlyph(kind)]
        )
      return h('div', { class: 'transpose-panel' }, [
        h('div', { class: 'transpose-panel-head' }, [
          h('div', { class: 'transpose-panel-title' }, '移调'),
          h(
            'button',
            {
              type: 'button',
              class: 'transpose-reset',
              disabled: !canReset,
              ...bindTap(() => {
                if (flushTimer) {
                  clearTimeout(flushTimer)
                  flushTimer = 0
                }
                pending = null
                sliderDraft.value = null
                emit('reset')
              }, !canReset),
            },
            '还原'
          ),
        ]),
        h('div', { class: 'transpose-stepper' }, [
          roundBtn('minus', '降低半音', n - 1, atMin),
          h('div', { class: 'transpose-stepper-status' }, [
            h('div', { class: 'transpose-panel-status' }, formatOffsetLabel(n)),
            h('div', { class: 'transpose-panel-current' }, [
              '原曲 ',
              ...keyInline(props.originalKeyName),
              ', 当前 ',
              ...keyInline(currentKey),
            ]),
          ]),
          roundBtn('plus', '升高半音', n + 1, atMax),
        ]),
        h('div', { class: 'transpose-slider-wrap' }, [
          h('input', {
            type: 'range',
            class: 'transpose-slider',
            min: -TRANSPOSE_LIMIT,
            max: TRANSPOSE_LIMIT,
            step: 1,
            value: n,
            'aria-label': '移调半音',
            'aria-valuemin': -TRANSPOSE_LIMIT,
            'aria-valuemax': TRANSPOSE_LIMIT,
            'aria-valuenow': n,
            onInput: (e) => commit(Number(e.target.value), false),
            onChange: (e) => commit(Number(e.target.value), true),
          }),
          h('div', { class: 'transpose-slider-labels' }, [
            h('span', '-1 八度'),
            h('span', '0'),
            h('span', '+1 八度'),
          ]),
        ]),
      ])
    }
  },
})

/**
 * 递归收集 assets 下全部 .musicxml，支持两种路径：
 * - 歌曲.musicxml
 * - 专辑/歌曲.musicxml
 */
const musicxmlModules = import.meta.glob('../assets/**/*.musicxml', {
  eager: true,
  query: '?url',
  import: 'default',
})
const examples = Object.entries(musicxmlModules).map(([key, url]) => {
  const relativePath = key.replace(/^\.\.\/assets\//, '')
  const id = relativePath.replace(/\.musicxml$/i, '')
  const parts = id.split('/')
  const name = parts[parts.length - 1]
  const album = parts.length > 1 ? parts.slice(0, -1).join('/') : null
  return { id, name, album, url }
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

const SELECTED_EXAMPLE_KEY = 'xml2jianpu:selectedExample'
const LINE_BREAK_KEY = 'xml2jianpu:lineBreak'
const LINE_BREAK_VALUES = ['auto', 'musicxml', '2', '3', '4', '5', '6']
const PAPER_SIZE_KEY = 'xml2jianpu:paperSize'
const EXPORT_PAPER_SIZE_KEY = 'xml2jianpu:exportPaperSize'
const PAPER_SIZE_VALUES = Object.keys(DISPLAY_SIZES)
const SCORE_FONT_SIZE_KEY = 'xml2jianpu:scoreFontSize'

function readStoredExampleId() {
  try {
    const id = localStorage.getItem(SELECTED_EXAMPLE_KEY)
    if (id && examples.some((e) => e.id === id)) return id
  } catch {
    /* private mode / unavailable */
  }
  return defaultExampleId
}

function persistSelectedExample(id) {
  if (!id) return
  try {
    localStorage.setItem(SELECTED_EXAMPLE_KEY, id)
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredLineBreak() {
  try {
    const value = localStorage.getItem(LINE_BREAK_KEY)
    if (value && LINE_BREAK_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return 'auto'
}

function persistLineBreak(value) {
  if (!LINE_BREAK_VALUES.includes(value)) return
  try {
    localStorage.setItem(LINE_BREAK_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredPaperSize() {
  try {
    const value = localStorage.getItem(PAPER_SIZE_KEY)
    if (value && PAPER_SIZE_VALUES.includes(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return DEFAULT_PAPER_SIZE
}

function persistPaperSize(value) {
  if (!PAPER_SIZE_VALUES.includes(value)) return
  try {
    localStorage.setItem(PAPER_SIZE_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredExportPaperSize() {
  try {
    const value = localStorage.getItem(EXPORT_PAPER_SIZE_KEY)
    if (value && isExportPaperSize(value)) return value
  } catch {
    /* private mode / unavailable */
  }
  return DEFAULT_EXPORT_PAPER_SIZE
}

function persistExportPaperSize(value) {
  if (!isExportPaperSize(value)) return
  try {
    localStorage.setItem(EXPORT_PAPER_SIZE_KEY, value)
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredScoreFontSize() {
  try {
    const raw = localStorage.getItem(SCORE_FONT_SIZE_KEY)
    if (raw == null || raw === '') return SCORE_FONT_SIZE_DEFAULT
    return clampScoreFontSize(raw)
  } catch {
    /* private mode / unavailable */
  }
  return SCORE_FONT_SIZE_DEFAULT
}

function persistScoreFontSize(value) {
  try {
    localStorage.setItem(SCORE_FONT_SIZE_KEY, String(clampScoreFontSize(value)))
  } catch {
    /* ignore quota / private mode */
  }
}

const svg = ref(null)
const pageEl = ref(null)
const viewport = ref(null)
const headerEl = ref(null)
const metaEl = ref(null)
const currentXml = ref('')
const currentTitle = ref('')
const scoreMeta = ref(null)
const paperSize = ref(readStoredPaperSize())
const scoreFontSize = ref(readStoredScoreFontSize())
const theme = ref(readStoredTheme())
/** 适配宽度时左右留白，避免谱面贴边 */
const FIT_SIDE_PAD = 16

function currentSvgWidth() {
  if (isDevicePaperSize(paperSize.value)) {
    const vw = getViewportWidth()
    return Math.max(120, Math.round(vw - 2 * FIT_SIDE_PAD))
  }
  return getPageLayout(paperSize.value).svgWidth
}

const firstColumnX = ref(0)
const firstColumnW = ref(currentSvgWidth())
const bodyMetaX = ref(0)
const bodyMetaW = ref(currentSvgWidth())
const slotMetaX = ref(0)
const slotMetaW = ref(currentSvgWidth())
const bodyScale = ref(1)
const metaStackMood = ref(false)
const metaStackAuthors = ref(false)
const metaWrapAuthors = ref(false)
const columnCount = ref(1)
const exporting = ref(false)
const exportPaperDialogOpen = ref(false)
const needsManualSaveGuide = checkNeedsManualSaveGuide()
const legacyPdfGuideOpen = ref(false)
const lastExportPaperSize = ref(readStoredExportPaperSize())
const exportPaperOptions = [PAPER_SIZES.a4, PAPER_SIZES.a3]
const selectedExample = ref(readStoredExampleId())
const lineBreak = ref(readStoredLineBreak())

/** 谱面内容像素尺寸（未缩放） */
const contentW = ref(1)
const contentH = ref(1)
/** 刚好铺满容器宽度的缩放 */
const fitScale = ref(1)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
/** 是否仍处于「适配缩放」（未手动放大） */
const atFitScale = ref(true)

const MAX_ZOOM_RATIO = 4
const FIT_EPS = 0.001
/** 单指方向锁定阈值（px） */
const AXIS_LOCK_PX = 8
const FAB_HIDE_MS = 6000
const TAP_MOVE_PX = 10

const isDesktop = ref(false)
const headerHovered = ref(false)
const fabVisible = ref(false)
const sheetOpen = ref(false)
const fixedDo = ref(false)
const transposeSemitones = ref(0)
const transposeOpen = ref(false)
/** 桌面端原生 select 下拉打开时锁定工具栏，避免 mouseleave 收起 */
const headerMenuOpen = ref(false)
/** 指针是否还在标题栏上（桌面 6s 提示结束时，悬停则不收起） */
let headerPointerInside = false
let fabHideTimer = null
let desktopMql = null

/** 捏合中禁用浏览器手势；其余情况保留纵向原生滚动 */
const isPinching = ref(false)
const wrapStyle = computed(() => ({
  touchAction: isPinching.value ? 'none' : 'pan-y',
}))

const pageWrapStyle = computed(() => ({
  ...wrapStyle.value,
  '--font-size-score-meta': `${scoreFontSize.value * bodyScale.value}px`,
}))

const spacerStyle = computed(() => ({
  // 宽度始终跟容器，避免放大后撑出横向页面滚动条
  width: '100%',
  position: 'relative',
  height: `${Math.max(1, contentH.value * scale.value)}px`,
}))

const stageStyle = computed(() => ({
  width: `${contentW.value}px`,
  height: `${contentH.value}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
  cursor: scale.value > fitScale.value + FIT_EPS ? 'grab' : 'default',
}))

const metaStyle = computed(() => {
  const width = `${Math.max(1, firstColumnW.value)}px`
  const left = Math.max(0, firstColumnX.value)
  if (columnCount.value > 1) {
    return {
      width,
      position: 'absolute',
      top: '0',
      left: `${left}px`,
      marginLeft: '0',
    }
  }
  return {
    width,
    marginLeft: `${left}px`,
  }
})

const keyAccidental = computed(() => {
  const name = scoreMeta.value?.keyName || ''
  if (name.startsWith('b') || name.startsWith('#')) return name[0]
  return ''
})

const keyLetter = computed(() => {
  const name = scoreMeta.value?.keyName || ''
  if (name.startsWith('b') || name.startsWith('#')) return name.slice(1)
  return name
})

const originalKeyName = computed(
  () => scoreMeta.value?.originalKeyName || scoreMeta.value?.keyName || 'C'
)

const transposeDirty = computed(() => {
  if (!fixedDo.value) return false
  return originalKeyName.value !== 'C' || transposeSemitones.value !== 0
})

/** 视口宽度（响应式，供标题/功能区对齐） */
const viewportW = ref(1)

/**
 * 功能区贴边：空白大时贴视口（FIT_SIDE_PAD），谱面近满宽时贴正文边缘。
 * 左右共用，避免改一侧漏一侧。
 */
function headerSideInset(insetPx) {
  const vw = viewportW.value || getViewportWidth()
  const inset = Math.max(0, Math.round(insetPx))
  return inset > vw * 0.12 ? FIT_SIDE_PAD : inset
}

const headerActionsStyle = computed(() => {
  const vw = viewportW.value || getViewportWidth()
  const scaledW = contentW.value * scale.value
  const rightInset = vw - (tx.value + scaledW)
  return { right: `${headerSideInset(rightInset)}px` }
})

const headerStartActionsStyle = computed(() => ({
  left: `${headerSideInset(tx.value)}px`,
}))

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function getViewportWidth() {
  return viewport.value?.clientWidth || window.innerWidth || 1
}

function getRenderViewportHeight() {
  const headerH = headerEl.value?.offsetHeight || 56
  const vh = window.innerHeight || document.documentElement.clientHeight || 800
  return Math.max(120, vh - headerH - 24)
}

function syncViewportWidth() {
  viewportW.value = getViewportWidth()
}

function computeFitScale() {
  const vw = getViewportWidth()
  const usable = Math.max(1, vw - 2 * FIT_SIDE_PAD)
  const w = Math.max(1, contentW.value)
  return Math.min(1, usable / w)
}

/** 横向限制在可视区内；纵向交给页面滚动，ty 固定为 0 */
function clampPan(nextTx, _nextTy, nextScale = scale.value) {
  const vw = getViewportWidth()
  const scaledW = contentW.value * nextScale
  let x
  if (scaledW <= vw) {
    x = (vw - scaledW) / 2
  } else {
    x = clamp(nextTx, vw - scaledW, 0)
  }
  return { x, y: 0 }
}

function setScaleAtPoint(nextScale, anchorX) {
  const minS = fitScale.value
  const maxS = fitScale.value * MAX_ZOOM_RATIO
  const s = clamp(nextScale, minS, maxS)
  const contentX = (anchorX - tx.value) / scale.value
  const nextTx = anchorX - contentX * s
  const pan = clampPan(nextTx, 0, s)
  scale.value = s
  tx.value = pan.x
  ty.value = pan.y
  atFitScale.value = Math.abs(s - fitScale.value) < FIT_EPS
}

/** 上次用于适配的容器宽度；忽略由自身高度变化触发的 ResizeObserver */
let lastFitViewportW = 0
let fitRetryTimers = []
/** 上次触发布局重算的视口宽/高（高度用 window 可用高度，避免内容撑高导致死循环） */
let lastRenderViewportW = 0
let lastRenderViewportH = 0
let renderInFlight = false
/** 进行中的渲染结束后要补画的最新选项；全量重排优先于移调快路径 */
let pendingRenderOpts = null
let renderRafId = 0
/** 已测到的调号区高度；多列时传给排版，避免第 1 列与 HTML 重叠 */
let measuredMetaH = 0

function estimateMetaHeight(meta) {
  if (!meta) return 48
  const fs = scoreFontSize.value * bodyScale.value
  const s = fs / 16
  const padTop = 4 * s
  const padBottom = 8 * s
  const rowH = Math.max(22 * s, fs * 1.2)
  const authorCount = meta.authorLines?.length || 0
  const authorH = authorCount
    ? authorCount * fs * 1.3 + Math.max(0, authorCount - 1) * 4 * s
    : 0
  const moodH = meta.tempo || meta.expression ? rowH : 0
  const leftH = moodH ? rowH + 8 * s + moodH : rowH
  return padTop + Math.max(leftH, authorH) + padBottom
}

function resolveFirstColumnHeaderH() {
  if (measuredMetaH > 0) return measuredMetaH
  return estimateMetaHeight(scoreMeta.value)
}

function buildRenderOptions() {
  const desktop = isDesktop.value
  return {
    hideTitle: true,
    hideMeta: true,
    autoColumns: desktop,
    viewportWidth: getViewportWidth(),
    viewportHeight: getRenderViewportHeight(),
    maxColumnWidth: currentSvgWidth(),
    contentPadX: SCORE_PAD_X,
    lineBreak: lineBreak.value,
    fontSize: scoreFontSize.value,
    firstColumnHeaderH: resolveFirstColumnHeaderH(),
    readableLineUnits:
      isDevicePaperSize(paperSize.value) && lineBreak.value === 'auto',
    fixedDo: fixedDo.value,
    transposeSemitones: transposeSemitones.value,
    // 移动端强制单列
    ...(desktop ? {} : { columns: 1 }),
  }
}

function applyFitScale() {
  lastFitViewportW = getViewportWidth()
  syncViewportWidth()
  fitScale.value = computeFitScale()
  scale.value = fitScale.value
  atFitScale.value = true
  const pan = clampPan(0, 0, scale.value)
  tx.value = pan.x
  ty.value = pan.y
}

/** 首次布局宽度未稳（尤其 iOS 12 无 ResizeObserver）时补几次横向适配 */
function scheduleFitScaleRetries() {
  fitRetryTimers.forEach(clearTimeout)
  fitRetryTimers = []
  const run = () => {
    if (atFitScale.value) applyFitScale()
  }
  requestAnimationFrame(run)
  fitRetryTimers.push(setTimeout(run, 80), setTimeout(run, 320))
  if (typeof ResizeObserver === 'undefined') {
    fitRetryTimers.push(setTimeout(run, 800))
  }
}

function updateFitScaleOnResize() {
  if (contentW.value <= 1) return
  const vw = getViewportWidth()
  syncViewportWidth()
  // spacer 高度随 scale 变化会触发 RO；仅宽度变化才重算
  if (Math.abs(vw - lastFitViewportW) < 0.5) return
  lastFitViewportW = vw

  const prevFit = fitScale.value
  const nextFit = computeFitScale()
  fitScale.value = nextFit
  if (atFitScale.value) {
    scale.value = nextFit
    const pan = clampPan(0, 0, scale.value)
    tx.value = pan.x
    ty.value = pan.y
    return
  }
  // 已手动放大：保持相对 fit 的倍率，并夹紧
  const ratio = prevFit > 0 ? scale.value / prevFit : 1
  const s = clamp(nextFit * ratio, nextFit, nextFit * MAX_ZOOM_RATIO)
  scale.value = s
  const pan = clampPan(tx.value, ty.value, s)
  tx.value = pan.x
  ty.value = pan.y
  atFitScale.value = Math.abs(s - nextFit) < FIT_EPS
}

function rememberRenderViewport() {
  lastRenderViewportW = getViewportWidth()
  lastRenderViewportH = getRenderViewportHeight()
  syncViewportWidth()
}

async function fitSvgSize(svgEl, padding = 16) {
  await nextTick()
  const bbox = svgEl.getBBox()
  const attrW = Number(svgEl.getAttribute('width')) || 0
  const attrH = Number(svgEl.getAttribute('height')) || 0
  // 宽度以排版结果为准（纸张列槽×N 硬画布）；勿用 bbox 撑破
  const svgWidth =
    attrW > 1
      ? attrW
      : Math.max(1, Math.ceil(Math.max(0, bbox.x) + bbox.width + padding))
  const svgHeight = Math.max(
    attrH,
    Math.ceil(Math.max(0, bbox.y) + bbox.height + padding)
  )
  svgEl.removeAttribute('viewBox')
  svgEl.setAttribute('width', String(svgWidth || 1))
  svgEl.setAttribute('height', String(svgHeight || 1))
  // 多列：调号区叠在 SVG 上，高度已计入第 1 列偏移
  const metaH =
    columnCount.value > 1 ? 0 : metaEl.value?.offsetHeight || 0
  contentW.value = svgWidth || 1
  contentH.value = metaH + (svgHeight || 1)
  applyFitScale()
}

function applyLayoutResult(result) {
  if (!result) return 1
  currentXml.value = result.xmlString
  currentTitle.value = result.title || ''
  scoreMeta.value = result.meta || null
  bodyMetaX.value = result.layout?.bodyMetaX ?? 0
  bodyMetaW.value = result.layout?.bodyMetaW || currentSvgWidth()
  slotMetaX.value = result.layout?.slotMetaX ?? 0
  slotMetaW.value = result.layout?.slotMetaW || currentSvgWidth()
  const nextBodyScale = Number(result.layout?.bodyScale)
  bodyScale.value =
    Number.isFinite(nextBodyScale) && nextBodyScale > 0 ? nextBodyScale : 1
  metaStackMood.value = false
  metaStackAuthors.value = false
  metaWrapAuthors.value = false
  // 先铺纸张列槽，量完再决定是否改回正文宽
  firstColumnX.value = slotMetaX.value
  firstColumnW.value = slotMetaW.value
  const cols = result.layout?.columns || 1
  columnCount.value = cols
  return cols
}

function metaClusterGap() {
  return Math.round(scoreFontSize.value * bodyScale.value)
}

function clusterMinWidth(el) {
  if (!el) return 0
  const prevWrap = el.style.flexWrap
  const prevWidth = el.style.width
  const prevWhiteSpace = el.style.whiteSpace
  el.style.flexWrap = 'nowrap'
  el.style.width = 'max-content'
  el.style.whiteSpace = 'nowrap'
  const w = Math.ceil(el.scrollWidth)
  el.style.flexWrap = prevWrap
  el.style.width = prevWidth
  el.style.whiteSpace = prevWhiteSpace
  return w
}

function measureMetaNeeded() {
  const root = metaEl.value
  if (!root) return Infinity
  const left = root.querySelector('.score-meta-left')
  const authors = root.querySelector('.score-meta-authors')
  const leftW = clusterMinWidth(left)
  const authorW = clusterMinWidth(authors)
  if (!authorW) return leftW
  if (metaStackAuthors.value) return Math.max(leftW, authorW)
  return leftW + metaClusterGap() + authorW
}

function applyMetaBodyWidth() {
  firstColumnX.value = bodyMetaX.value
  firstColumnW.value = bodyMetaW.value
}

function applyMetaSlotWidth() {
  firstColumnX.value = slotMetaX.value
  firstColumnW.value = slotMetaW.value
}

async function syncMetaWidth() {
  await nextTick()
  metaStackMood.value = false
  metaStackAuthors.value = false
  metaWrapAuthors.value = false
  await nextTick()
  const needed = measureMetaNeeded()
  const bodyW = bodyMetaW.value
  const slotW = slotMetaW.value
  if (needed <= bodyW + 1) {
    applyMetaBodyWidth()
  } else {
    applyMetaSlotWidth()
  }
  if (needed > slotW + 1) {
    applyMetaSlotWidth()
    metaStackMood.value = true
    await nextTick()
    if (measureMetaNeeded() > slotW + 1) {
      metaStackAuthors.value = true
      await nextTick()
      if (measureMetaNeeded() > slotW + 1) {
        metaWrapAuthors.value = true
      }
    }
  }
  await nextTick()
  if (columnCount.value <= 1 && svg.value) {
    const metaH = metaEl.value?.offsetHeight || 0
    const svgH = Number(svg.value.getAttribute('height')) || 1
    contentH.value = metaH + svgH
  }
}

async function syncFirstColumnHeader(usedHeaderH, cols) {
  if (cols <= 1) return
  await nextTick()
  const measured = metaEl.value?.offsetHeight || 0
  if (measured < 1) return
  measuredMetaH = measured
  if (Math.abs(measured - usedHeaderH) <= 1) return
  if (!svg.value) return
  if (applyFirstColumnHeaderH(svg.value, measured)) {
    await fitSvgSize(svg.value)
  }
}

async function renderWithUrl(url) {
  if (!svg.value) return
  await renderScore(url, { preferPitchUpdate: false })
}

async function renderWithXmlString(xmlString, opts = {}) {
  if (!svg.value) return
  await renderScore(xmlString, opts)
}

function mergeRenderOpts(prev, next) {
  const merged = { ...(prev || {}), ...(next || {}) }
  if (prev && prev.preferPitchUpdate === false) {
    merged.preferPitchUpdate = false
  }
  if (next && next.preferPitchUpdate === false) {
    merged.preferPitchUpdate = false
  }
  return merged
}

function scheduleScoreRender(opts = {}) {
  pendingRenderOpts = mergeRenderOpts(pendingRenderOpts, opts)
  if (renderRafId) return
  renderRafId = requestAnimationFrame(() => {
    renderRafId = 0
    const next = pendingRenderOpts
    pendingRenderOpts = null
    void runQueuedRender(next || {})
  })
}

async function runQueuedRender(opts) {
  if (renderInFlight) {
    pendingRenderOpts = mergeRenderOpts(pendingRenderOpts, opts)
    return
  }
  await rerenderCurrent(opts)
}

async function renderScore(source, opts = {}) {
  if (!svg.value) return
  const usedHeaderH = resolveFirstColumnHeaderH()
  let cols = 1
  let skipLayoutSync = false
  renderInFlight = true
  try {
    if (!opts.preferPitchUpdate) {
      await ensureScoreFont()
    }
    const result = await initApp(svg.value, source, {
      ...buildRenderOptions(),
      preferPitchUpdate: !!opts.preferPitchUpdate,
    })
    if (!result) return
    if (result.pitchUpdated) {
      if (result.meta) scoreMeta.value = result.meta
      skipLayoutSync = true
    } else {
      cols = applyLayoutResult(result)
      rememberRenderViewport()
      await fitSvgSize(svg.value)
    }
  } finally {
    renderInFlight = false
  }
  if (!skipLayoutSync) {
    await syncMetaWidth()
    await syncFirstColumnHeader(usedHeaderH, cols)
    scheduleFitScaleRetries()
  }
  if (pendingRenderOpts) {
    const next = pendingRenderOpts
    pendingRenderOpts = null
    scheduleScoreRender(next)
  }
}

async function rerenderCurrent(opts = {}) {
  if (!currentXml.value || !svg.value) return
  if (renderInFlight) {
    pendingRenderOpts = mergeRenderOpts(pendingRenderOpts, opts)
    return
  }
  await renderWithXmlString(currentXml.value, opts)
}

function loadSelectedExample() {
  const item = examples.find((e) => e.id === selectedExample.value)
  if (!item) return
  clearTransposeState()
  renderWithUrl(item.url)
}

function onSelectedExampleUpdate(value) {
  selectedExample.value = value
  persistSelectedExample(value)
}

function onLineBreakUpdate(value) {
  if (!LINE_BREAK_VALUES.includes(value)) return
  lineBreak.value = value
  persistLineBreak(value)
  rerenderCurrent({ preferPitchUpdate: false })
  if (!isDesktop.value) closeSheet()
}

function onPaperSizeUpdate(value) {
  if (!PAPER_SIZE_VALUES.includes(value)) return
  paperSize.value = value
  persistPaperSize(value)
  rerenderCurrent({ preferPitchUpdate: false })
  if (!isDesktop.value) closeSheet()
}

function onFontSizeStep(delta) {
  const next = clampScoreFontSize(scoreFontSize.value + (Number(delta) || 0))
  if (next === scoreFontSize.value) return
  scoreFontSize.value = next
  persistScoreFontSize(next)
  measuredMetaH = 0
  rerenderCurrent({ preferPitchUpdate: false })
}

function onThemeUpdate(value) {
  if (!THEME_VALUES.includes(value)) return
  theme.value = value
  persistTheme(value)
  void applyTheme(value).then(() => {
    rerenderCurrent({ preferPitchUpdate: false })
  })
}

function onExampleChange() {
  if (!selectedExample.value) return
  loadSelectedExample()
  if (!isDesktop.value) closeSheet()
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

async function onNativeFileOpen() {
  try {
    const picked = await openMusicXmlFile()
    if (!picked) return
    selectedExample.value = ''
    clearTransposeState()
    await renderWithXmlString(picked.text)
    if (!isDesktop.value) closeSheet()
  } catch (err) {
    console.error('[upload MusicXML]', err)
    alert(err?.message || '读取文件失败')
  }
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
    clearTransposeState()
    await renderWithXmlString(text)
    if (!isDesktop.value) closeSheet()
  } catch (err) {
    console.error('[upload MusicXML]', err)
    alert(err?.message || '读取文件失败')
  } finally {
    e.target.value = ''
  }
}

async function onExportPdf() {
  if (!currentXml.value || exporting.value) return
  if (!isExportPaperSize(paperSize.value)) {
    exportPaperDialogOpen.value = true
    if (!isDesktop.value) closeSheet()
    return
  }
  if (!isTauri() && needsManualSaveGuide) {
    legacyPdfGuideOpen.value = true
    if (!isDesktop.value) closeSheet()
    return
  }
  await runExportPdf(paperSize.value)
}

async function runExportPdf(size) {
  if (!currentXml.value || exporting.value) return
  const previewWindow =
    !isTauri() && needsPdfPopupGuard() ? openPdfPopupGuard() : null
  exporting.value = true
  try {
    await exportPdf(currentXml.value, {
      title: currentTitle.value,
      lineBreak: lineBreak.value,
      paperSize: size,
      fontSize: scoreFontSize.value,
      fixedDo: fixedDo.value,
      transposeSemitones: transposeSemitones.value,
      previewWindow,
    })
  } catch (err) {
    if (previewWindow && !previewWindow.closed) previewWindow.close()
    console.error('[export PDF]', err)
    alert((err?.message ?? String(err)) || '导出 PDF 失败')
  } finally {
    exporting.value = false
  }
}

function cancelExportPaperDialog() {
  exportPaperDialogOpen.value = false
}

function cancelLegacyPdfGuide() {
  legacyPdfGuideOpen.value = false
}

async function confirmLegacyPdfGuide() {
  if (exporting.value) return
  legacyPdfGuideOpen.value = false
  await runExportPdf(paperSize.value)
}

async function confirmExportPaper(size) {
  if (!isExportPaperSize(size) || exporting.value) return
  persistExportPaperSize(size)
  lastExportPaperSize.value = size
  exportPaperDialogOpen.value = false
  await runExportPdf(size)
}

function onExportPaperDialogKeydown(e) {
  if (e.key !== 'Escape') return
  if (exportPaperDialogOpen.value) {
    e.preventDefault()
    cancelExportPaperDialog()
    return
  }
  if (legacyPdfGuideOpen.value) {
    e.preventDefault()
    cancelLegacyPdfGuide()
    return
  }
  if (transposeOpen.value) {
    e.preventDefault()
    closeTransposePanel()
  }
}

/* ---------- PC / Mobile chrome ---------- */
function syncDesktopFlag() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    isDesktop.value = true
    return
  }
  isDesktop.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

function onHeaderEnter() {
  if (!isDesktop.value) return
  headerPointerInside = true
  headerHovered.value = true
}

function onHeaderLeave() {
  if (!isDesktop.value) return
  headerPointerInside = false
  // 进入页 6s 提示未结束时，移出标题栏也不收起
  if (fabHideTimer) return
  if (transposeOpen.value || headerMenuOpen.value) return
  headerHovered.value = false
}

function onSelectMenuOpen() {
  headerMenuOpen.value = true
  headerHovered.value = true
}

function onSelectMenuClose() {
  headerMenuOpen.value = false
  if (!headerPointerInside && !fabHideTimer && !transposeOpen.value) {
    headerHovered.value = false
  }
}

function clearFabTimer() {
  if (fabHideTimer) {
    clearTimeout(fabHideTimer)
    fabHideTimer = null
  }
}

/** 进入页先露出功能区 6s；之后移动端点空白、桌面端悬停标题栏才会再出现 */
function showFabTemporarily() {
  clearFabTimer()
  if (isDesktop.value) {
    headerHovered.value = true
    fabHideTimer = setTimeout(() => {
      fabHideTimer = null
      if (!headerPointerInside && !headerMenuOpen.value) headerHovered.value = false
    }, FAB_HIDE_MS)
    return
  }
  fabVisible.value = true
  if (sheetOpen.value) return
  fabHideTimer = setTimeout(() => {
    fabVisible.value = false
    fabHideTimer = null
  }, FAB_HIDE_MS)
}

function hideFab() {
  fabVisible.value = false
  clearFabTimer()
}

/** 画布 pointerup 已处理时，忽略随后冒泡的 click，避免显隐互相抵消 */
let skipPageClick = false
let skipPageClickTimer = null

function clearSkipPageClick() {
  skipPageClick = false
  if (skipPageClickTimer) {
    clearTimeout(skipPageClickTimer)
    skipPageClickTimer = null
  }
}

/** Mobile：点空白唤出/收起；点菜单图标与浮窗本身不收起 */
function onMobileOutsideTap() {
  if (isDesktop.value) return
  if (transposeOpen.value) {
    closeTransposePanel()
    return
  }
  if (sheetOpen.value) {
    closeSheet()
    return
  }
  if (fabVisible.value) {
    hideFab()
    return
  }
  showFabTemporarily()
}

function onPageClick() {
  if (skipPageClick) {
    skipPageClick = false
    return
  }
  if (isDesktop.value) {
    if (transposeOpen.value) closeTransposePanel()
    return
  }
  onMobileOutsideTap()
}

function closeSheet() {
  sheetOpen.value = false
  showFabTemporarily()
}

function toggleSheet() {
  if (sheetOpen.value) {
    closeSheet()
    return
  }
  transposeOpen.value = false
  sheetOpen.value = true
  fabVisible.value = true
  clearFabTimer()
}

function closeTransposePanel() {
  if (!transposeOpen.value) return
  transposeOpen.value = false
  if (isDesktop.value) {
    if (!headerPointerInside && !fabHideTimer && !headerMenuOpen.value) {
      headerHovered.value = false
    }
    return
  }
  showFabTemporarily()
}

function toggleTranspose() {
  if (transposeOpen.value) {
    closeTransposePanel()
    return
  }
  sheetOpen.value = false
  transposeOpen.value = true
  if (isDesktop.value) {
    headerHovered.value = true
  } else {
    fabVisible.value = true
    clearFabTimer()
  }
  // 原谱已是 1=C 时只打开面板，不进入固定调，避免无变化却能点「还原」
  if (!fixedDo.value && originalKeyName.value !== 'C') {
    fixedDo.value = true
    transposeSemitones.value = 0
    scheduleScoreRender({ preferPitchUpdate: true })
  }
}

function setTranspose(value) {
  const next = Math.max(
    -TRANSPOSE_LIMIT,
    Math.min(TRANSPOSE_LIMIT, Math.round(Number(value) || 0))
  )
  if (fixedDo.value && next === transposeSemitones.value) return
  if (!fixedDo.value && next === 0) return
  fixedDo.value = true
  transposeSemitones.value = next
  scheduleScoreRender({ preferPitchUpdate: true })
}

function resetTranspose() {
  const changed = fixedDo.value || transposeSemitones.value !== 0
  fixedDo.value = false
  transposeSemitones.value = 0
  if (changed) scheduleScoreRender({ preferPitchUpdate: true })
}

function clearTransposeState() {
  transposeOpen.value = false
  fixedDo.value = false
  transposeSemitones.value = 0
}

/* ---------- 指针：捏合 + 横向拖动（纵向交给页面滚动） ---------- */
const activePointers = new Map()
let pinchStartDist = 0
let pinchStartScale = 1
let panStartX = 0
let panOriginTx = 0
let panDownClientX = 0
let panDownClientY = 0
/** null | 'x' | 'y' — 放大后单指先判定轴向，避免与页面滚动抢手势 */
let panAxis = null
let isPanning = false
/** 用于 Mobile 点击乐谱唤醒 FAB */
let tapStartX = 0
let tapStartY = 0
let tapTracking = false
let tapMoved = false

function viewportPoint(e) {
  const rect = viewport.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function pointerDistance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function pointerMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function capturePointer(e) {
  try {
    e.currentTarget?.setPointerCapture?.(e.pointerId)
  } catch (_) {
    /* ignore */
  }
}

function beginPinchFromTouches(touches) {
  isPanning = false
  panAxis = null
  tapTracking = false
  isPinching.value = true
  atFitScale.value = false
  const a = touches[0]
  const b = touches[1]
  pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
  pinchStartScale = scale.value
}

function pinchAnchorXFromTouches(touches) {
  const rect = viewport.value?.getBoundingClientRect()
  const left = rect?.left || 0
  return (touches[0].clientX + touches[1].clientX) / 2 - left
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    // 非 passive 时才能拦住 iOS 的页面缩放（否则只会放大标题文字）
    e.preventDefault()
    beginPinchFromTouches(e.touches)
  }
}

function onTouchMove(e) {
  if (e.touches.length < 2 || !isPinching.value) return
  e.preventDefault()
  const dist =
    Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    ) || 1
  setScaleAtPoint(
    pinchStartScale * (dist / pinchStartDist),
    pinchAnchorXFromTouches(e.touches),
  )
}

function onTouchEnd(e) {
  if (e.touches.length < 2) {
    pinchStartDist = 0
    isPinching.value = false
  }
}

function onGestureBlock(e) {
  e.preventDefault()
}

function onPointerDown(e) {
  if (!viewport.value) return
  const pt = viewportPoint(e)
  activePointers.set(e.pointerId, pt)

  if (!isDesktop.value && activePointers.size === 1) {
    tapTracking = true
    tapMoved = false
    tapStartX = e.clientX
    tapStartY = e.clientY
  }

  if (activePointers.size === 2) {
    // iOS Safari 无法稳定给出第二根 pointer，触摸捏合走 Touch Events
    // Android Chrome 两种事件都会来，这里跳过以免缩放加倍
    if (e.pointerType === 'touch' || isPinching.value) return
    isPanning = false
    panAxis = null
    tapTracking = false
    isPinching.value = true
    atFitScale.value = false
    capturePointer(e)
    const pts = [...activePointers.values()]
    pinchStartDist = pointerDistance(pts[0], pts[1]) || 1
    pinchStartScale = scale.value
    return
  }

  if (isPinching.value) return

  // 放大后单指：先不 capture，等方向锁定再决定横向平移或纵向滚动
  // 鼠标没有「拖拽滚页面」，直接进入横向平移
  if (scale.value > fitScale.value + FIT_EPS) {
    isPanning = true
    panAxis = e.pointerType === 'mouse' ? 'x' : null
    panStartX = pt.x
    panOriginTx = tx.value
    panDownClientX = e.clientX
    panDownClientY = e.clientY
    if (panAxis === 'x') capturePointer(e)
  }
}

function onPointerMove(e) {
  if (!activePointers.has(e.pointerId)) return
  const pt = viewportPoint(e)
  activePointers.set(e.pointerId, pt)

  if (tapTracking) {
    const adx = Math.abs(e.clientX - tapStartX)
    const ady = Math.abs(e.clientY - tapStartY)
    if (adx > TAP_MOVE_PX || ady > TAP_MOVE_PX) tapMoved = true
  }

  // 触摸双指由 Touch Events 负责
  if (e.pointerType === 'touch' && (isPinching.value || activePointers.size >= 2)) {
    return
  }

  if (activePointers.size >= 2) {
    e.preventDefault()
    const pts = [...activePointers.values()]
    const dist = pointerDistance(pts[0], pts[1]) || 1
    const mid = pointerMidpoint(pts[0], pts[1])
    const next = pinchStartScale * (dist / pinchStartDist)
    setScaleAtPoint(next, mid.x)
    return
  }

  if (isPinching.value || !isPanning || activePointers.size !== 1) return

  const dxClient = e.clientX - panDownClientX
  const dyClient = e.clientY - panDownClientY

  if (!panAxis) {
    const adx = Math.abs(dxClient)
    const ady = Math.abs(dyClient)
    if (adx < AXIS_LOCK_PX && ady < AXIS_LOCK_PX) return
    panAxis = adx > ady ? 'x' : 'y'
    if (panAxis === 'x') {
      // 锁定横向后再 capture，避免抢走纵向滚动
      capturePointer(e)
      panStartX = pt.x
      panOriginTx = tx.value
    }
  }

  if (panAxis === 'x') {
    e.preventDefault()
    const dx = pt.x - panStartX
    const pan = clampPan(panOriginTx + dx, 0, scale.value)
    tx.value = pan.x
    ty.value = pan.y
  }
  // panAxis === 'y'：不 preventDefault、不改 transform，交给 touch-action: pan-y
}

function onPointerUp(e) {
  const wasTap =
    tapTracking &&
    !tapMoved &&
    !isPinching.value &&
    activePointers.size <= 1

  activePointers.delete(e.pointerId)
  try {
    e.currentTarget?.releasePointerCapture?.(e.pointerId)
  } catch (_) {
    /* ignore */
  }

  if (activePointers.size < 2) {
    pinchStartDist = 0
    isPinching.value = false
  }

  if (activePointers.size === 0) {
    isPanning = false
    panAxis = null
    tapTracking = false
    if (wasTap && !isDesktop.value) {
      // 部分移动浏览器点画布不发 click；pointerup 先处理，并吞掉随后的 click
      skipPageClick = true
      onMobileOutsideTap()
      if (skipPageClickTimer) clearTimeout(skipPageClickTimer)
      skipPageClickTimer = setTimeout(() => {
        skipPageClick = false
        skipPageClickTimer = null
      }, 400)
    }
  } else if (activePointers.size === 1 && scale.value > fitScale.value + FIT_EPS) {
    const remaining = [...activePointers.values()][0]
    isPanning = true
    panAxis = null
    panStartX = remaining.x
    panOriginTx = tx.value
    // client 起点在只剩一指时无从精确恢复，下一帧用当前点重新锁定
    panDownClientX = e.clientX
    panDownClientY = e.clientY
  }
}

function onWheel(e) {
  // Ctrl/Cmd + 滚轮（含触控板捏合常带 ctrlKey）
  if (!(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  const pt = viewportPoint(e)
  const factor = Math.exp(-e.deltaY * 0.01)
  setScaleAtPoint(scale.value * factor, pt.x)
}

function onViewportResize() {
  syncViewportWidth()
  const vw = getViewportWidth()
  // 用窗口可用高度，不用画布内容高度，避免重绘撑高后再次触发
  const vh = getRenderViewportHeight()
  const widthChanged = Math.abs(vw - lastRenderViewportW) >= 1
  const heightChanged = Math.abs(vh - lastRenderViewportH) >= 1

  const deviceLayout = isDevicePaperSize(paperSize.value)
  // PC：宽或高变化都可能改变分栏数；设备模式：宽度变化需按屏幕重排
  const shouldRerender =
    !!currentXml.value &&
    (isDesktop.value
      ? widthChanged || heightChanged
      : deviceLayout && widthChanged)

  if (shouldRerender) {
    lastRenderViewportW = vw
    lastRenderViewportH = vh
    rerenderCurrent({ preferPitchUpdate: false })
    return
  }
  updateFitScaleOnResize()
}

function onDesktopMqChange() {
  const prev = isDesktop.value
  syncDesktopFlag()
  if (prev === isDesktop.value) return
  headerHovered.value = false
  headerMenuOpen.value = false
  headerPointerInside = false
  sheetOpen.value = false
  fabVisible.value = false
  clearFabTimer()
  showFabTemporarily()
  if (currentXml.value) rerenderCurrent({ preferPitchUpdate: false })
}

let resizeObserver = null
let resizeRafId = 0

function scheduleViewportResize() {
  if (resizeRafId) cancelAnimationFrame(resizeRafId)
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = 0
    onViewportResize()
  })
}

onMounted(() => {
  onThemeSchemeApplied(() => {
    if (!currentXml.value) return
    rerenderCurrent({ preferPitchUpdate: false })
  })
  void bindSchemeListenersWhenReady()
  void applyTheme(theme.value)
  void bindTauriWindowResized(scheduleViewportResize)
  syncDesktopFlag()
  syncViewportWidth()
  if (typeof window !== 'undefined' && window.matchMedia) {
    desktopMql = window.matchMedia('(hover: hover) and (pointer: fine)')
    desktopMql.addEventListener?.('change', onDesktopMqChange)
    desktopMql.addListener?.(onDesktopMqChange)
  }

  loadSelectedExample()
  showFabTemporarily()
  window.addEventListener('keydown', onExportPaperDialogKeydown)

  const el = viewport.value
  if (el) {
    // 非 passive，才能在 Ctrl/触控板捏合时 preventDefault
    el.addEventListener('wheel', onWheel, { passive: false })
  }
  const page = pageEl.value
  if (page) {
    // iOS Safari 必须用 Touch Events 才能收到第二指；passive:false 才能 preventDefault
    page.addEventListener('touchstart', onTouchStart, { passive: false })
    page.addEventListener('touchmove', onTouchMove, { passive: false })
    page.addEventListener('touchend', onTouchEnd)
    page.addEventListener('touchcancel', onTouchEnd)
    page.addEventListener('gesturestart', onGestureBlock, { passive: false })
    page.addEventListener('gesturechange', onGestureBlock, { passive: false })
    page.addEventListener('gestureend', onGestureBlock, { passive: false })
  }
  // 窗口 resize：捕获高度变化（画布 RO 往往只跟内容高度走）
  window.addEventListener('resize', scheduleViewportResize)
  window.addEventListener('orientationchange', scheduleViewportResize)
  window.visualViewport?.addEventListener('resize', scheduleViewportResize)
  if (typeof ResizeObserver !== 'undefined' && el) {
    resizeObserver = new ResizeObserver(() => {
      // 延后到下一帧，避免「ResizeObserver loop completed with undelivered notifications」
      scheduleViewportResize()
    })
    resizeObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  clearFabTimer()
  clearSkipPageClick()
  fitRetryTimers.forEach(clearTimeout)
  fitRetryTimers = []
  if (renderRafId) {
    cancelAnimationFrame(renderRafId)
    renderRafId = 0
  }
  pendingRenderOpts = null
  if (resizeRafId) cancelAnimationFrame(resizeRafId)
  viewport.value?.removeEventListener('wheel', onWheel)
  pageEl.value?.removeEventListener('touchstart', onTouchStart)
  pageEl.value?.removeEventListener('touchmove', onTouchMove)
  pageEl.value?.removeEventListener('touchend', onTouchEnd)
  pageEl.value?.removeEventListener('touchcancel', onTouchEnd)
  pageEl.value?.removeEventListener('gesturestart', onGestureBlock)
  pageEl.value?.removeEventListener('gesturechange', onGestureBlock)
  pageEl.value?.removeEventListener('gestureend', onGestureBlock)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleViewportResize)
  window.removeEventListener('orientationchange', scheduleViewportResize)
  window.visualViewport?.removeEventListener('resize', scheduleViewportResize)
  window.removeEventListener('keydown', onExportPaperDialogKeydown)
  clearPageZoomBlock()
  if (desktopMql) {
    desktopMql.removeEventListener?.('change', onDesktopMqChange)
    desktopMql.removeListener?.(onDesktopMqChange)
  }
  void unbindTauriWindowListeners()
})
</script>

<style scoped>
.page-wrap {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  box-sizing: border-box;
  padding-top: 12px;
  padding-right: calc(16px + var(--safe-area-right, env(safe-area-inset-right, 0px)));
  padding-bottom: 24px;
  padding-left: calc(16px + var(--safe-area-left, env(safe-area-inset-left, 0px)));
  color: var(--color-text-primary);
  /* 禁止系统捏合（iOS 会只放大标题）；双指缩放由 JS 处理 */
  touch-action: pan-y;
}

.page-wrap > .canvas-wrap {
  margin-top: 8px;
}

.score-header {
  position: relative;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  min-height: 36px;
  flex-shrink: 0;
  padding: 0 52px;
  box-sizing: border-box;
  overflow: visible;
}

.score-title {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--font-size-title);
  font-weight: 400;
  line-height: 36px;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
  text-align: center;
  position: relative;
  flex: 0 1 auto;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 1;
  /* iOS 12 只认 100%，none 会被忽略并放大标题 */
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

.header-actions {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 36px;
  z-index: 2;
}

.header-actions--start {
  justify-content: flex-start;
}

.header-actions--start > * + * {
  margin-left: var(--menu-gap);
}

.header-actions--end {
  justify-content: flex-end;
  /* right 由 headerActionsStyle 控制（窄谱贴视口右，宽谱贴正文右缘） */
}

/* PC：无外框，紧凑一字排开 */
.toolbar-inline {
  display: flex;
  align-items: center;
}

.toolbar-panel--sheet {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: var(--menu-width);
  max-width: calc(100vw - 32px);
  z-index: 60;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

.toolbar-panel--sheet-start {
  right: auto;
  left: 0;
}

.toolbar-panel--transpose {
  width: 360px;
  max-width: calc(100vw - 32px);
}

.transpose-anchor {
  position: relative;
}

.transpose-panel {
  box-sizing: border-box;
  width: 100%;
  padding: 18px 16px 16px;
  border-radius: var(--menu-radius);
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.transpose-panel :deep(.transpose-panel-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 16px;
}

.transpose-panel :deep(.transpose-panel-head > * + *) {
  margin-left: 12px;
}

.transpose-panel :deep(.transpose-panel-title) {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
}

.transpose-panel :deep(.transpose-reset) {
  box-sizing: border-box;
  margin: 0;
  padding: 4px 12px;
  border: 1.5px solid var(--color-accent);
  border-radius: 999px;
  background: transparent;
  color: var(--color-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  cursor: pointer;
  touch-action: manipulation;
}

.transpose-panel :deep(.transpose-reset:hover:not(:disabled)) {
  background: var(--color-accent);
  color: #ffffff;
}

.transpose-panel :deep(.transpose-reset:disabled) {
  opacity: 0.4;
  cursor: not-allowed;
}

.transpose-panel :deep(.transpose-stepper) {
  display: flex;
  align-items: center;
  margin: 0 0 16px;
  padding: 12px 10px;
  border-radius: 14px;
  background: var(--color-page-bg);
}

.transpose-panel :deep(.transpose-stepper > * + *) {
  margin-left: 10px;
}

.transpose-panel :deep(.transpose-stepper-status) {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.transpose-panel :deep(.transpose-panel-status) {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
}

.transpose-panel :deep(.transpose-panel-current) {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.3;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.transpose-panel :deep(.transpose-accidental) {
  font-size: 13px;
  vertical-align: 0.5em;
  margin-right: 1px;
}

.transpose-panel :deep(.transpose-round) {
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1.5px solid var(--color-border);
  border-radius: 50%;
  background: transparent;
  color: inherit;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  touch-action: manipulation;
}

.transpose-panel :deep(.transpose-round-icon) {
  display: block;
  flex-shrink: 0;
}

.transpose-panel :deep(.transpose-round:hover:not(:disabled)) {
  background: var(--color-menu-divider);
}

.transpose-panel :deep(.transpose-round:disabled) {
  opacity: 0.4;
  cursor: not-allowed;
}

.transpose-panel :deep(.transpose-slider-wrap) {
  margin: 0 2px 4px;
}

.transpose-panel :deep(.transpose-slider) {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 4px;
  margin: 8px 0 10px;
  padding: 0;
  background: var(--color-menu-divider);
  border-radius: 999px;
  outline: none;
  touch-action: none;
}

.transpose-panel :deep(.transpose-slider::-webkit-slider-thumb) {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.transpose-panel :deep(.transpose-slider::-moz-range-thumb) {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.transpose-panel :deep(.transpose-slider::-moz-range-track) {
  height: 4px;
  background: var(--color-menu-divider);
  border-radius: 999px;
}

.transpose-panel :deep(.transpose-slider-labels) {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  line-height: 1.3;
  color: var(--color-text-secondary);
}

:deep(.toolbar-controls) {
  display: flex;
  align-items: center;
}

:deep(.toolbar-controls--row) {
  flex-wrap: nowrap;
}

:deep(.toolbar-controls--row > * + *) {
  margin-left: var(--menu-gap);
}

:deep(.toolbar-controls--row .menu-seg--example),
:deep(.toolbar-controls--row .menu-seg--light),
:deep(.toolbar-controls--row .menu-seg--actions) {
  flex: 0 0 auto;
}

:deep(.toolbar-controls--row .menu-seg--actions) {
  min-width: var(--menu-width);
}

:deep(.toolbar-controls--row .menu-seg--appearance) {
  min-width: 0;
}

:deep(.toolbar-controls--row .toolbar-appearance-block) {
  flex: 0 0 auto;
}

:deep(.toolbar-controls--stack) {
  flex-direction: column;
  align-items: stretch;
}

:deep(.toolbar-controls--stack > * + *) {
  margin-top: var(--menu-gap);
}

:deep(.menu-seg) {
  border-radius: var(--menu-radius);
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

:deep(.menu-seg--dark) {
  background: var(--color-menu-dark-bg);
  color: var(--color-menu-dark-text);
}

:deep(.menu-seg--example) {
  background: var(--color-menu-dark-bg);
  color: var(--color-menu-dark-text);
}

:global(html[data-scheme='dark']) :deep(.menu-seg--example) {
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
}

:deep(.menu-seg--example .menu-row:hover),
:deep(.menu-seg--example button.menu-row:hover) {
  background: transparent;
}

:deep(.menu-seg--light),
:deep(.menu-seg--actions) {
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
}

:deep(.menu-row),
:deep(.control-chip) {
  position: relative;
  display: flex;
  align-items: center;
  margin: 0;
  font-size: var(--font-size-menu);
  color: inherit;
  cursor: pointer;
}

:deep(.menu-row) {
  justify-content: space-between;
  min-height: var(--menu-row-height);
  padding: 0 14px;
}

:deep(.menu-row:hover) {
  background: var(--color-menu-divider);
}

:deep(button.menu-row) {
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

:deep(button.menu-row:hover) {
  background: var(--color-menu-divider);
}

:deep(.menu-row > * + *) {
  margin-left: 12px;
}

:deep(.control-chip) {
  justify-content: center;
  min-height: var(--menu-row-height);
  padding: 0 12px;
  touch-action: manipulation;
}

:deep(.control-chip > * + *) {
  margin-left: 4px;
}

:deep(.menu-row-label),
:deep(.control-chip-text) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

:deep(.toolbar-controls--row .menu-seg--example .menu-row-label),
:deep(.toolbar-controls--row .menu-seg--example .control-chip-text) {
  max-width: 12em;
}

:deep(.menu-row-icon),
:deep(.control-chip-caret) {
  flex-shrink: 0;
  display: block;
}

:deep(.control-chip-caret) {
  display: block;
}

:deep(.file-input) {
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

:deep(.toolbar-actions-row) {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: var(--menu-row-height);
}

:deep(.toolbar-actions-row > *) {
  position: relative;
  min-width: 0;
}

:deep(.toolbar-actions-row .control-chip--paper),
:deep(.toolbar-actions-row .control-chip--linebreak),
:deep(.toolbar-actions-row .btn) {
  min-width: 0;
  width: auto;
}

:deep(.toolbar-actions-row .control-chip--paper) {
  flex: 3 1 0;
  padding: 0 6px;
}

:deep(.toolbar-actions-row .control-chip--linebreak) {
  flex: 4 1 0;
  padding: 0 6px;
}

:deep(.toolbar-actions-row > * + *)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--color-menu-divider);
  pointer-events: none;
  z-index: 1;
}

:deep(.toolbar-actions-row .btn) {
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

:deep(.toolbar-actions-row .btn:hover:not(:disabled)),
:deep(.control-chip:hover) {
  background: var(--color-menu-divider);
}

:deep(.toolbar-actions-row .btn:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

:deep(.export-icon) {
  display: block;
}

:deep(.toolbar-appearance-row) {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: var(--menu-row-height);
}

:deep(.toolbar-appearance-row > *) {
  position: relative;
  min-width: 0;
}

:deep(.toolbar-appearance-block) {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
}

:deep(.control-font-btn) {
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

:deep(.control-font-btn--small) {
  flex: 3 1 0;
}

:deep(.control-font-btn--large) {
  flex: 4 1 0;
}

:deep(.control-font-btn:hover:not(:disabled)) {
  background: var(--color-menu-divider);
}

:deep(.control-font-btn:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

:deep(.font-size-dots-row) {
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

:deep(.font-size-dots-row--visible) {
  opacity: 1;
  visibility: visible;
}

:deep(.font-size-dots) {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 7 1 0;
  min-width: 0;
}

:deep(.font-size-dot + .font-size-dot) {
  margin-left: 5px;
}

:deep(.font-size-dots-spacer) {
  flex: 3 1 0;
  min-width: 0;
}

:deep(.font-size-dot) {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.22;
}

:deep(.font-size-dot--on) {
  opacity: 1;
}

:deep(.control-chip--theme) {
  flex: 3 1 0;
  width: auto;
  padding: 0;
  justify-content: center;
}

:deep(.toolbar-appearance-row > * + *)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--color-menu-divider);
  pointer-events: none;
  z-index: 1;
}

:deep(.theme-icon) {
  display: block;
}

/* PC：小/大仍是一组，主题单独一格，避免撑成整行 320 */
:deep(.toolbar-controls--row .control-font-btn--small),
:deep(.toolbar-controls--row .control-font-btn--large) {
  flex: 0 0 auto;
  padding: 0 12px;
}

:deep(.toolbar-controls--row .control-chip--theme) {
  flex: 0 0 44px;
  width: 44px;
}

:deep(.toolbar-controls--row .control-font-btn--large)::before {
  display: none;
}

:deep(.toolbar-controls--row .font-size-dots-row) {
  right: 44px;
}

:deep(.toolbar-controls--row .font-size-dots) {
  flex: 1 1 auto;
}

:deep(.toolbar-controls--row .font-size-dots-spacer) {
  display: none;
}

.canvas-wrap {
  width: 100%;
  /* 不可用 overflow-x:hidden：另一轴 visible 会算成 auto，和 #app 叠出双滚动条 */
  overflow: visible;
  flex: 1 0 auto;
}

.canvas-spacer {
  overflow: visible;
}

.canvas-stage {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.canvas-wrap:active .canvas-stage {
  cursor: grabbing;
}

/* 使用 SVG 自身 width/height 像素，由外层 transform 缩放 */
.score-svg {
  display: block;
  flex-shrink: 0;
  font-family: var(--font-score);
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
  fill: var(--color-text-primary);
  color: var(--color-text-primary);
}

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

.menu-anchor {
  position: relative;
  display: flex;
  align-items: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  touch-action: manipulation;
}

.menu-anchor--fixed {
  position: fixed;
  top: calc(12px + var(--safe-area-top, env(safe-area-inset-top, 0px)));
  right: calc(16px + var(--safe-area-right, env(safe-area-inset-right, 0px)));
  z-index: 80;
}

.menu-anchor--start {
  right: auto;
  left: calc(16px + var(--safe-area-left, env(safe-area-inset-left, 0px)));
}

.menu-anchor--visible {
  opacity: 1;
  pointer-events: auto;
}

.menu-btn {
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--color-menu-light-bg);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-primary);
  touch-action: manipulation;
}

.menu-btn.menu-btn--active {
  background: var(--color-accent);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(10, 132, 255, 0.35);
}

.menu-icon {
  display: block;
}

.export-paper-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.4);
}

.export-paper-dialog {
  width: 320px;
  max-width: calc(100vw - 48px);
  padding: 20px 18px 16px;
  border-radius: var(--menu-radius);
  background: var(--color-menu-light-bg);
  color: var(--color-menu-light-text);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}

.export-paper-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}

.export-paper-hint {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.export-paper-guide {
  margin: 0 0 16px;
  padding: 12px 12px 10px;
  border-radius: 12px;
  background: var(--color-page-bg);
}

.export-paper-guide-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
}

.export-paper-guide ol {
  margin: 0;
  padding-left: 1.3em;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.export-paper-guide li + li {
  margin-top: 4px;
}

.export-paper-actions {
  display: flex;
  flex-direction: column;
}

.export-paper-btn {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--menu-row-height);
  margin: 8px 0 0;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-menu);
  cursor: pointer;
}

.export-paper-btn--last {
  border-color: var(--color-text-primary);
}

.export-paper-btn:hover:not(:disabled) {
  background: var(--color-menu-divider);
}

.export-paper-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.export-paper-btn--ghost {
  border-color: transparent;
  color: var(--color-text-secondary);
}

.export-paper-actions > .export-paper-btn:first-child {
  margin-top: 0;
}
</style>
