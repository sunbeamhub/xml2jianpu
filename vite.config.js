import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const isTauri = process.env.TAURI_ENV_PLATFORM != null
const isWeb = !isTauri

export default defineConfig({
  base: process.env.PUBLIC_PATH || '/',
  define: {
    __PWA_ENABLED__: JSON.stringify(isWeb),
  },
  plugins: [
    vue(),
    isWeb &&
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.ico',
          'favicon.svg',
          'favicon.png',
          'apple-touch-icon.png',
          'fonts/NotoSansSC-Regular.woff2',
          'fonts/NotoSansSC-Regular.ttf',
        ],
        manifest: {
          name: 'MusicXML 转简谱',
          short_name: '简谱',
          description: '将 MusicXML 曲谱转换为简谱，并导出 PDF',
          theme_color: '#f9f9f9',
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
              type: 'image/png',
            },
            {
              src: './img/icons/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: './img/icons/pwa-maskable-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: './img/icons/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          clientsClaim: true,
          skipWaiting: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
  ].filter(Boolean),
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  assetsInclude: ['**/*.musicxml'],
})
