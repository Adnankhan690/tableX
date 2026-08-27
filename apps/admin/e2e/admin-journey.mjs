/**
 * The whole staff journey, driven in a browser at tablet width.
 *
 * Runs against a REAL backend and a seeded database. It seeds its own diner order over the API
 * first, because the board is only meaningful with something live on it -- and doing that through
 * the public endpoints rather than SQL means this also exercises the diner-to-staff handoff, which
 * is the seam most likely to break.
 *
 * Deliberately one ordered narrative rather than independent `test()` cases: every step depends
 * on the previous one (accept before prepare, prepare before serve, serve before settle), and
 * splitting them would mean re-seeding an order per case.
 *
 * Prerequisites:
 *     make reset                                                       # seeded database
 *     make backend &                                                   # API on :8080
 *     bun run --cwd apps/admin build && bun run --cwd apps/admin start  # panel on :3001
 *
 * Then, from this directory so @playwright/test resolves:
 *     cd apps/admin && node e2e/admin-journey.mjs
 *
 * Screenshots land in /tmp/tx-shots. Exits non-zero on any failure.
 */

import { chromium } from '@playwright/test'

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
// A tablet behind the counter, which is the real deployment target for this app.
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
})
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

// --- Seed a fresh diner order so the board has something live on it. ---
const API = 'http://localhost:8080'
const scan = await (await fetch(`${API}/api/public/v1/t/demolocaltablequrtoken0000000005`)).json()
const gToken = scan.data.session.token
const item = scan.data.menu.categories[0].items[0].uid
const placed = await (
  await fetch(`${API}/api/guest/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Token': gToken },
    body: JSON.stringify({
      items: [{ menu_item_uid: item, quantity: 2 }],
      payment_method: 'counter',
      customer_name: 'Ravi',
      customer_phone: '9998887777',
    }),
  })
).json()
const orderNumber = placed.data.order.order_number
const orderUid = placed.data.order.uid
console.log(`(seeded order ${orderNumber} on table 5)`)

/**
 * The seeded order's card, found by UID rather than by its number.
 *
 * Order numbers restart daily (A-001…), so a database carrying more than one day of orders can
 * have two open tickets called A-002 -- and `.first()` then picks whichever the board's sort puts
 * on top, which is the wrong one as often as not. The uid is on the card's own "Open order" link,
 * so this is exact without the card having to expose anything for the test's benefit.
 */
const seededCard = () =>
  page.locator('article').filter({ has: page.locator(`a[href="/orders/${orderUid}"]`) })

console.log('=== 1. Login ===')
await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle' })
ck('login form rendered', await page.locator('button:has-text("Sign in")').isVisible())

// A wrong password must be indistinguishable from an unknown account.
await page.fill('input[type=email]', 'owner@spicegarden.test')
await page.fill('input[type=password]', 'wrongpassword')
await page.click('button:has-text("Sign in")')
// Scoped to the form: Next also renders an empty <div role="alert"> route announcer on every
// page, and an unscoped selector matches that instead.
await page.waitForSelector('form [role=alert]', { timeout: 10000 })
const badMsg = await page.locator('form [role=alert]').innerText()
ck('wrong password rejected', /incorrect email or password/i.test(badMsg), badMsg)
ck(
  'message does not reveal whether the email exists',
  !/no account|not found|unknown/i.test(badMsg),
)
await page.screenshot({ path: `${SHOT}/a1-login.png` })

await page.fill('input[type=password]', 'password123')
await page.click('button:has-text("Sign in")')
await page.waitForURL('**/orders', { timeout: 15000 })
ck('successful login lands on the order board', page.url().endsWith('/orders'))

console.log('=== 2. The order board ===')
await page.waitForSelector('text=Orders', { timeout: 10000 })
await page.waitForSelector(`text=${orderNumber}`, { timeout: 15000 })
const board = await page.locator('main').innerText()
ck('the seeded order appears', board.includes(orderNumber))
ck('table number shown prominently', /Table 5/.test(board))
ck('customer total shown', /₹/.test(board))
// The board is one list with a status filter rather than five columns, so the pipeline is read
// off each card's status badge and the filter's own options -- not off column headings.
ck('the status filter is present', (await page.getByLabel('Filter by status').count()) === 1)
ck('cards carry their stage', /New|Accepted|Preparing|Ready|Served/.test(board))

const shell = await page.locator('header').first().innerText()
ck('shell shows restaurant and signed-in user', /Spice Garden/.test(shell) && /Rajesh/.test(shell))
// Now that the socket authenticates, this should read "Live" rather than falling back to
// polling. Asserting on the strong form is what would have caught the WebSocket auth bug.
await page.waitForSelector('text=/\\bLive\\b/', { timeout: 10000 }).catch(() => undefined)
ck(
  'realtime feed is connected, not polling',
  /\bLive\b/.test(await page.locator('body').innerText()),
  await page
    .locator('body')
    .innerText()
    .then((t) => (t.match(/Live|Refreshing[^\n]*/) ?? ['none'])[0]),
)

console.log('=== 3. Stats strip (PRD 3 metrics) ===')
const stats = await page.locator('body').innerText()
// The strip states its scope once, in its own caption, rather than repeating "today" in three of
// eight labels where it contradicted the filtered board below it.
ck('the strip says what period it covers', /Today/i.test(stats))
ck('placed figure present', /Placed/i.test(stats))
ck('avg-to-accept figure present', /Avg. to accept/i.test(stats))
// Each figure now carries a line of context derived from the others -- a share, a definition, or
// the board's own acceptance target -- so the strip states what its numbers mean.
ck('figures carry context', /% of today/.test(stats) && /On open orders/.test(stats))
ck('unpaid tile present', /Unpaid/i.test(stats))
await page.screenshot({ path: `${SHOT}/a2-board.png` })

console.log('=== 4. Server-driven action buttons (D1) ===')
const card = seededCard()
const buttons = await card.locator('button').allInnerTexts()
ck('Accept offered on a new order', buttons.includes('Accept'), buttons.join('|'))
ck('Reject offered on a new order', buttons.includes('Reject'), buttons.join('|'))
ck('no Mark-served on a new order', !buttons.includes('Mark served'), buttons.join('|'))

console.log('=== 5. Reject requires a reason (D1) ===')
await card.locator('button:has-text("Reject")').click()
await page.waitForSelector('dialog[open]', { timeout: 5000 })
ck('reason dialog opens', await page.locator('dialog[open]').isVisible())
const confirmBtn = page.locator('dialog[open] button:has-text("Reject")')
ck('confirm disabled until a reason is typed', await confirmBtn.isDisabled())
await page.fill('dialog[open] textarea', 'Kitchen has closed for the night')
ck('confirm enabled once a reason is given', await confirmBtn.isEnabled())
await page.screenshot({ path: `${SHOT}/a3-reason-dialog.png` })
// Back out -- this order is needed intact for the lifecycle test below.
await page.click('dialog[open] button:has-text("Keep the order")')
await page.waitForTimeout(300)
ck(
  'cancelling the dialog leaves the order alone',
  (await page.locator('dialog[open]').count()) === 0,
)

console.log('=== 6. Drive the order through the kitchen ===')
for (const [label, expect] of [
  ['Accept', 'ACCEPTED'],
  ['Start preparing', 'PREPARING'],
  ['Mark ready', 'READY'],
  ['Mark served', 'SERVED'],
]) {
  const target = seededCard()
  await target.locator(`button:has-text("${label}")`).click()
  await page.waitForTimeout(900)
  const text = await page.locator('main').innerText()
  ck(`${label} applied`, new RegExp(expect, 'i').test(text))
}
await page.screenshot({ path: `${SHOT}/a4-board-served.png` })

console.log('=== 7. Order detail and payment settlement (D2) ===')
await page.locator(`a[href="/orders/${orderUid}"]`).click()
await page.waitForURL(/\/orders\/ord_/, { timeout: 10000 })
await page.waitForSelector('text=Payment', { timeout: 10000 })
const detail = await page.locator('main').innerText()
ck('detail shows the items', /Paneer Tikka|Mixed Veg Pakora|×/.test(detail))
ck('customer phone is a tel link', (await page.locator('a[href^="tel:"]').count()) === 1)
ck('history/timeline rendered', /History/i.test(detail))
ck('payment section present', /Payment/.test(detail))
await page.screenshot({ path: `${SHOT}/a5-order-detail.png` })

await page.click('button:has-text("Mark as paid")')
await page.waitForSelector('text=/you saw the payment arrive/i', {
  timeout: 5000,
})
const warn = await page.locator('main').innerText()
ck('settlement copy is explicit about trusting staff', /you saw the payment arrive/i.test(warn))
ck('settlement is attributed to the signed-in user', /Rajesh/.test(warn))
await page.fill('input[placeholder*="UTR"]', 'UTR99887766')
await page.click('button:has-text("Confirm payment")')
await page.waitForSelector('text=/Already settled/i', { timeout: 10000 })
const afterPay = await page.locator('main').innerText()
ck('payment recorded', /Already settled/i.test(afterPay))

// A served order that gets paid is closed automatically by the server, so the badge should
// switch to "Closed". Waited for rather than asserted immediately: the refetch that carries the
// new status is a separate round trip from the one that revealed the payment.
await page.waitForSelector('[data-status="completed"]', { timeout: 10000 }).catch(() => undefined)
ck(
  'order auto-closed on payment',
  (await page.locator('[data-status="completed"]').count()) > 0,
  await page.locator('header').first().innerText(),
)
await page.screenshot({ path: `${SHOT}/a6-paid.png` })

console.log('=== 8. Menu management ===')
await page.click('a[href="/menu"]')
await page.waitForURL('**/menu')
await page.waitForSelector('text=Starters', { timeout: 10000 })
const menuText = await page.locator('main').innerText()
ck('categories listed', /Starters/.test(menuText) && /Beverages/.test(menuText))
// Sold out is a STATE badge on the row now, and the action that undoes it is a positive one --
// the danger tint used to land on the button rather than on the row it described, making the only
// red things on the page the two dishes that were already dealt with.
ck('sold-out dish flagged', /Sold out/.test(menuText))
ck('the dish can be put back on sale', /Back on sale/.test(menuText))

// The one-tap availability toggle, which every role can use.
const firstToggle = page.locator('button:has-text("Mark sold out")').first()
await firstToggle.click()
await page.waitForTimeout(900)
ck('availability toggled', (await page.locator('button:has-text("Back on sale")').count()) >= 3)
await page.locator('button:has-text("Back on sale")').first().click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${SHOT}/a7-menu.png` })

console.log('=== 9. Food type is required on a new dish (PRD 6.2) ===')
await page.locator('button:has-text("+ Add a dish to")').first().click()
await page.waitForSelector('text=Food type', { timeout: 5000 })
// exact: true, deliberately. Every menu row carries an aria-label of "Price of <dish> in rupees",
// so a loose match lands on a live price field and commits a real change on blur.
await page.getByLabel('Price', { exact: true }).fill('199.50')
await page.getByLabel('Dish name').fill('Test Soup')
await page.click('button:has-text("Add dish")')
// A failure announces itself with role=alert now, not role=status -- a rejected save that reads
// like a confirmation is one nobody acts on. Asserted through data-tone, which is a machine value
// rather than copy that will be translated (PRD 7).
await page.waitForSelector('[data-tone=danger]', { timeout: 5000 })
const foodWarn = await page.locator('[data-tone=danger]').first().innerText()
ck(
  'a dish without a food type is refused',
  /veg, non-veg or contains egg/i.test(foodWarn),
  foodWarn,
)

console.log('=== 10. Price input rejects three decimals (D7) ===')
await page.getByLabel('Price', { exact: true }).fill('199.555')
await page.locator('button:has-text("Veg")').first().click()
await page.click('button:has-text("Add dish")')
await page.waitForTimeout(400)
const priceWarn = await page.locator('[data-tone=danger]').first().innerText()
ck('three decimal places rejected, not rounded', /two decimal places/i.test(priceWarn), priceWarn)

console.log('=== 11. Tables and QR (D4) ===')
await page.click('a[href="/tables"]')
await page.waitForURL('**/tables')
await page.waitForSelector('text=Table 1', { timeout: 10000 })
const tablesText = await page.locator('main').innerText()
ck('all tables listed', (await page.locator('li button', { hasText: /^Show QR$/ }).count()) >= 8)
ck('bulk add available', /Add a numbered range/.test(tablesText))
// Scoped to a row: the header's "Print QR sheet" button would open the whole sheet instead of one
// table's code. Rotate no longer sits on the card -- it lives inside this panel now.
await page
  .locator('li button', { hasText: /^Show QR$/ })
  .first()
  .click()
await page.waitForSelector('aside img[alt^="QR code"]', { timeout: 10000 })
ck('QR image rendered', await page.locator('aside img[alt^="QR code"]').first().isVisible())
const qrUrl = await page.locator('aside').innerText()
ck('QR URL points at the diner app', /localhost:3000\/t\//.test(qrUrl), qrUrl.slice(0, 120))
ck('download offered', (await page.locator('a[download]').count()) === 1)
await page.screenshot({ path: `${SHOT}/a8-tables.png` })

console.log('=== 12. Settings states the static-UPI limitation (D2) ===')
await page.click('a[href="/settings"]')
await page.waitForURL('**/settings')
await page.waitForSelector('text=Payments', { timeout: 10000 })
const settingsText = await page.locator('main').innerText()
ck('tax shown as a percentage', /GST/.test(settingsText) && /%/.test(settingsText))
ck(
  'manual-confirmation limitation stated plainly',
  /confirmed by hand|invisible to this system/i.test(settingsText),
  settingsText.slice(0, 200),
)
ck('UPI VPA field present', /UPI ID/.test(settingsText))
await page.screenshot({ path: `${SHOT}/a9-settings.png` })

console.log('=== 13. Staff management is owner-gated ===')
await page.click('a[href="/staff"]')
await page.waitForURL('**/staff')
// Priya, not Rajesh: the shell header shows the signed-in user's own name, so waiting on Rajesh
// resolves against the chrome before the list has loaded.
await page.waitForSelector('main >> text=Priya Sharma', { timeout: 15000 })
const staffText = await page.locator('main').innerText()
ck(
  'all three staff listed',
  /Rajesh Kumar/.test(staffText) && /Priya Sharma/.test(staffText) && /Arun Nair/.test(staffText),
  staffText.replace(/\n+/g, ' | ').slice(0, 260),
)
ck(
  'owner sees the add-staff control',
  (await page.locator('button:has-text("Add staff")').count()) === 1,
)
ck('change-password form present', /Your password/i.test(staffText))
await page.screenshot({ path: `${SHOT}/a10-staff.png` })

console.log('=== 14. A floor-staff account sees less ===')
await page.locator('button:has-text("Sign out")').click()
await page.waitForURL('**/login', { timeout: 10000 })
await page.fill('input[type=email]', 'staff@spicegarden.test')
await page.fill('input[type=password]', 'password123')
await page.click('button:has-text("Sign in")')
await page.waitForURL('**/orders', { timeout: 15000 })
await page.click('a[href="/staff"]')
await page.waitForURL('**/staff')
await page.waitForSelector('main >> text=Priya Sharma', { timeout: 15000 })
ck(
  'floor staff cannot add staff',
  (await page.locator('button:has-text("Add staff")').count()) === 0,
)
await page.click('a[href="/menu"]')
await page.waitForURL('**/menu')
await page.waitForSelector('text=Starters', { timeout: 10000 })
ck(
  'floor staff cannot add dishes',
  (await page.locator('button:has-text("+ Add a dish to")').count()) === 0,
)
ck(
  'floor staff CAN still mark items sold out',
  (await page.locator('button:has-text("Mark sold out")').count()) > 0,
)
ck('read-only notice shown', /Read only/i.test(await page.locator('header').last().innerText()))
await page.screenshot({ path: `${SHOT}/a11-staff-role-menu.png` })

console.log('=== 15. No unexpected console errors ===')
const real = consoleErrors.filter(
  (e) =>
    !/favicon|Download the React DevTools/i.test(e) &&
    // The deliberate wrong-password attempt in step 1 is a real 401 from the API.
    !/status of 40[13]/.test(e),
)
ck('no unexpected console or page errors', real.length === 0, real.slice(0, 3).join(' ~ '))

console.log(`\n===== admin E2E:  PASS ${pass}   FAIL ${fail} =====`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
