import 'core-js/features/string/trim-start'
import 'core-js/features/array/flat-map'
import './styles/tokens.css'
import { applyStoredTheme, syncAndroidSafeArea } from './utils/theme.js'
import { createApp } from 'vue'
import App from './App.vue'

if (typeof Element !== 'undefined' && typeof Element.prototype.replaceChildren !== 'function') {
  Element.prototype.replaceChildren = function replaceChildren() {
    while (this.firstChild) this.removeChild(this.firstChild)
    if (arguments.length) this.append.apply(this, arguments)
  }
  if (typeof DocumentFragment !== 'undefined') {
    DocumentFragment.prototype.replaceChildren = Element.prototype.replaceChildren
  }
}

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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => syncAndroidSafeArea(), { once: true })
} else {
  syncAndroidSafeArea()
}
createApp(App).mount('#app')
clearBootFallback()
