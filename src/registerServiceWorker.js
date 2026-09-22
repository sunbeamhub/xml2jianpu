/* eslint-disable no-console */

import { registerSW } from 'virtual:pwa-register'
import { setPwaUpdate } from './utils/pwaRefresh.js'

if (import.meta.env.PROD) {
  let refreshing = false
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  }

  const updateSW = registerSW({
    immediate: true,
    onRegistered() {
      console.log('Service worker has been registered.')
    },
    onOfflineReady() {
      console.log('Content has been cached for offline use.')
    },
    onNeedRefresh() {
      console.log('New content is available; please refresh.')
    },
    onRegisterError(error) {
      console.error('Error during service worker registration:', error)
    },
  })
  setPwaUpdate(updateSW)
}
