<template>
  <div class="app-scroll">
    <main class="app-shell">
      <MusicXMLViewer />
    </main>
  </div>
</template>

<script setup>
// 引入你写的组件
import MusicXMLViewer from './components/MusicXMLViewer.vue'
</script>

<style>
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden; /* document 不滚，避免与 #app 叠出双滚动条 */
  background: var(--color-page-bg);
  color: var(--color-text-primary);
  /* Safari aA「小/100%/大」只放大 HTML 文字，谱面 SVG 不会变；整页都不跟它走 */
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  /* 菜单 Teleport 到 body，避免 Safari 双击缩放页面 */
  touch-action: manipulation;
}

*,
*::before,
*::after {
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}

#app {
  width: 100%; /* 不用 100vw，避免把滚动条宽度算进去撑出横向条 */
  height: 100%;
  box-sizing: border-box;
  padding-top: var(--safe-area-top, env(safe-area-inset-top, 0px));
  padding-bottom: var(--safe-area-bottom, env(safe-area-inset-bottom, 0px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--color-page-bg);
  position: relative;
}

.app-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.app-shell {
  display: block;
  min-height: 100%;
}
</style>
