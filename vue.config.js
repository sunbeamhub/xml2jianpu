const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  // EdgeOne / Cloudflare 部署在站点根路径；GitHub Pages 子路径通过 PUBLIC_PATH 覆盖
  publicPath: process.env.PUBLIC_PATH || "/",
  chainWebpack(config) {
    // 将 .musicxml 作为静态资源导出 URL，供 require.context 动态加载
    config.module
      .rule('musicxml')
      .test(/\.musicxml$/i)
      .type('asset/resource')
  }
})
