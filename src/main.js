import './styles/tokens.css'
import { applyStoredTheme } from './utils/theme.js'
import { createApp } from 'vue'
import App from './App.vue'
import './registerServiceWorker'

applyStoredTheme()
createApp(App).mount('#app')
