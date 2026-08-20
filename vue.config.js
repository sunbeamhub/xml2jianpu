const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  // EdgeOne 部署在站点根路径；GitHub Pages 子路径通过 PUBLIC_PATH 覆盖
  publicPath: process.env.PUBLIC_PATH || "/",
  pwa: {
    name: 'MusicXML 转简谱',
    themeColor: '#f9f9f9',
    msTileColor: '#1B3D32',
    appleMobileWebAppCapable: 'yes',
    appleMobileWebAppStatusBarStyle: 'default',
    // 已有 favicon / apple-touch-icon 由 public/index.html 提供；此处避免再注入 Vue 默认图标
    iconPaths: {
      faviconSVG: 'favicon.svg',
      favicon32: 'favicon.png',
      favicon16: null,
      appleTouchIcon: 'apple-touch-icon.png',
      maskIcon: null,
      msTileImage: null
    },
    manifestOptions: {
      short_name: '简谱',
      description: '将 MusicXML 曲谱转换为简谱，并导出 PDF',
      background_color: '#f9f9f9',
      display: 'standalone',
      start_url: './',
      lang: 'zh-CN',
      orientation: 'any',
      categories: ['music', 'utilities'],
      icons: [
        {
          src: './img/icons/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: './img/icons/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        },
        {
          src: './img/icons/pwa-maskable-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable'
        },
        {
          src: './img/icons/pwa-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    },
    workboxPluginMode: 'GenerateSW',
    workboxOptions: {
      clientsClaim: true,
      skipWaiting: true,
      importScripts: ['legacy-pdf-sw.js'],
      navigateFallbackDenylist: [/\/legacy-pdf\//],
      // NotoSansSC-Regular.ttf ≈ 2.4MB，默认 2MB 上限会把它排除出预缓存
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
    }
  },
  chainWebpack(config) {
    config.plugin('html').tap((args) => {
      args[0].title = 'MusicXML 转简谱'
      return args
    })
    // 将 .musicxml 作为静态资源导出 URL，供 require.context 动态加载
    config.module
      .rule('musicxml')
      .test(/\.musicxml$/i)
      .type('asset/resource')
  }
})
