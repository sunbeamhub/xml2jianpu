import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const DESKTOP_QUERY = '(hover: hover) and (pointer: fine)'
const REGULAR_WIDTH_QUERY = '(min-width: 500px)'

function readQuery(query) {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches
}

/** 触控窄屏用抽屉，桌面和触控宽屏用对话框 */
export function useCompactSheet() {
  const isDesktop = ref(readQuery(DESKTOP_QUERY))
  const regularWidth = ref(readQuery(REGULAR_WIDTH_QUERY))
  let desktopMql = null
  let widthMql = null

  function sync() {
    isDesktop.value = !!desktopMql?.matches
    regularWidth.value = !!widthMql?.matches
  }

  function bind(mql) {
    mql?.addEventListener?.('change', sync)
    mql?.addListener?.(sync)
  }

  function unbind(mql) {
    mql?.removeEventListener?.('change', sync)
    mql?.removeListener?.(sync)
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    desktopMql = window.matchMedia(DESKTOP_QUERY)
    widthMql = window.matchMedia(REGULAR_WIDTH_QUERY)
    sync()
    bind(desktopMql)
    bind(widthMql)
  })

  onBeforeUnmount(() => {
    unbind(desktopMql)
    unbind(widthMql)
  })

  const useSheet = computed(() => !isDesktop.value && !regularWidth.value)

  return { useSheet }
}
