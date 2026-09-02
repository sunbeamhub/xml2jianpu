/** @type {HTMLElement | null} */
let toastEl = null
/** @type {HTMLElement | null} */
let toastMessageEl = null
/** @type {HTMLButtonElement | null} */
let toastCloseEl = null
/** @type {ReturnType<typeof setTimeout> | null} */
let hideTimer = null

function ensureToastEl() {
  if (typeof document === 'undefined') return null
  if (toastEl) return toastEl

  toastEl = document.createElement('div')
  toastEl.className = 'app-toast'
  toastEl.setAttribute('role', 'status')
  toastEl.setAttribute('aria-live', 'polite')
  toastEl.hidden = true

  toastMessageEl = document.createElement('span')
  toastMessageEl.className = 'app-toast__message'

  toastCloseEl = document.createElement('button')
  toastCloseEl.type = 'button'
  toastCloseEl.className = 'app-toast__close'
  toastCloseEl.setAttribute('aria-label', '关闭')
  toastCloseEl.textContent = '×'
  toastCloseEl.addEventListener('click', (e) => {
    e.stopPropagation()
    hideToast()
  })

  toastEl.append(toastMessageEl, toastCloseEl)

  const style = document.createElement('style')
  style.textContent = `
    .app-toast {
      box-sizing: border-box;
      position: fixed;
      left: 50%;
      bottom: calc(24px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)));
      z-index: 200;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 12px 12px 12px 16px;
      border-radius: 12px;
      background: var(--color-menu-light-bg, #fff);
      color: var(--color-menu-light-text, #1c1c1e);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.14);
      font-family: var(--font-ui, system-ui, sans-serif);
      font-size: 15px;
      line-height: 1.4;
      transform: translate(-50%, 12px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .app-toast.app-toast--visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .app-toast.app-toast--dismissible {
      pointer-events: auto;
    }
    .app-toast__message {
      flex: 1 1 auto;
      min-width: 0;
      text-align: center;
    }
    .app-toast__close {
      flex: 0 0 auto;
      box-sizing: border-box;
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      opacity: 0.65;
    }
    .app-toast__close:hover {
      opacity: 1;
      background: var(--color-menu-divider, rgba(0, 0, 0, 0.06));
    }
    .app-toast:not(.app-toast--dismissible) .app-toast__close {
      display: none;
    }
    .app-toast.app-toast--success {
      border: 1px solid rgba(10, 132, 255, 0.25);
    }
    .app-toast.app-toast--error {
      border: 1px solid rgba(176, 0, 32, 0.35);
      color: var(--color-error, #b00020);
    }
  `
  document.head.appendChild(style)
  document.body.appendChild(toastEl)
  return toastEl
}

/**
 * @param {string} message
 * @param {{ type?: 'info' | 'success' | 'error', duration?: number, dismissible?: boolean }} [options]
 * duration 为 0 时表示不自动消失，需再次调用 showToast 覆盖或 hideToast()
 */
export function showToast(message, options = {}) {
  const el = ensureToastEl()
  if (!el || !toastMessageEl || !toastCloseEl) return

  const type = options.type || 'info'
  const duration = options.duration ?? (type === 'info' ? 2500 : 3000)
  const dismissible = options.dismissible ?? duration === 0

  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  toastMessageEl.textContent = message
  el.className = 'app-toast'
  if (type === 'success') el.classList.add('app-toast--success')
  if (type === 'error') el.classList.add('app-toast--error')
  if (dismissible) el.classList.add('app-toast--dismissible')
  el.classList.add('app-toast--visible')
  el.hidden = false

  if (duration > 0) {
    hideTimer = setTimeout(() => hideToast(), duration)
  }
}

export function hideToast() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (!toastEl) return
  toastEl.classList.remove('app-toast--visible', 'app-toast--dismissible')
  toastEl.hidden = true
}
