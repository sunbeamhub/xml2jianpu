/**
 * 采集 README 用渲染图。依赖已运行的 `npm run dev`（默认 http://localhost:5173/）。
 * 用法（不写入 package.json）：
 *   npm install --no-save playwright && node scripts/capture-readme.mjs
 *   CAPTURE_ONLY=menu node scripts/capture-readme.mjs
 *   CAPTURE_ONLY=theme node scripts/capture-readme.mjs
 *   CAPTURE_ONLY=transpose node scripts/capture-readme.mjs
 *   CAPTURE_ONLY=columns node scripts/capture-readme.mjs
 * 优先使用本机 Chrome；若没有，再执行 npx playwright install chromium。
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../docs/readme')
const BASE_URL = process.env.CAPTURE_URL || 'http://localhost:5173/'
const EXAMPLE_NAME = '粉刷匠'
const COLUMNS_EXAMPLE_NAME = '三色绘恋'
const CAPTURE_ONLY = process.env.CAPTURE_ONLY || ''

const desktopViewport = { width: 1920, height: 1080 }
const desktop2kViewport = { width: 2560, height: 1440 }

async function waitForScore(page, title = EXAMPLE_NAME) {
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

async function showDock(page, desktop) {
  const dock = page.locator('.score-dock--visible')
  if (await dock.isVisible().catch(() => false)) {
    if (desktop) await dock.hover()
    return
  }
  if (desktop) {
    await page.mouse.move(240, 180)
  } else {
    await page.locator('.page-wrap').click({ position: { x: 40, y: 140 } })
  }
  try {
    await dock.waitFor({ state: 'visible', timeout: 1500 })
  } catch {
    await page.mouse.move(240, 180)
    await dock.waitFor({ state: 'visible', timeout: 5000 })
  }
  if (desktop) await dock.hover()
}

async function openScoreMenu(page, desktop) {
  const heading = page.getByRole('heading', { name: '乐谱' })
  if (await heading.isVisible().catch(() => false)) return
  await showDock(page, desktop)
  await page.getByRole('tab', { name: '乐谱' }).click()
  await heading.waitFor({ state: 'visible', timeout: 5000 })
}

async function chooseAppSelect(page, ariaLabel, optionName, groupName) {
  const trigger = page.locator(`button[aria-label="${ariaLabel}"]`).first()
  await trigger.waitFor({ state: 'visible' })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
  const panel = page.locator(`ul[role="listbox"][aria-label="${ariaLabel}"]`)
  await panel.waitFor({ state: 'visible' })
  const option = panel
    .locator('.app-select-option:not(.app-select-option--group)')
    .filter({ hasText: optionName })
    .first()
  if (groupName && !(await option.isVisible().catch(() => false))) {
    await panel
      .locator('.app-select-option--group')
      .filter({ hasText: groupName })
      .first()
      .click()
    await option.waitFor({ state: 'visible' })
  }
  await option.click()
  await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
}

async function openPerform(page) {
  await page.keyboard.press('Escape')
  await page.locator('.overlay-scrim').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
  await showDock(page, true)
  const tab = page.getByRole('tab', { name: '演奏' })
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click()
  }
  await page.getByRole('heading', { name: '演奏' }).waitFor({ state: 'visible' })
  const reveal = page.getByRole('button', { name: '显示电子琴' })
  if (await reveal.isVisible().catch(() => false)) {
    await reveal.click()
    await page.getByRole('button', { name: '连接设备' }).waitFor({ state: 'visible' })
  }
  await page.waitForTimeout(500)
}

async function prepareScore(
  page,
  {
    desktop,
    exampleName = EXAMPLE_NAME,
    exampleGroup = '儿歌',
    title = EXAMPLE_NAME,
  }
) {
  await openScoreMenu(page, desktop)
  await chooseAppSelect(page, '内置示例', exampleName, exampleGroup)
  await waitForScore(page, title)
  await openScoreMenu(page, desktop)
  await chooseAppSelect(page, '纸张大小', '设备（跟随屏幕尺寸）')
  await openScoreMenu(page, desktop)
  await chooseAppSelect(page, '主题', '浅色')
  await waitForScore(page, title)
}

async function hideDock(page) {
  await page.keyboard.press('Escape')
  await page.locator('.overlay-scrim').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await page.mouse.move(30, 40)
  await page.waitForTimeout(6500)
  await page.waitForFunction(
    () => !document.querySelector('.score-dock--visible'),
    { timeout: 3000 }
  )
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
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 })
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
    if (!CAPTURE_ONLY || CAPTURE_ONLY === 'menu') {
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
          await openScoreMenu(page, true)
          await page.waitForTimeout(300)
          await shot(page, 'feature-menu-desktop.png')
        }
      )

      await withPage(browser, ipad, async (page) => {
        await prepareScore(page, { desktop: false })
        await openScoreMenu(page, false)
        await page.waitForTimeout(300)
        await shot(page, 'feature-menu-tablet.png')
      })

      await withPage(browser, iphone, async (page) => {
        await prepareScore(page, { desktop: false })
        await openScoreMenu(page, false)
        await page.waitForTimeout(300)
        await shot(page, 'feature-menu-phone.png')
      })
    }

    if (!CAPTURE_ONLY || CAPTURE_ONLY === 'theme') {
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
          await hideDock(page)
          await shot(page, 'feature-theme-light.png')

          await openScoreMenu(page, true)
          await chooseAppSelect(page, '主题', '深色')
          await waitForScore(page)
          await hideDock(page)
          await shot(page, 'feature-theme-dark.png')
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
            exampleName: COLUMNS_EXAMPLE_NAME,
            exampleGroup: COLUMNS_EXAMPLE_NAME,
            title: COLUMNS_EXAMPLE_NAME,
          })
          await openPerform(page)
          await waitForScore(page, COLUMNS_EXAMPLE_NAME)
          await page.waitForTimeout(400)
          await shot(page, 'feature-transpose.png')
        }
      )
    }

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
            exampleName: COLUMNS_EXAMPLE_NAME,
            exampleGroup: COLUMNS_EXAMPLE_NAME,
            title: COLUMNS_EXAMPLE_NAME,
          })
          await hideDock(page)
          await page.locator('.column-rule').first().waitFor({
            state: 'attached',
            timeout: 15000,
          })
          await page.waitForTimeout(800)
          await shot(page, 'feature-columns-2k.png')
        }
      )
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
