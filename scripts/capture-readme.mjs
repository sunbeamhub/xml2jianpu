/**
 * 采集 README 用渲染图。依赖已运行的 `npm run dev`（默认 http://localhost:5173/）。
 * 用法（不写入 package.json）：
 *   npm install --no-save playwright && node scripts/capture-readme.mjs
 *   CAPTURE_ONLY=columns node scripts/capture-readme.mjs
 *   CAPTURE_ONLY=zoom node scripts/capture-readme.mjs
 *   CAPTURE_ONLY=transpose node scripts/capture-readme.mjs
 * 优先使用本机 Chrome；若没有，再执行 npx playwright install chromium。
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../docs/readme')
const BASE_URL = process.env.CAPTURE_URL || 'http://localhost:5173/'
const EXAMPLE_ID = '儿歌/粉刷匠'
const COLUMNS_EXAMPLE_ID = '三色绘恋/三色绘恋'
const CAPTURE_ONLY = process.env.CAPTURE_ONLY || ''

const desktopViewport = { width: 1920, height: 1080 }
const desktop2kViewport = { width: 2560, height: 1440 }

async function waitForScore(page, title = '粉刷匠') {
  await page.waitForFunction(
    (expected) => {
      const titleEl = document.querySelector('.score-title')
      const svg = document.querySelector('.score-svg')
      return (
        Boolean(titleEl?.textContent?.includes(expected)) &&
        Boolean(svg && svg.childElementCount > 0)
      )
    },
    title,
    { timeout: 60000 }
  )
  await page.waitForTimeout(600)
}

async function ensureDesktopToolbar(page) {
  await page.locator('.score-header').hover({ position: { x: 40, y: 20 } })
  await page.waitForTimeout(200)
}

async function openMobileMenu(page) {
  const menuBtn = page.locator('button[aria-label="打开功能菜单"]')
  const sheet = page.locator('.toolbar-panel--sheet')
  if (await sheet.isVisible().catch(() => false)) return
  if (!(await menuBtn.isVisible().catch(() => false))) {
    await page.locator('.page-wrap').click({ position: { x: 20, y: 80 } })
    await menuBtn.waitFor({ state: 'visible', timeout: 5000 })
  }
  await menuBtn.click()
  await sheet.waitFor({ state: 'visible', timeout: 5000 })
}

/** 收起功能面板，保留左右 FAB，供使用说明全页图 */
async function closeMobileSheetKeepFab(page) {
  const menuBtn = page.locator('button[aria-label="打开功能菜单"]')
  const transposeBtn = page.locator('button[aria-label="固定调移调"]')
  const sheet = page.locator('.toolbar-panel--sheet')
  if (await sheet.isVisible().catch(() => false)) {
    await menuBtn.click()
    await sheet.waitFor({ state: 'hidden', timeout: 5000 })
  }
  if (!(await menuBtn.isVisible().catch(() => false))) {
    await page.locator('.page-wrap').click({ position: { x: 20, y: 80 } })
  }
  await menuBtn.waitFor({ state: 'visible', timeout: 5000 })
  await transposeBtn.waitFor({ state: 'visible', timeout: 5000 })
}

async function openDesktopTranspose(page) {
  await ensureDesktopToolbar(page)
  const btn = page.locator('button[aria-label="固定调移调"]')
  await btn.waitFor({ state: 'visible' })
  if ((await btn.getAttribute('aria-expanded')) !== 'true') {
    await btn.click()
  }
  await page.locator('.transpose-panel').waitFor({ state: 'visible' })
  await page.waitForTimeout(500)
}

async function prepareScore(
  page,
  { desktop, exampleId = EXAMPLE_ID, title = '粉刷匠' }
) {
  if (desktop) {
    await ensureDesktopToolbar(page)
  } else {
    await openMobileMenu(page)
  }
  await page.locator('select[aria-label="内置示例"]').first().selectOption(exampleId)
  await waitForScore(page, title)
  if (desktop) {
    await ensureDesktopToolbar(page)
    await page.locator('select[aria-label="纸张大小"]').first().selectOption('device')
    await page.locator('select[aria-label="主题"]').first().selectOption('light')
  } else {
    await openMobileMenu(page)
    await page.locator('select[aria-label="纸张大小"]').first().selectOption('device')
    await openMobileMenu(page)
    await page.locator('select[aria-label="主题"]').first().selectOption('light')
  }
  await waitForScore(page, title)
  if (desktop) await ensureDesktopToolbar(page)
}

async function hideDesktopToolbar(page) {
  await page.mouse.move(80, 400)
  await page.waitForFunction(() => {
    const el = document.querySelector('.toolbar-inline')
    return !el || getComputedStyle(el).display === 'none'
  }, { timeout: 8000 })
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, name)
  await page.screenshot({ path: file, fullPage: false })
  console.log('wrote', name)
}

async function withPage(browser, options, fn) {
  const context = await browser.newContext({
    colorScheme: 'light',
    ...options,
  })
  const page = await context.newPage()
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  try {
    await fn(page)
  } finally {
    await context.close()
  }
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true })
  } catch {
    return await chromium.launch({ headless: true })
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await launchBrowser()
  const iphone = devices['iPhone 13']
  const ipad = {
    ...devices['iPad Air'],
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }

  try {
    if (!CAPTURE_ONLY || CAPTURE_ONLY === 'columns') {
      await withPage(
        browser,
        {
          viewport: desktop2kViewport,
          deviceScaleFactor: 1,
          hasTouch: false,
          isMobile: false,
        },
        async (page) => {
          page.setDefaultTimeout(60000)
          await prepareScore(page, {
            desktop: true,
            exampleId: COLUMNS_EXAMPLE_ID,
            title: '三色绘恋',
          })
          await hideDesktopToolbar(page)
          await page.locator('.column-rule').first().waitFor({
            state: 'attached',
            timeout: 15000,
          })
          await page.waitForTimeout(800)
          await shot(page, 'feature-columns-2k.png')
        }
      )
    }

    if (!CAPTURE_ONLY || CAPTURE_ONLY === 'zoom') {
      await withPage(
        browser,
        {
          viewport: desktopViewport,
          deviceScaleFactor: 1,
          hasTouch: false,
          isMobile: false,
        },
        async (page) => {
          await prepareScore(page, { desktop: true })
          await hideDesktopToolbar(page)
          await page.evaluate(() => {
            const el = document.querySelector('.canvas-wrap')
            if (!el) return
            const rect = el.getBoundingClientRect()
            el.dispatchEvent(
              new WheelEvent('wheel', {
                ctrlKey: true,
                deltaY: -200,
                clientX: rect.left + rect.width * 0.35,
                clientY: rect.top + 140,
                bubbles: true,
                cancelable: true,
              })
            )
          })
          await page.waitForTimeout(400)
          await shot(page, 'feature-zoom.png')
        }
      )
    }

    if (!CAPTURE_ONLY || CAPTURE_ONLY === 'transpose') {
      await withPage(
        browser,
        {
          viewport: desktopViewport,
          deviceScaleFactor: 1,
          hasTouch: false,
          isMobile: false,
        },
        async (page) => {
          await prepareScore(page, {
            desktop: true,
            exampleId: COLUMNS_EXAMPLE_ID,
            title: '三色绘恋',
          })
          await openDesktopTranspose(page)
          await waitForScore(page, '三色绘恋')
          await ensureDesktopToolbar(page)
          await page.waitForTimeout(400)
          await shot(page, 'feature-transpose.png')
        }
      )
    }

    if (CAPTURE_ONLY) {
      return
    }

    await withPage(
      browser,
      {
        viewport: desktopViewport,
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      },
      async (page) => {
        await prepareScore(page, { desktop: true })
        await ensureDesktopToolbar(page)
        await shot(page, 'usage-desktop-1920.png')
        const headerBox = await page.locator('.score-header').boundingBox()
        await page.screenshot({
          path: path.join(OUT_DIR, 'feature-toolbar-desktop.png'),
          clip: {
            x: 0,
            y: 0,
            width: desktopViewport.width,
            height: Math.ceil((headerBox?.y || 0) + (headerBox?.height || 64) + 12),
          },
        })
        console.log('wrote', 'feature-toolbar-desktop.png')

        await page.locator('button[aria-label^="增大字号"]').click()
        await waitForScore(page)
        await ensureDesktopToolbar(page)
        await page.locator('button[aria-label^="增大字号"]').click()
        await page.waitForTimeout(300)
        await shot(page, 'feature-fontsize.png')

        await page.locator('select[aria-label="纸张大小"]').first().selectOption('a4')
        await waitForScore(page)
        await ensureDesktopToolbar(page)
        await shot(page, 'feature-paper-a4.png')

        await page.locator('select[aria-label="纸张大小"]').first().selectOption('device')
        await waitForScore(page)
        await page.locator('select[aria-label="主题"]').first().selectOption('dark')
        await waitForScore(page)
        await ensureDesktopToolbar(page)
        await shot(page, 'feature-theme-dark.png')

        await page.locator('select[aria-label="主题"]').first().selectOption('light')
        await waitForScore(page)
        await ensureDesktopToolbar(page)
        await page.locator('button[aria-label="导出 PDF"]').click()
        await page.locator('.export-paper-dialog').waitFor({ state: 'visible' })
        await page.waitForTimeout(200)
        await shot(page, 'feature-export-dialog.png')
      }
    )

    await withPage(browser, ipad, async (page) => {
      await prepareScore(page, { desktop: false })
      await closeMobileSheetKeepFab(page)
      await shot(page, 'usage-ipad-air-11.png')
    })

    await withPage(browser, iphone, async (page) => {
      await prepareScore(page, { desktop: false })
      await closeMobileSheetKeepFab(page)
      await shot(page, 'usage-iphone-13.png')
      await openMobileMenu(page)
      await page.waitForTimeout(300)
      await shot(page, 'feature-mobile-menu.png')
    })
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
