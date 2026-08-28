import 'core-js/features/string/trim-start'
import 'core-js/features/array/flat-map'
import './styles/tokens.css'
import { applyStoredTheme } from './utils/theme.js'
import { createApp } from 'vue'
import App from './App.vue'

if (import.meta.env.PROD && __PWA_ENABLED__) {
  import('./registerServiceWorker.js')
}

applyStoredTheme()
createApp(App).mount('#app')
