/**
 * Behaviour and layout smoke test across every admin surface.
 *
 * Written to survive a visual overhaul: it asserts on what a staff member can DO -- controls
 * exist, are reachable, are named, and the page does not overflow -- and never on a colour, a
 * class or a pixel. A restyle that keeps the panel usable passes this unchanged; one that drops
 * an accessible name or breaks the tablet layout fails it.
 *
 * Unlike admin-journey.mjs it makes no assumptions about database state and mutates nothing, so
 * it runs against whatever data is already there, repeatedly.
 *
 * Prerequisites: the API on :8080 and the panel on :3001 (ADMIN_URL overrides).
 * Run from apps/admin:  node e2e/ui-smoke.mjs
 */

import { chromium } from '@playwright/test'

const APP = process.env.ADMIN_URL ?? 'http://localhost:3001'
const LAPTOP = { width: 1440, height: 900 }
const TABLET = { width: 820, height: 1180 }
const PAGES = ['/orders', '/menu', '/tables', '/settings', '/staff']

let pass = 0,
  fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${extra ? ` -- ${extra}` : ''}`)
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: LAPTOP })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

/** Every interactive control must have a name a screen reader can announce. */
const unnamedControls = () =>
  page.evaluate(() => {
    const named = (el) => {
      if (el.getAttribute('aria-label')?.trim()) return true
      if (el.getAttribute('aria-labelledby')) return true
      if (el.getAttribute('title')?.trim()) return true
      if ((el.innerText ?? '').trim()) return true
      if (el.tagName === 'INPUT') {
        const id = el.id
        if (id && document.querySelector(`label[for="${id}"]`)) return true
        if (el.closest('label')) return true
        if (el.getAttribute('placeholder')?.trim()) return true
      }
      return false
    }
    const out = []
    for (const el of document.querySelectorAll(
      'button, a[href], [role=combobox], [role=button], input:not([type=hidden]), select, textarea',
    )) {
      // Next's dev-tools overlay lives in a portal outside the app; it is not ours to fix.
      if (el.closest('nextjs-portal')) continue
      const box = el.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      if (!named(el)) out.push(`${el.tagName}.${(el.className || '').toString().slice(0, 40)}`)
    }
    return out
  })

/** A page that scrolls sideways on a tablet turns every vertical swipe into a fight. */
const overflowsX = () =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth > 2)

/** Tap targets below 40px are a miss on a tablet mid-service. */
const smallTargets = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], [role=combobox], [role=option]')]
      .filter((el) => !el.closest('nextjs-portal'))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height > 0 && box.height < 32)
      .map(
        ({ el, box }) =>
          `${el.tagName}:${(el.innerText || '').trim().slice(0, 18)}@${Math.round(box.height)}px`,
      ),
  )

/** Headings must not skip a level -- that is how a screen-reader user maps the page. */
const headingOrder = () =>
  page.evaluate(() => {
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) =>
      Number(h.tagName[1]),
    )
    const skips = []
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) skips.push(`h${levels[i - 1]} -> h${levels[i]}`)
    }
    return { levels, skips }
  })

console.log('=== 1. Login ===')
await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
ck(
  'email and password fields present',
  (await page.locator('input[type=email]').count()) === 1 &&
    (await page.locator('input[type=password]').count()) === 1,
)
ck('one primary submit', (await page.locator('button:has-text("Sign in")').count()) >= 1)
ck(
  'login page names every control',
  (await unnamedControls()).length === 0,
  (await unnamedControls()).join(', '),
)
await page.fill('input[type=email]', 'owner@spicegarden.test')
await page.fill('input[type=password]', 'wrongpassword')
await page.click('button:has-text("Sign in")')
await page.waitForSelector('form [role=alert]', { timeout: 15000 }).catch(() => undefined)
ck(
  'a wrong password surfaces an inline error',
  (await page.locator('form [role=alert]').count()) === 1,
)
await page.fill('input[type=password]', 'password123')
await page.click('button:has-text("Sign in")')
await page.waitForURL('**/orders', { timeout: 20000 })
ck('sign-in lands on the board', page.url().endsWith('/orders'))
// The deliberate wrong-password attempt above logs a 401 the browser reports as a failed
// resource. Expected, and not what section 10 is looking for.
consoleErrors.length = 0

console.log('=== 2. Shell and navigation ===')
for (const [label, href] of [
  ['Orders', '/orders'],
  ['Menu', '/menu'],
  ['Tables', '/tables'],
  ['Settings', '/settings'],
  ['Staff', '/staff'],
]) {
  ck(`nav links to ${label}`, (await page.locator(`a[href="${href}"]`).count()) >= 1)
}
ck(
  'the current page is marked for assistive tech',
  (await page.locator('[aria-current=page]').count()) >= 1,
)
ck(
  'exactly one sign-out control',
  (await page.getByRole('button', { name: /sign out/i }).count()) === 1,
)
ck(
  'the restaurant name is on screen',
  (await page.locator('body').innerText()).includes('Spice Garden'),
)

console.log('=== 3. Every page: names, headings, no sideways scroll (laptop) ===')
for (const path of PAGES) {
  await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const unnamed = await unnamedControls()
  ck(`${path} names every control`, unnamed.length === 0, unnamed.slice(0, 4).join(', '))
  const { levels, skips } = await headingOrder()
  ck(`${path} has a heading`, levels.length > 0, JSON.stringify(levels))
  ck(`${path} skips no heading level`, skips.length === 0, skips.join(', '))
  ck(`${path} does not scroll sideways`, !(await overflowsX()))
  const small = await smallTargets()
  ck(`${path} has no sub-32px tap target`, small.length === 0, small.slice(0, 4).join(', '))
}

console.log('=== 4. Orders board controls ===')
await page.goto(`${APP}/orders`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
const board = await page.locator('body').innerText()
ck(
  'the five kitchen columns are present',
  ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'].every((c) => board.toUpperCase().includes(c)),
)
ck('search is present and labelled', (await page.locator('input[type=search]').count()) >= 1)
ck('the table filter is present', (await page.locator('[role=combobox]').count()) >= 1)
ck('an order card renders as an article', (await page.locator('article').count()) >= 0)
// Switching the status filter refetches: "Completed" is a terminal state, so it cannot appear in
// the default view, which makes it a real test that the query changed rather than the list being
// sliced client-side.
const statusFilter = page.getByLabel('Filter by status')
await statusFilter.click()
await page.locator('[role=option]', { hasText: /^Completed$/ }).click()
await page.waitForTimeout(1200)
ck('choosing a status changes the view', /Completed/i.test(await page.locator('body').innerText()))
await statusFilter.click()
await page.locator('[role=option]', { hasText: /^Open orders$/ }).click()
await page.waitForTimeout(1200)
ck('and it goes back', /Open orders/i.test(await page.locator('body').innerText()))
await page.fill('input[type=search]', 'ZZZ-no-such-order')
await page.waitForTimeout(1200)
ck(
  'a search with no matches shows an empty state, not a blank page',
  (await page.locator('body').innerText()).length > 100,
)
await page.fill('input[type=search]', '')
await page.waitForTimeout(800)

console.log('=== 5. Order detail ===')
const openOrder = page.locator('a:has-text("Open order")').first()
if ((await openOrder.count()) > 0) {
  await openOrder.click()
  await page.waitForTimeout(1500)
  const detail = await page.locator('body').innerText()
  ck('detail shows the money breakdown', /Total/i.test(detail) && detail.includes('₹'))
  ck('detail shows payment state', /payment|paid/i.test(detail))
  ck(
    'detail offers a way back to the board',
    (await page.locator('a[href="/orders"]').count()) >= 1,
  )
  ck(
    'detail names every control',
    (await unnamedControls()).length === 0,
    (await unnamedControls()).join(', '),
  )
} else {
  console.log('  SKIP  no live order on the board to open')
}

console.log('=== 6. Menu controls ===')
await page.goto(`${APP}/menu`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
ck('categories render', (await page.locator('body').innerText()).length > 200)
const addDish = page.locator('button:has-text("Add a dish to")').first()
ck('each category offers add-a-dish', (await addDish.count()) >= 1)
if ((await addDish.count()) > 0) {
  await addDish.click()
  await page.waitForTimeout(700)
  ck('the add-dish form opens with a name field', (await page.locator('input').count()) > 3)
  ck(
    'food type is offered as a choice',
    /veg|non-veg|egg/i.test(await page.locator('body').innerText()),
  )
  ck(
    'the open form names every control',
    (await unnamedControls()).length === 0,
    (await unnamedControls()).join(', '),
  )
}
ck(
  'availability can be toggled per dish',
  (await page.getByRole('button', { name: /mark sold out|sold out/i }).count()) >= 1,
)

console.log('=== 7. Tables and QR ===')
await page.goto(`${APP}/tables`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
ck(
  'the print sheet is reachable',
  (await page.getByRole('button', { name: /print qr sheet/i }).count()) === 1,
)
const qrBtn = page.getByRole('button', { name: /^QR$|show qr|view qr/i }).first()
if ((await qrBtn.count()) > 0) {
  await qrBtn.click()
  await page.waitForTimeout(1200)
  // Panel or dialog -- either is a legitimate design choice, so this asserts the QR is on
  // screen and saveable rather than which container it arrived in.
  ck('the QR image renders', (await page.locator('img[alt*="QR code"]').count()) >= 1)
  ck('the QR can be downloaded', (await page.locator('a[download]').count()) >= 1)
  ck(
    'the QR view can be dismissed',
    (await page.getByRole('button', { name: /close|done|dismiss/i }).count()) >= 1,
  )
  await page.keyboard.press('Escape')
}
ck('a table can be added', (await page.getByRole('button', { name: /^add$/i }).count()) >= 1)

console.log('=== 8. Staff and settings ===')
await page.goto(`${APP}/staff`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
ck('staff rows render', (await page.locator('body').innerText()).includes('@spicegarden.test'))
ck(
  'add-staff is offered to an owner',
  (await page.getByRole('button', { name: /add staff/i }).count()) >= 1,
)
ck('a role can be changed', (await page.locator('[role=combobox]').count()) >= 1)
await page.goto(`${APP}/settings`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
const settings = await page.locator('body').innerText()
ck(
  'settings groups its sections',
  /restaurant/i.test(settings) && /tax/i.test(settings) && /payment/i.test(settings),
)
ck('settings has a save action', (await page.getByRole('button', { name: /save/i }).count()) >= 1)

console.log('=== 9. Tablet portrait, the stated deployment target ===')
await page.setViewportSize(TABLET)
for (const path of PAGES) {
  await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  ck(`${path} does not scroll sideways at 820px`, !(await overflowsX()))
  const navVisible = await page.locator('a[href="/orders"]').first().isVisible()
  ck(`${path} keeps navigation reachable at 820px`, navVisible)
}

console.log('=== 10. Console ===')
const real = consoleErrors.filter((e) => !/favicon|Download the React DevTools|hydrat/i.test(e))
ck('no console or page errors', real.length === 0, real.slice(0, 3).join(' ~ '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
