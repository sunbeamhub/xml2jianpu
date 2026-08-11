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
#app {
  width: 100vw;
  height: 100vh;
  overflow: auto;
}
</style>
