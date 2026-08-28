/* eslint-disable no-console */

import { registerSW } from 'virtual:pwa-register'

if (import.meta.env.PROD) {
  registerSW({
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
}
