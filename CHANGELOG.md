# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.0.3] - 2026-09-21

### 修复

- 移动端点空白无法唤出或收起菜单图标
- 深色五线谱纯黑底、纯白字，改为与简谱同一套页面底色和文字色
- 共用字号档位下五线谱歌词偏大，按简谱 16px 对齐
- 短谱时五线谱靠左、简谱居中，改为五线谱同样整块居中
- iOS 12 / 旧 Android WebView 加载五线谱失败：OSMD 经 `?url` 原样注入含 `?.` / `??`，Safari 12 无法解析；构建时降级该脚本，并垫 `replaceChildren`

## [0.0.2] - 2026-09-20

### 功能

- 新增内置专辑「电子琴启蒙1期」：《宝宝学走路》《小司机》
- 简谱 / 五线谱切换（OSMD），导出当前视图 PDF，记住记谱方式
- 五线谱 PDF 用 NotoSansSC（含斜体）；乐谱字形不改写

### 文档

- README 拆成「使用」与「开发」：用户侧写网页 / PWA / 安装包入口与功能用法，开发者侧写技术栈、分端调试与 fork 发布（含 iOS IPA 限制）
- 功能配图改为四组：菜单展开对比、浅色/深色主题、移调、桌面多列

## [0.0.1] - 2026-09-18

首个版本。将 MusicXML 转为简谱，可在网页、PWA 与原生客户端中预览并导出 PDF。

### 技术

- 前端：Vue 3、Vite 6；D3 绘谱，jsPDF、svg2pdf 导出矢量 PDF
- 客户端：Tauri 2 共用同一套前端，覆盖 Windows、macOS、Linux、Android、iOS
- 访问：GitHub Pages、腾讯云 EdgeOne、可安装 PWA，以及桌面、移动安装包
- 浏览器：不支持 IE；Safari、iOS 11+，iPadOS 13+；macOS Safari 11+（约 10.12+），亦可用 Chrome、Edge、Firefox；Android 建议 8+ 较新 Chrome、Edge、Firefox；Windows 10+；Linux 近两年常见发行版
- App：Android 7+（minSdk 24，release 面向系统 WebView ≈ Chrome 61）；iOS 13+
- 客户端上传曲谱、导出 PDF 走系统文件对话框

### 功能

- 上传本地 `.musicxml`、`.xml`，即时排成简谱
- 内置示例，按专辑分组（儿歌、三色绘恋等）
- 纸张：默认「设备」跟随屏宽，亦可预览、导出 A4、A3
- 换行：自动、原谱换行，或每行 2–6 小节
- 桌面响应式多列（最多 4 列）；平板、手机单列
- 字号；主题浅色、深色、跟随系统
- 缩放与平移（桌面 Ctrl/Cmd + 滚轮或捏合，移动端双指捏合）
- 导出矢量 PDF，按唱名 + 歌词整组分页，不拆行
- 固定调移调：按 `1=C` 重写唱名，半音升降，导出使用当前调
- 谱头：调号、拍号、速度、情绪、作词、译配、作曲
- 简谱记谱：唱名与歌词对齐，时值下划线按拍分组，八度点、升降与还原、附点、延音线、连线、休止符、小节线与终止线、连谱号
- 偏好记忆：曲目、纸张、换行、字号、主题、上次导出纸张
- PWA：可装到主屏幕；首次联网后可离线查看内置示例并导出（用户上传的谱不缓存）
