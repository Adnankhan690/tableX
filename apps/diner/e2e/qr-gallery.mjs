/**
 * The QR gallery, and the multi-tenant path it exercises.
 *
 * The QR rendering is the small half of this. The valuable half is everything after the scan:
 * picking a table at the SECOND restaurant must load that restaurant's menu, with its own tax and
 * service-charge rates, and none of the first restaurant's dishes. With a single tenant every query
 * returns the right rows by accident, so this is the check that proves the restaurant_id scoping in
 * DECISIONS.md D3 actually holds.
 *
 * Prerequisites: a seeded database (both restaurants), the API on :8080, the diner app on :3000.
 *
 *     cd apps/diner && node e2e/qr-gallery.mjs
 */

import { chromium, devices } from '@playwright/test'

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
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage()
const errs = []
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text())
})
page.on('pageerror', (e) => errs.push(String(e)))

console.log('=== /qr renders both restaurants ===')
await page.goto('http://localhost:3000/qr', { waitUntil: 'networkidle' })
await page.waitForSelector('img[alt^="QR code to order"]', { timeout: 20000 })
const imgs = await page.locator('img[alt^="QR code to order"]').count()
ck('two QR codes rendered', imgs === 2, `${imgs} found`)
const body = await page.locator('main').innerText()
ck('Spice Garden listed', /Spice Garden/.test(body))
ck('Coastal Curry listed', /Coastal Curry/.test(body))
ck('encoded URL shown', /localhost:3000\/r\/spice-garden/.test(body))
ck('table-picker caveat present', /choosing the wrong one/i.test(body))
await page.screenshot({ path: '/tmp/tx-shots/q1-qr-gallery.png', fullPage: true })

console.log('=== the QR target actually works (restaurant 2) ===')
await page.goto('http://localhost:3000/r/coastal-curry', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Which table are you at?', { timeout: 15000 })
const tables = await page.locator('button:has-text("Table")').count()
ck('Coastal Curry table picker opens', tables === 4, `${tables} tables`)
ck(
  'header names the right restaurant',
  /Coastal Curry/.test(await page.locator('header').innerText()),
)
await page.screenshot({ path: '/tmp/tx-shots/q2-coastal-tables.png' })

console.log("=== pick a table -> its own menu, not the other restaurant's ===")
await page.locator('button:has-text("Table")').first().click()
await page.waitForURL('**/menu', { timeout: 20000 })
await page.waitForSelector('text=Coastal Curry', { timeout: 15000 })
const menu = await page.locator('main').innerText()
ck('Coastal Curry menu loaded', /Meen Curry|Neer Dosa|Anjal Fish Fry/.test(menu))
ck('no Spice Garden dishes leaked in', !/Paneer Tikka|Butter Chicken|Gulab Jamun/.test(menu))
ck('its own category appears', /CURRIES/i.test(menu))
await page.screenshot({ path: '/tmp/tx-shots/q3-coastal-menu.png' })

console.log('=== its 10% service charge reaches the cart ===')
await page.locator('li', { hasText: 'Neer Dosa' }).first().locator('button:text("Add")').click()
await page.waitForTimeout(400)
await page.click('a[href="/cart"]')
await page.waitForSelector('text=/Service charge \\(10%\\)/', { timeout: 15000 })
const cart = await page.locator('main').innerText()
ck('service charge line shown at 10%', /Service charge \(10%\)/.test(cart))
ck('GST line shown at 5%', /GST \(5%\)/.test(cart))
// Neer Dosa 90.00 -> GST 4.50 -> service 9.00 -> total 103.50
ck(
  "totals use this restaurant's rates",
  /103\.50/.test(cart),
  cart.replace(/\n/g, ' | ').slice(0, 200),
)
await page.screenshot({ path: '/tmp/tx-shots/q4-coastal-cart.png' })

const real = errs.filter((e) => !/favicon|DevTools|status of 40/.test(e))
ck('no unexpected console errors', real.length === 0, real.slice(0, 2).join(' ~ '))

console.log(`\n===== /qr check:  PASS ${pass}   FAIL ${fail} =====`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
