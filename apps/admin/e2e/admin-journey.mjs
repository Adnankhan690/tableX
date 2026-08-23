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
console.log(`(seeded order ${orderNumber} on table 5)`)

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
ck('columns rendered', /NEW/i.test(board) && /PREPARING/i.test(board))

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
ck('placed-today tile present', /Placed today/i.test(stats))
ck('avg-to-accept tile present', /Avg. to accept/i.test(stats))
ck('unpaid tile present', /Unpaid/i.test(stats))
await page.screenshot({ path: `${SHOT}/a2-board.png` })

console.log('=== 4. Server-driven action buttons (D1) ===')
const card = page.locator('article', { hasText: orderNumber }).first()
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
  const target = page.locator('article', { hasText: orderNumber }).first()
  await target.locator(`button:has-text("${label}")`).click()
  await page.waitForTimeout(900)
  const text = await page.locator('main').innerText()
  ck(`${label} applied`, new RegExp(expect, 'i').test(text))
}
await page.screenshot({ path: `${SHOT}/a4-board-served.png` })

console.log('=== 7. Order detail and payment settlement (D2) ===')
await page
  .locator('article', { hasText: orderNumber })
  .first()
  .locator('a:has-text("Open order")')
  .click()
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
ck('sold-out dish flagged', /Sold out — restore/.test(menuText))

// The one-tap availability toggle, which every role can use.
const firstToggle = page.locator('button:has-text("Mark sold out")').first()
await firstToggle.click()
await page.waitForTimeout(900)
ck(
  'availability toggled',
  (await page.locator('button:has-text("Sold out — restore")').count()) >= 3,
)
await page.locator('button:has-text("Sold out — restore")').first().click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${SHOT}/a7-menu.png` })

console.log('=== 9. Food type is required on a new dish (PRD 6.2) ===')
await page.locator('button:has-text("+ Add a dish to")').first().click()
await page.waitForSelector('text=Food type', { timeout: 5000 })
await page.fill('input[placeholder="249.50"]', '199.50')
await page.locator('label:has-text("Dish name") input').fill('Test Soup')
await page.click('button:has-text("Add dish")')
await page.waitForSelector('[role=status]', { timeout: 5000 })
const foodWarn = await page.locator('[role=status]').innerText()
ck(
  'a dish without a food type is refused',
  /veg, non-veg or contains egg/i.test(foodWarn),
  foodWarn,
)

console.log('=== 10. Price input rejects three decimals (D7) ===')
await page.fill('input[placeholder="249.50"]', '199.555')
await page.locator('button:has-text("Veg")').first().click()
await page.click('button:has-text("Add dish")')
await page.waitForTimeout(400)
const priceWarn = await page.locator('[role=status]').innerText()
ck('three decimal places rejected, not rounded', /two decimal places/i.test(priceWarn), priceWarn)

console.log('=== 11. Tables and QR (D4) ===')
await page.click('a[href="/tables"]')
await page.waitForURL('**/tables')
await page.waitForSelector('text=Table 1', { timeout: 10000 })
const tablesText = await page.locator('main').innerText()
ck('all tables listed', (await page.locator('li:has-text("Table")').count()) >= 8)
ck('bulk add available', /Add a numbered range/.test(tablesText))
// An exact match: 'has-text("QR")' also matches the header's "Print QR sheet" button, which
// would open the whole print sheet instead of one table's code.
await page.locator('li button', { hasText: /^QR$/ }).first().click()
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
ck('tax shown as a percentage', /GST \(%\)/.test(settingsText))
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
ck('change-password form present', /Change your password/i.test(staffText))
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
