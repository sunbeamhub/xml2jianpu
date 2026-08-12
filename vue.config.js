const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  publicPath: "/xml2jianpu/",
  chainWebpack(config) {
    // 将 .musicxml 作为静态资源导出 URL，供 require.context 动态加载
    config.module
      .rule('musicxml')
      .test(/\.musicxml$/i)
      .type('asset/resource')
  }
})
