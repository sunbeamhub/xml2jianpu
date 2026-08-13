<template>
  <div id="app">
    <MusicXMLViewer />
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
  overflow-x: hidden; /* 放大后的绝对定位画布不撑出横向条 */
  overflow-y: auto; /* 唯一纵向滚动容器 */
  background: var(--color-page-bg);
}
</style>
