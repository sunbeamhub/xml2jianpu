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
}

#app {
  width: 100%; /* 不用 100vw，避免把滚动条宽度算进去撑出横向条 */
  height: 100%;
  overflow-x: hidden; /* 放大后的绝对定位画布不撑出横向条 */
  overflow-y: auto; /* 唯一纵向滚动容器 */
}
</style>
