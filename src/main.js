import 'core-js/features/string/trim-start'
import 'core-js/features/array/flat-map'
import './styles/tokens.css'
import { applyStoredTheme } from './utils/theme.js'
import { createApp } from 'vue'
import App from './App.vue'

if (import.meta.env.PROD && __PWA_ENABLED__) {
  import('./registerServiceWorker.js')
}

function clearBootFallback() {
  if (typeof window !== 'undefined' && window.__bootFallbackTimers) {
    for (const id of window.__bootFallbackTimers) clearTimeout(id)
    window.__bootFallbackTimers = null
  }
  document.getElementById('boot-fallback')?.remove()
}

applyStoredTheme()
createApp(App).mount('#app')
clearBootFallback()
