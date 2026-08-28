/**
 * The rating journey, driven in a real mobile browser (PRD 6.5).
 *
 * Separate from diner-journey.mjs because it needs an order that has REACHED THE TABLE, and
 * getting one there means driving four staff transitions through the admin API. Folding that
 * into the diner narrative would put a staff login in the middle of a script whose whole point
 * is that the diner never sees one.
 *
 * Like the other journeys it runs against a real backend with nothing stubbed, so it is what
 * would catch the review DTOs drifting from their hand-mirrored TypeScript.
 *
 * The claim it exists to defend is the product one: A COMPLETE REVIEW COSTS ONE TAP. If a
 * Submit button ever appears in this flow, "a single tap saved it" is the assertion that fails.
 *
 * Prerequisites:
 *     make reset                       # seeded database
 *     make backend &                   # API on :8080
 *     bun run --cwd apps/diner build && bun run --cwd apps/diner start   # app on :3000
 *
 * Then:
 *     cd apps/diner && node e2e/rating-journey.mjs
 *
 * Screenshots land in /tmp/tx-shots. Exits non-zero on any failure.
 */
import { chromium, devices } from '@playwright/test'

const API = 'http://localhost:8080'
const APP = 'http://localhost:3000'
const QR = 'demolocaltablequrtoken0000000002'
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
const j = async (r) => (await r.json()).data

// --- open the browser and scan FIRST ---
//
// Order of operations matters here and cost an hour the first time. The order has to belong to
// the session the BROWSER holds, so the scan happens in the browser and the token is read back
// out of localStorage. Scanning over the API instead mints a second, unrelated session, and the
// tracking screen then correctly answers 404 -- ownership is verified on every order read
// (docs/DECISIONS.md D4), so the test would be exercising the security check rather than the
// rating card.
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(`${APP}/t/${QR}`, { waitUntil: 'networkidle' })
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('tablex.session.v1')).token)

// --- seed an order on that session and walk it to served ---
const scan = await j(
  await fetch(`${API}/api/guest/v1/menu`, { headers: { 'X-Guest-Token': token } }).then((r) => r),
)
const items = scan.categories.flatMap((c) => c.items).filter((i) => i.is_available)
const body = {
  items: [
    { menu_item_uid: items[0].uid, quantity: 2 },
    { menu_item_uid: items[1].uid, quantity: 1 },
  ],
  payment_method: 'counter',
}
const placed = await j(
  await fetch(`${API}/api/guest/v1/orders`, {
    method: 'POST',
    headers: {
      'X-Guest-Token': token,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  }),
)
const orderUid = placed.order.uid
const login = await j(
  await fetch(`${API}/api/admin/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@spicegarden.test', password: 'password123' }),
  }),
)
for (const status of ['accepted', 'preparing', 'ready', 'served']) {
  await fetch(`${API}/api/admin/v1/orders/${orderUid}/transition`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}
console.log(`  seeded order ${placed.order.order_number} at status served`)

// --- drive the UI ---
await page.goto(`${APP}/orders/${orderUid}`, { waitUntil: 'networkidle' })
await page.waitForSelector('text=How was it?', { timeout: 15000 })

console.log('=== The rating card appears on a served order ===')
ck('card is shown', await page.locator('text=How was it?').isVisible())
// Asserts the CLAIM, not the copy. The card used to carry a line saying it saved as you go and
// this checked for that sentence, which made it a test of the wording -- it would have gone red
// on a rewrite that changed nothing a diner experiences, and stayed green on a Submit button
// appearing beside the reassuring text. What actually has to hold is that there is nothing to
// submit.
const cardButtons = await page.locator('section:has-text("How was it?") button').allInnerTexts()
ck(
  'nothing in the card asks to be submitted',
  !cardButtons.some((t) => /submit|send|done|save/i.test(t)),
  cardButtons.join(' | '),
)
const groups = await page.locator('[role="radiogroup"]').count()
ck('one star row per dish', groups === 2, `found ${groups}`)
await page.screenshot({ path: `${SHOT}/r1-card.png`, fullPage: true })

console.log('=== One tap is a complete review ===')
await page.locator('[role="radiogroup"]').first().locator('[role="radio"]').nth(4).click()
await page.waitForSelector('text=Saved', { timeout: 10000 })
ck('a single tap saved it', await page.locator('text=Saved').first().isVisible())
ck('the word for the score is shown', /Loved it/.test(await page.locator('main').innerText()))
ck('tags appear only after rating', (await page.locator('text=Worth the wait').count()) > 0)
await page.screenshot({ path: `${SHOT}/r2-rated.png`, fullPage: true })

console.log('=== Tags are polarity-matched to the score ===')
// Two stars on the SECOND dish, while the first still holds five. Scoped to that dish's own
// row rather than to `main`: the first dish's positive tags are legitimately on the page, so a
// page-wide regex cannot tell "offered for this dish" from "present somewhere".
await page.locator('[role="radiogroup"]').nth(1).locator('[role="radio"]').nth(1).click()
await page.waitForTimeout(1200)
const lowRow = await page.locator('li:has([role="radiogroup"])').nth(1).innerText()
const highRow = await page.locator('li:has([role="radiogroup"])').nth(0).innerText()
ck(
  'a low score offers the negative set',
  /Too spicy|Served cold/.test(lowRow),
  lowRow.replace(/\n+/g, ' | '),
)
ck(
  'and not the positive one',
  !/Worth the wait|Well presented/.test(lowRow),
  lowRow.replace(/\n+/g, ' | '),
)
ck(
  'while a high score on another dish still offers the positive set',
  /Worth the wait/.test(highRow),
)
await page.screenshot({ path: `${SHOT}/r3-low.png`, fullPage: true })

console.log('=== It survives a reload ===')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=How was it?', { timeout: 15000 })
const after = await page.locator('main').innerText()
ck('the stars given are still shown', /Loved it/.test(after) && /Not great/.test(after))
await page.screenshot({ path: `${SHOT}/r4-reloaded.png`, fullPage: true })

console.log('=== The orders list reflects it ===')
await page.goto(`${APP}/orders`, { waitUntil: 'networkidle' })
const list = await page.locator('main').innerText()
ck('list says the order was rated', /Thanks for rating|dishes rated/.test(list), list.slice(0, 200))
await page.screenshot({ path: `${SHOT}/r5-list.png`, fullPage: true })

ck('no console errors', errors.length === 0, errors.join(' | ').slice(0, 200))

await browser.close()
console.log(`\n===== rating E2E:  PASS ${pass}   FAIL ${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
