/**
 * The whole diner journey, driven in a real mobile browser.
 *
 * Written as a standalone script rather than a Playwright `test()` suite on purpose: it is one
 * ordered narrative where every step depends on the last -- scan, browse, add, review, pay,
 * track -- and splitting it into independent tests would mean re-scanning and re-ordering for
 * each, which tests the setup more than the product.
 *
 * It runs against a REAL backend and a seeded database, with nothing stubbed. That is the
 * point: it is the only check here that would catch a contract drift between the Go DTOs and
 * the hand-mirrored TypeScript types in packages/shared.
 *
 * Prerequisites:
 *     make reset                       # seeded database
 *     make backend &                   # API on :8080
 *     bun run --cwd apps/diner build && bun run --cwd apps/diner start   # app on :3000
 *
 * Then:
 *     node apps/diner/e2e/diner-journey.mjs
 *
 * Screenshots land in /tmp/tx-shots for eyeballing the mobile layout. Exits non-zero on any
 * failure, so it is usable as a CI gate.
 */

import { chromium, devices } from '@playwright/test'

const QR = 'demolocaltablequrtoken0000000003'
const SHOT = '/tmp/tx-shots'
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
// A real phone profile: 390x844 at 3x, touch enabled. Desktop Chrome would hide exactly the
// layout problems this app has to get right (PRD 7).
const context = await browser.newContext({ ...devices['iPhone 13'] })
const page = await context.newPage()

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

console.log('=== 1. Scan the table QR ===')
await page.goto(`http://localhost:3000/t/${QR}`, { waitUntil: 'networkidle' })
await page.waitForURL('**/menu', { timeout: 15000 })
ck('scan redirects to the menu', page.url().endsWith('/menu'))

await page.waitForSelector('text=Spice Garden', { timeout: 10000 })
ck('restaurant name is shown', await page.locator('text=Spice Garden').first().isVisible())
ck('table label is shown in the header', await page.locator('text=Table 3').first().isVisible())
await page.screenshot({ path: `${SHOT}/1-menu.png`, fullPage: false })

console.log('=== 2. The menu renders ===')
const dishCount = await page.locator('li:has(button:text("Add"))').count()
ck('dish rows with Add buttons rendered', dishCount > 10, `found ${dishCount}`)
ck('a category heading is present', await page.locator('h2:text("Starters")').first().isVisible())
ck(
  'veg filter present',
  await page.locator('button[aria-pressed]:has-text("Veg")').first().isVisible(),
)

// Most loved, and the ratings behind it.
const loved = page.locator('section:has(h2:text("Most loved")) li')
ck('the most loved strip is shown', (await loved.count()) === 3, `${await loved.count()} shown`)
ck(
  'and leads with the highest rated dish',
  /Paneer Tikka/.test(await loved.first().innerText()),
  (await loved.first().innerText()).replace(/\n+/g, ' | '),
)
// Lowercased before comparing: both headings are uppercased in CSS and innerText returns what is
// RENDERED, so a case-sensitive indexOf finds neither and -1 < -1 quietly reports failure. (The
// Playwright :text() selectors above are case-insensitive by default, which is why only this
// hand-rolled comparison was caught by it.)
const menuText = (await page.locator('main').innerText()).toLowerCase()
ck(
  'it sits above the first category',
  menuText.indexOf('most loved') < menuText.indexOf('starters'),
  `loved@${menuText.indexOf('most loved')} starters@${menuText.indexOf('starters')}`,
)
// The floor is what stops the strip becoming "least bad": a 2.7 dish carries a visible score in
// its own category but must never be recommended.
ck(
  'a poorly rated dish is not in it',
  !/Mixed Veg Pakora/.test(await page.locator('section:has(h2:text("Most loved"))').innerText()),
)

// THE TOUCH HALF of the hover requirement. There is no hover on a phone, so the count must be
// plainly visible -- a reveal-on-hover here would hide it forever.
const touchCount = page.locator('section:has(h2:text("Most loved")) .rating-count').first()
ck('the rating count is visible on touch', await touchCount.isVisible())
ck(
  'and is not hidden behind a hover a phone cannot perform',
  (await touchCount.evaluate((el) => getComputedStyle(el).opacity)) === '1',
)
await page.screenshot({ path: `${SHOT}/2b-most-loved.png` })

// The sold-out dishes must be visible but not addable.
const soldOut = page.locator('li:has-text("Unavailable today")')
ck(
  'sold-out dishes shown, not hidden',
  (await soldOut.count()) === 2,
  `${await soldOut.count()} found`,
)
ck(
  'sold-out dish has no Add control',
  (await soldOut.first().locator('button:text("Add")').count()) === 0,
)

console.log('=== 3. Search and filter (client-side, no request) ===')
await page.fill('input[type="search"]', 'paneer')
await page.waitForTimeout(300)
const paneerRows = await page
  .locator('li:has(button:text("Add")), li:has-text("Unavailable")')
  .count()
ck('search narrows the menu', paneerRows < dishCount, `${paneerRows} vs ${dishCount}`)
ck('Paneer Tikka matched', await page.locator('text=Paneer Tikka').first().isVisible())
await page.fill('input[type="search"]', '')
await page.waitForTimeout(300)

await page.click('button[aria-pressed]:has-text("Veg")')
await page.waitForTimeout(300)
const nonVegVisible = await page.locator('text=Butter Chicken').count()
ck('veg filter hides non-veg dishes', nonVegVisible === 0)
await page.click('button[aria-pressed]:has-text("Veg")')
await page.waitForTimeout(300)

console.log('=== 4. Add to cart ===')
const paneerRow = page.locator('li', { hasText: 'Paneer Tikka' }).first()
await paneerRow.locator('button:text("Add")').click()
await page.waitForTimeout(250)
ck(
  'stepper replaces Add after adding',
  (await paneerRow.locator('button[aria-label*="One more"]').count()) === 1,
)
await paneerRow.locator('button[aria-label*="One more"]').click()
await page.waitForTimeout(250)

const naanRow = page.locator('li', { hasText: 'Garlic Naan' }).first()
await naanRow.locator('button:text("Add")').click()
await page.waitForTimeout(250)

const bar = page.locator('text=View cart').first()
ck('sticky cart bar appears', await bar.isVisible())
const barText = await page.locator('a[href="/cart"]').first().innerText()
ck('bar shows the item count', /3 items/.test(barText), barText.replace(/\n/g, ' '))
// 2 x 280.00 + 1 x 65.00 = 625.00, +5% GST = 656.25
ck(
  'bar shows a locally computed total with tax',
  barText.includes('656.25'),
  barText.replace(/\n/g, ' '),
)
await page.screenshot({ path: `${SHOT}/2-menu-with-cart.png` })

console.log('=== 5. Cart review ===')
await page.click('a[href="/cart"]')
await page.waitForURL('**/cart')
// Wait for the GST line specifically. The subtotal renders as soon as the cart loads, so
// asserting on it would race the rate fetch -- and that race was hiding a real bug where the
// screen briefly showed a tax-less "Total".
await page.waitForSelector('text=/GST \\(5%\\)/', { timeout: 10000 })
ck('cart lists Paneer Tikka', await page.locator('text=Paneer Tikka').first().isVisible())
ck('cart lists Garlic Naan', await page.locator('text=Garlic Naan').first().isVisible())
const cartBody = await page.locator('main').innerText()
ck('subtotal shown', cartBody.includes('625.00'), cartBody.replace(/\n/g, ' | ').slice(0, 200))
ck('GST line names the rate', /GST \(5%\)/.test(cartBody))
ck('total shown', cartBody.includes('656.25'))
ck('final-bill caveat is stated', /confirmed when you place the order/i.test(cartBody))
await page.screenshot({ path: `${SHOT}/3-cart.png` })

console.log('=== 6. Checkout ===')
await page.click('text=Proceed to payment')
await page.waitForURL('**/checkout')
ck(
  'both payment methods offered',
  (await page.locator('text=Pay by UPI').count()) === 1 &&
    (await page.locator('text=Pay at the counter').count()) === 1,
)
ck(
  'phone field explains why it is asked',
  /No account is created/i.test(await page.locator('main').innerText()),
)
await page.fill('input[type="tel"]', '9876543210')
await page.locator('label:has-text("Your name") input').fill('Anita')
await page.screenshot({ path: `${SHOT}/4-checkout.png` })

await page.click('text=Pay at the counter')
await page.waitForTimeout(200)
await page.click('button:has-text("Place order")')

console.log('=== 7. Order tracking ===')
await page.waitForURL(/\/orders\/ord_/, { timeout: 20000 })
await page.waitForSelector('text=Order received', { timeout: 15000 })
const track = await page.locator('main').innerText()
ck('lands on the tracking screen', /\/orders\/ord_/.test(page.url()))
ck('order number displayed', /A-\d{3}/.test(track), track.split('\n').slice(0, 4).join(' | '))
ck('diner-facing status wording', track.includes('Order received'))
ck('progress steps rendered', track.includes('Cooking') && track.includes('Served'))
ck('cancel offered while placed', (await page.locator('text=Cancel this order').count()) === 1)
ck('counter payment instruction shown', /Pay at the counter/.test(track))
ck('total on the bill', track.includes('656.25'))
ck('live indicator present', /Updating live|Checking every few seconds/.test(track))
await page.screenshot({ path: `${SHOT}/5-tracking.png` })

console.log('=== 8. My orders ===')
await page.click('text=Order more')
await page.waitForURL('**/menu')
await page.click('text=My orders')
await page.waitForURL('**/orders')
// Wait for an order card, not the header: the header renders immediately while the fetch is
// still in flight.
await page.waitForSelector('a[href^="/orders/ord_"]', { timeout: 15000 })
const list = await page.locator('main').innerText()
ck('order listed for this session', /A-\d{3}/.test(list))
ck('relative time shown', /ago/.test(list))
await page.screenshot({ path: `${SHOT}/6-my-orders.png` })

console.log('=== 9. An invalid QR is a friendly dead end ===')
await page.goto('http://localhost:3000/t/totallyinvalidtoken', {
  waitUntil: 'networkidle',
})
await page.waitForSelector('text=no longer valid', { timeout: 10000 })
ck('invalid QR shows a dead end', await page.locator('text=no longer valid').first().isVisible())
ck('dead end points at staff', /ask a staff member/i.test(await page.locator('main').innerText()))
await page.screenshot({ path: `${SHOT}/7-invalid-qr.png` })

console.log('=== 10. Restaurant-level fallback QR ===')
await page.goto('http://localhost:3000/r/spice-garden', {
  waitUntil: 'networkidle',
})
await page.waitForSelector('text=Which table are you at?', { timeout: 10000 })
const tableButtons = await page.locator('button:has-text("Table")').count()
ck('fallback lists the tables', tableButtons === 8, `${tableButtons} shown`)
await page.screenshot({ path: `${SHOT}/8-table-picker.png` })

console.log('=== 11. The rating count reveals on hover, but only where hover exists ===')
/**
 * A SECOND context, with a real pointer.
 *
 * The rest of this journey runs as an iPhone, which reports `(hover: none) (pointer: coarse)` --
 * so it can prove the touch behaviour and nothing about the hover one. The requirement has two
 * halves and they are only observable on two different devices.
 */
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const deskPage = await desktop.newPage()
await deskPage.goto(`http://localhost:3000/t/${QR}`, { waitUntil: 'networkidle' })
await deskPage.waitForSelector('text=Most loved', { timeout: 15000 })

const deskRow = deskPage.locator('section:has(h2:text("Most loved")) li').first()
const deskCount = deskRow.locator('.rating-count')
const opacityOf = () => deskCount.evaluate((el) => getComputedStyle(el).opacity)

ck('the score itself is always shown', /5\.0/.test(await deskRow.innerText()))
ck('the count is hidden until hovered', (await opacityOf()) === '0', `opacity ${await opacityOf()}`)

await deskRow.hover()
await deskPage.waitForTimeout(300)
ck('and appears on hover', (await opacityOf()) === '1', `opacity ${await opacityOf()}`)

// Opacity rather than display, so revealing it cannot reflow the row under the reader's eye --
// and so the count stays in the accessibility tree on every device.
ck('it stays in the accessibility tree either way', (await deskCount.count()) === 1)
await deskPage.screenshot({ path: `${SHOT}/2c-hover-desktop.png` })
await desktop.close()

console.log('=== 12. No unexpected console errors during the whole journey ===')
/**
 * Step 9 deliberately requests an invalid QR token, and the API correctly answers 404. The
 * browser logs that as a console error regardless of the app handling it properly, so the
 * expected failure is excluded rather than the assertion weakened -- anything else still fails.
 */
const real = consoleErrors.filter(
  (e) => !/favicon|Download the React DevTools/i.test(e) && !/status of 404/.test(e),
)
ck('no unexpected console or page errors', real.length === 0, real.slice(0, 3).join(' ~ '))

console.log(`\n===== diner E2E:  PASS ${pass}   FAIL ${fail} =====`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
