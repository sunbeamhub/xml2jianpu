# 前端模块

给后续改前端时查阅。入口是 [`src/main.js`](../../src/main.js) → [`src/App.vue`](../../src/App.vue) → [`src/components/MusicXMLViewer.vue`](../../src/components/MusicXMLViewer.vue)。PDF 导出仍从 [`src/components/MusicXMLViewer.js`](../../src/components/MusicXMLViewer.js) 调用 `initApp`，该文件只再导出 [`src/jianpu/index.js`](../../src/jianpu/index.js)。

范围是应用目录 `src/`。`src/assets/**/*.musicxml` 是示例曲谱，由 `scoreCatalog.js` 扫入，不逐首列出。

## 目录

```
src/main.js                              主题、安全区，再挂载；生产 PWA 才登记 service worker
src/App.vue                              滚动壳，只放 MusicXMLViewer
src/registerServiceWorker.js             生产环境登记 worker，把 updateSW 交给 pwaRefresh
src/components/MusicXMLViewer.vue        页面壳：标题栏、画布、关于页、生命周期
src/components/MusicXMLViewer.js         再导出 initApp、applyFirstColumnHeaderH
src/components/AboutEntry.vue            底部「关于」按钮，只发打开和悬停
src/components/AboutPage.vue             关于页：版本、更新、发版说明
src/components/AppSelect.vue             工具栏和移调面板共用的下拉
src/components/ReleaseNotes.vue          把发版说明块渲染成标题、列表、图片
src/components/ReleaseInline.vue         行内代码
src/components/viewer/
  NotationSwitch.vue                     简谱 / 五线谱切换
  ScoreToolbarControls.vue               上传、示例、字号、主题、纸张、换行、导出
  TransposePanel.vue                     移调面板；同时导出 TransposeIcon、TRANSPOSE_LIMIT
  ScoreMeta.vue                          曲头：调号、拍号、速度、作者
  ExportPdfDialog.vue                    导出选纸张，或旧系统保存说明
  MobileScoreMenu.vue                    移动端左侧移调按钮和右侧功能菜单
src/composables/
  useCanvasViewport.js                   适配缩放、平移、捏合、播放跟随
  useScoreAudio.js                       试听、光标
  useScoreSession.js                     加载、渲染队列、移调重绘、导出
src/jianpu/
  index.js                               initApp
  parse.js                               MusicXML 解析与缓存
  layout.js                              换行、列宽、多列
  glyphs.js                              唱名、八度点、下划线、小节线、花括号
  meta.js                                曲头数据与 PDF 用 SVG 曲头
  pitch.js                               唱名计算、移调就地改字
  render.js                              jianpu() 一次画完
src/utils/appUpdate.js                   GitHub Releases 检查与安装入口
src/utils/exportPdf.js                   简谱或五线谱离屏绘制，写出多页 PDF
src/utils/musicXmlSchedule.js            速度段、音符起点、试听日程
src/utils/nativeFile.js                  Tauri 打开 MusicXML、保存 PDF；网页交给 savePdf
src/utils/osmdRenderer.js                五线谱绘制、光标、导出用离屏 OSMD
src/utils/pageLayout.js                  屏幕纸张与导出纸张的页宽
src/utils/pageZoomBlock.js               iOS 双击缩放拦截，按钮组件共用
src/utils/pitchContour.js                移调面板的音高波形
src/utils/platform.js                    Tauri / Android / iOS / 主屏幕 PWA 判断
src/utils/pwaRefresh.js                  激活等待中的 service worker 再刷新
src/utils/releaseNotes.js                解析发版说明里用到的 Markdown 片段
src/utils/savePdf.js                     网页下载；旧系统走分享或占位窗口
src/utils/scoreAudioPlayer.js            Tone.js 试听单例：电子音、钢琴
src/utils/scoreCatalog.js                内置示例列表
src/utils/scoreFont.js                   Noto Sans SC 加载；PDF 嵌入同一套字体
src/utils/scoreHighlight.js              简谱播放头
src/utils/scoreMetrics.js                字号换成简谱间距
src/utils/tauriWindow.js                 窗口标题栏、系统配色、延迟显示、尺寸监听
src/utils/theme.js                       主题偏好，写入 html[data-scheme]
src/utils/toast.js                       挂在 document 上的单例提示
src/utils/viewerPrefs.js                 示例、换行、纸张、字号、记谱方式
src/styles/tokens.css                    浅色默认；data-scheme 与系统深色覆盖变量
src/assets/                              示例 MusicXML，由 scoreCatalog 收集
```

## 入口

[`main.js`](../../src/main.js) 补上旧浏览器缺少的 `trimStart`、`flatMap`、`replaceChildren`，引入 [`tokens.css`](../../src/styles/tokens.css)。挂载前调用 `applyStoredTheme()`；文档就绪后再 `syncAndroidSafeArea()`。生产构建且 `__PWA_ENABLED__` 时才动态加载 [`registerServiceWorker.js`](../../src/registerServiceWorker.js)。挂载后清掉启动占位。

[`App.vue`](../../src/App.vue) 只包一层滚动壳，页面内容都在 `MusicXMLViewer`。`html` / `body` 不滚动，避免和 `#app` 叠出双滚动条。

`registerServiceWorker.js` 只在生产环境登记。已有 controller 时，`controllerchange` 刷新一次。`updateSW` 交给 [`pwaRefresh.js`](../../src/utils/pwaRefresh.js) 的 `setPwaUpdate`。

## 页面壳还留着什么

[`MusicXMLViewer.vue`](../../src/components/MusicXMLViewer.vue) 创建 `bridge`，先装视口，再装试听，再装谱面会话，然后把返回值写回 `bridge`。跨模块调用走 `bridge`，所以 `closeSheet`、`closeTransposePanel`、`freezeHeaderInsetsIfToolbarVisible`、`onCanvasTap` 在三个 composable 都返回之后才挂上。

壳自己还负责：

- 桌面标题栏悬停、下拉菜单打开时不收起
- 移动端点空白显隐功能按钮，以及进入页面后短暂露出
- 关于页开关
- 导出对话框的 Esc
- `pageWrapStyle`、`metaStyle`，以及标题栏左右贴边
- 挂载时加载当前示例、绑定滚轮 / 触摸 / 窗口尺寸

## 关于与发版

[`AboutEntry.vue`](../../src/components/AboutEntry.vue) 只根据 `visible`、`dot`、`raised` 显示按钮，点击发 `open`。红点来自 `appUpdate.js` 的 `showUpdateDot`。

[`AboutPage.vue`](../../src/components/AboutPage.vue) 读检查状态、版本和 `releasesBetween`，更新动作走 `checkForUpdate`、`applyUpdateWithToast`、`snoozeUpdate`。说明正文交给 [`ReleaseNotes.vue`](../../src/components/ReleaseNotes.vue)。

[`releaseNotes.js`](../../src/utils/releaseNotes.js) 只解析 Keep a Changelog 里用到的一段：版本标题、分组标题、列表、分隔线，以及单独一行的 https 图片。解析失败时 [`ReleaseNotes.vue`](../../src/components/ReleaseNotes.vue) 退回原文。[`ReleaseInline.vue`](../../src/components/ReleaseInline.vue) 把行内反引号拆成代码样式。

## 业务模块

### 简谱渲染 `src/jianpu`

`initApp(svg, url, options)` 是唯一对外绘制入口。`preferPitchUpdate` 时先走 `tryUpdatePitch`；失败再清空 SVG 并全量画。`forceLight`（PDF）不写入 `pitchPaint`。

| 文件 | 职责 | 谁在用 |
| --- | --- | --- |
| `parse.js` | 解析 score-partwise，`normalizeScore`，`loadParsed` | `layout`、`glyphs`、`meta`、`pitch`、`render`、`index` |
| `layout.js` | 谱表对齐、断行、列宽、多列槽 | `render` |
| `glyphs.js` | 唱名数字、附点、八度点、下划线、小节线、钢琴括号 | `layout`、`meta`、`pitch`、`render` |
| `meta.js` | `extractMeta`、屏幕外的 `drawScoreMeta`、小节速度 | `render` |
| `pitch.js` | `note2number`、`tryUpdatePitch`、`packRenderResult` | `layout`、`index`、`render` |
| `render.js` | `jianpu()`、解析失败提示、`applyFirstColumnHeaderH` | `index` |
| `index.js` | `initApp` | `MusicXMLViewer.js`，再被 `useScoreSession` 和 `exportPdf.js` 引用 |

`jianpu()` 仍是一次绘制，局部变量没有拆成参数对象。

模块级单例，全页一份：

- `parse.js`：`parseCache`、`normalizedCache`
- `glyphs.js`：`textWidthCache`
- `pitch.js`：`pitchPaint`。只有非 `forceLight` 的屏幕绘制会写入，供移调只改唱名

### 界面 `src/components/viewer`

这些组件只收 props、发事件，不自己加载谱。

- `NotationSwitch`：桌面工具栏和手机菜单里的记谱切换。样式在组件内。
- `ScoreToolbarControls`：`group` 为 `start` / `end` / 全部，`layout` 为横排或竖排。内部再用 `NotationSwitch`。下拉用 `AppSelect`。
- `TransposePanel`：移调、试听波形。`TransposeIcon` 是具名导出，壳和 `MobileScoreMenu` 的按钮用它。波形数据来自 `pitchContour.js`，音色来自 `scoreAudioPlayer.js`。
- `ScoreMeta`：简谱曲头 HTML。壳用组件 ref 的 `$el` 量宽度和高度。
- `ExportPdfDialog`：`mode="paper"` 选 A3/A4；`mode="legacy"` 是无法直接下载时的保存步骤。
- `MobileScoreMenu`：两个 `Teleport`。只在非桌面时由壳挂上。

[`AppSelect.vue`](../../src/components/AppSelect.vue) 是共用下拉，不持有谱面状态。工具栏和移调面板都用它。

`pageZoomBlock.js` 挡住 iOS 12 双击把页面放大。`NotationSwitch`、`ScoreToolbarControls`、`TransposePanel` 和壳的卸载都会用到。

### 状态

- `scoreCatalog.js`：`import.meta.glob` 扫 `src/assets/**/*.musicxml`，导出 `examples`、`rootExamples`、`albumGroups`。
- `viewerPrefs.js`：localStorage 键名仍是 `xml2jianpu:*`。读写示例、换行、纸张、导出纸张、字号、记谱方式。
- `useCanvasViewport`：缩放、横向平移、捏合、滚轮，以及播放时把高亮滚进视口。点画布的空白手势通过 `bridge.onCanvasTap` 交给壳。
- `useScoreAudio`：加载、播放、seek、换音色，并同步简谱光标和五线谱光标。跟随滚动调用视口的 `followHighlight`。播放器本体在 `scoreAudioPlayer.js`。
- `useScoreSession`：渲染队列、简谱 / 五线谱切换、示例和本地文件、移调后的重绘、PDF 导出。视口尺寸变化是否重排也在这里。

换行、纸张、字号、记谱方式的重绘，以及移调后的 `preferPitchUpdate`，都从 `useScoreSession` 发出。

### 播放与光标

[`musicXmlSchedule.js`](../../src/utils/musicXmlSchedule.js) 从 MusicXML 建时间。`buildNoteOnsets` 给简谱绘制标播放位置，`buildTempoSpans` / `secondsAtQuarter` 给五线谱光标换算秒数，`buildMusicXmlSchedule` 给试听排音符。改速度或起点时三处一起看。

[`scoreAudioPlayer.js`](../../src/utils/scoreAudioPlayer.js) 是全页一份的 Tone.js 播放器，音色为电子音或钢琴采样。`useScoreAudio` 只订阅进度和状态，并驱动光标。

[`scoreHighlight.js`](../../src/utils/scoreHighlight.js) 在简谱 SVG 上挂播放头。`useScoreSession` 绘制后 `mountJianpuPlayheads`，`useScoreAudio` 用 `syncJianpuPlayheads` 跟着秒数移动。

[`osmdRenderer.js`](../../src/utils/osmdRenderer.js) 管五线谱。`NOTATION_JIANPU` / `NOTATION_STAFF` 是记谱方式常量，偏好、工具栏、会话都从这里引。`renderStaffPreview` / `destroyStaffPreview` 画屏幕上的 OSMD；`syncStaffCursor` 跟播放秒数；`withStaffExport` 在离屏容器里画好再交给 PDF。

[`pitchContour.js`](../../src/utils/pitchContour.js) 把播放日程收成音高折线，只给移调面板的波形。

### 版式与字体

[`pageLayout.js`](../../src/utils/pageLayout.js) 区分屏幕纸张和导出纸张。屏幕默认 `device`，导出默认 A4，可选 A3 / A4。`getPageLayout` 给出 SVG 宽度，简谱布局和 PDF 都用它。

[`scoreMetrics.js`](../../src/utils/scoreMetrics.js) 把字号收进 12–22，`makeScoreMetrics` 换成简谱的间距和行高。`layout.js`、`render.js`、工具栏的字号档位都从这里拿。五线谱缩放在 `osmdRenderer.fontSizeToOsmdZoom`，用同一套字号夹取。

[`scoreFont.js`](../../src/utils/scoreFont.js) 保证 Noto Sans SC 可用。屏幕绘制前 `useScoreSession` 调 `ensureScoreFont`；PDF 嵌入同一套字体文件。

[`tokens.css`](../../src/styles/tokens.css) 以浅色为默认。`html[data-scheme='light'|'dark']` 锁定配色；自动主题不写 `data-scheme`，深色跟 `prefers-color-scheme`。

[`theme.js`](../../src/utils/theme.js) 把偏好存在 `xml2jianpu:theme`，取值 `auto` / `light` / `dark`。`light`、`dark` 写入 `html[data-scheme]`；`auto` 去掉该属性。同时改 `theme-color`，并请 [`tauriWindow.js`](../../src/utils/tauriWindow.js) 同步窗口标题栏。Android 安全区也在这里量。

[`platform.js`](../../src/utils/platform.js) 判断 Tauri、Android Tauri、iOS Tauri，以及 iOS 主屏幕 PWA。移动端系统外观走 `matchMedia`，桌面 Tauri 走窗口 API。文件打开、PDF 保存、更新安装都先问它。

`tauriWindow.js` 读系统配色、清窗口主题覆盖、同步标题栏，并提供延迟显示和窗口尺寸监听。主题和壳的尺寸变化从这里进。

### 导出与打开文件

[`exportPdf.js`](../../src/utils/exportPdf.js) 按所选 A3 / A4 离屏重绘。简谱调用 `initApp`，并带 `forceLight: true`，因此不写入 `pitchPaint`。五线谱走 `withStaffExport`。两种结果都嵌中文字体，再交给 `savePdfUnified`。

[`nativeFile.js`](../../src/utils/nativeFile.js) 在 Tauri 里用系统对话框打开 MusicXML、保存 PDF。网页上 `openMusicXmlFile` 返回 `null`，由页面的文件输入处理；保存则调用 [`savePdf.js`](../../src/utils/savePdf.js)。Android content URI 在不支持 `Blob.arrayBuffer` 时走 `AndroidChrome.writeContentUri`。

`savePdf.js` 优先 `a[download]`。iOS 独立 PWA 改为 Web Share。iOS 13 以前的独立 PWA 要在点击的同步栈里先 `openPdfPopupGuard`，对话框的 `legacy` 模式对应该说明。`needsManualSaveGuide` 只在 iOS 13 以前为真。

### 更新与提示

[`appUpdate.js`](../../src/utils/appUpdate.js) 拉 `sunbeamhub/xml2jianpu` 的 GitHub Releases，和构建期 `__APP_VERSION__` 比较。有新版本且当天未点「稍后」时 `showUpdateDot` 为真，键名是 `yipu-update-snooze`。网页上 `applyUpdate` 走 `refreshWebApp`。桌面和 Android 的 Tauri 按平台打开对应安装包链接。iOS 客户端在关于页里直接停住，并说明不能在应用内更新。成功或失败经 `applyUpdateWithToast` 提示。

[`toast.js`](../../src/utils/toast.js) 在 `document` 上挂一份提示条。谱面会话的错误和更新结果都用 `showToast` / `hideToast`。

## 三条路径

屏幕绘制从 `useScoreSession` 出发。简谱进 `initApp`，五线谱进 `renderStaffPreview`。换行、纸张、字号、记谱方式和移调都在这一条队列里重排。

试听先用 `musicXmlSchedule` 排出日程，再交给 `scoreAudioPlayer`。进度同时推给 `syncJianpuPlayheads` 和 `syncStaffCursor`，视口用 `followHighlight` 把当前音滚进画面。

导出用同一份 XML。简谱或五线谱离屏画完后，Tauri 写到用户选定的路径，网页按 `savePdf` 下载或分享。
