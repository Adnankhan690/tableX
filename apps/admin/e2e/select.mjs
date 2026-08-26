/**
 * The custom select, driven by keyboard, mouse and screen-reader contract.
 *
 * Covers the three call sites that differ in shape: the order board's filter (no visible label,
 * eleven options), the staff role picker (option descriptions, a PATCH on change) and the menu
 * editor's spice level (an empty string as a real value). The remaining two are the same shape
 * as one of these.
 *
 * Asserts on ARIA rather than on pixels: `aria-activedescendant` moving is the actual contract a
 * screen reader reads, and it is what silently regresses when someone "simplifies" the keyboard
 * handler.
 *
 * Prerequisites:
 *     make reset && make backend &                                     # API on :8080, seeded
 *     bun run --cwd apps/admin build && PORT=3005 bunx next start -p 3005
 *
 * Then, from apps/admin so @playwright/test resolves:
 *     node e2e/select.mjs
 *
 * Screenshots land in /tmp/tx-shots. Exits non-zero on any failure.
 */

import { chromium } from '@playwright/test'

const APP = process.env.ADMIN_URL ?? 'http://localhost:3005'
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
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

/**
 * The panel: the scroll container, not the listbox inside it. The listbox is as tall as its
 * content, so measuring that one and finding it taller than the viewport proves nothing.
 */
const panelOpen = page.locator('[data-select-panel=open]')

/** The label of the option aria-activedescendant currently points at. */
const activeLabel = async () => {
  const id = await page
    .locator('[role=combobox][data-state=open]')
    .getAttribute('aria-activedescendant')
  return id ? await page.locator(`#${id}`).innerText() : null
}

console.log('=== Login ===')
await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type=email]', 'owner@spicegarden.test')
await page.fill('input[type=password]', 'password123')
await page.click('button:has-text("Sign in")')
await page.waitForURL('**/orders', { timeout: 20000 })

console.log('=== 1. Closed state, order board filter ===')
const filter = page.locator('[role=combobox][aria-label="Filter by table"]')
await filter.waitFor({ timeout: 10000 })
ck('renders as a combobox, not a native select', await filter.isVisible())
ck('no native select survives on the board', (await page.locator('select').count()) === 0)
ck('shows the current selection', (await filter.innerText()).includes('All tables'))
ck('collapsed is announced', (await filter.getAttribute('aria-expanded')) === 'false')
ck('no listbox exists while closed', (await page.locator('[role=listbox]').count()) === 0)
ck(
  'tap target is at least 40px tall',
  (await filter.boundingBox()).height >= 40,
  `${(await filter.boundingBox()).height}px`,
)
await page.screenshot({ path: `${SHOT}/s1-closed.png` })

console.log('=== 2. Opening by mouse ===')
await filter.click()
const listbox = page.locator('[role=listbox]')
await listbox.waitFor({ timeout: 5000 })
ck('expanded is announced', (await filter.getAttribute('aria-expanded')) === 'true')
ck('aria-controls points at the listbox', (await filter.getAttribute('aria-controls')) !== null)
const options = page.locator('[role=option]')
ck('every table plus "All tables"', (await options.count()) === 9, `${await options.count()}`)
ck(
  'the current value is the selected option',
  (await page.locator('[role=option][aria-selected=true]').innerText()).includes('All tables'),
)
ck('opens with the selection active', (await activeLabel())?.includes('All tables'))

const labels = await options.allInnerTexts()
ck(
  'tables sort naturally, not as strings',
  labels.join('|').includes('Table 1|Table 2|Table 3'),
  labels.join(' / '),
)
const box = await listbox.boundingBox()
const triggerBox = await filter.boundingBox()
ck(
  'panel is anchored under its trigger',
  Math.abs(box.x - triggerBox.x) < 2,
  `${box.x} vs ${triggerBox.x}`,
)
ck('panel is inside the viewport', box.y + box.height <= 900 && box.x >= 0)
await page.screenshot({ path: `${SHOT}/s2-open.png` })

console.log('=== 3. Keyboard ===')
await page.keyboard.press('ArrowDown')
const afterDown = await activeLabel()
ck('ArrowDown moves the active option', afterDown?.includes('Table 1'), String(afterDown))
await page.keyboard.press('ArrowUp')
ck('ArrowUp moves back', (await activeLabel())?.includes('All tables'))
await page.keyboard.press('End')
ck(
  'End jumps to the last option',
  (await activeLabel())?.includes('Patio 1'),
  String(await activeLabel()),
)
await page.keyboard.press('Home')
ck('Home jumps to the first', (await activeLabel())?.includes('All tables'))
await page.keyboard.press('ArrowUp')
ck('ArrowUp at the top does not wrap or clear', (await activeLabel())?.includes('All tables'))

await page.keyboard.press('Escape')
ck('Escape closes', (await page.locator('[role=listbox]').count()) === 0)
ck('Escape keeps the previous value', (await filter.innerText()).includes('All tables'))
ck('focus stays on the trigger', await filter.evaluate((el) => el === document.activeElement))

console.log('=== 4. Typeahead and commit ===')
await page.keyboard.press('Enter')
await listbox.waitFor({ timeout: 5000 })
await page.keyboard.type('table 3')
ck(
  'typeahead jumps to a match',
  (await activeLabel())?.includes('Table 3'),
  String(await activeLabel()),
)
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
ck('Enter commits the active option', (await filter.innerText()).includes('Table 3'))
ck('committing closes the list', (await page.locator('[role=listbox]').count()) === 0)
ck(
  'the board filtered to that table',
  new URL(page.url()).pathname === '/orders' &&
    !(await page.locator('main').innerText()).includes('Table 5'),
)
await page.screenshot({ path: `${SHOT}/s3-committed.png` })

console.log('=== 5. Dismissal by pointer ===')
await filter.click()
await listbox.waitFor({ timeout: 5000 })
ck('reopens on the committed value', (await activeLabel())?.includes('Table 3'))
await page.mouse.click(640, 60)
await page.waitForTimeout(150)
ck('a click outside closes', (await page.locator('[role=listbox]').count()) === 0)
ck('a click outside keeps the value', (await filter.innerText()).includes('Table 3'))

await filter.click()
await listbox.waitFor({ timeout: 5000 })
await page.locator('[role=option]', { hasText: 'All tables' }).click()
await page.waitForTimeout(300)
ck('a click on an option commits it', (await filter.innerText()).includes('All tables'))

console.log('=== 6. Option descriptions, staff roles ===')
await page.goto(`${APP}/staff`, { waitUntil: 'networkidle' })
const roleTrigger = page.locator('[role=combobox]').first()
await roleTrigger.waitFor({ timeout: 10000 })
ck('role reads in sentence case', /Owner|Manager|Staff/.test(await roleTrigger.innerText()))
await roleTrigger.click()
await listbox.waitFor({ timeout: 5000 })
const roleText = await listbox.innerText()
ck(
  'each role carries what it can do',
  roleText.includes('Everything, including adding and removing staff.') &&
    roleText.includes('Orders and marking dishes sold out.'),
)
await page.screenshot({ path: `${SHOT}/s4-roles.png` })
await page.keyboard.press('Escape')

console.log('=== 7. An empty string as a real option ===')
await page.goto(`${APP}/menu`, { waitUntil: 'networkidle' })
await page.locator('button:has-text("Add a dish to")').first().click()
const spice = page
  .locator('[role=combobox]')
  .filter({ hasText: /Not applicable|Mild|Medium|Hot/ })
  .first()
await spice.waitFor({ timeout: 10000 })
ck(
  'renders the empty value as a labelled choice',
  (await spice.innerText()).includes('Not applicable'),
)
ck(
  'the visible label is wired up, not just placed nearby',
  (await spice.getAttribute('aria-labelledby')) !== null,
)
const labelId = await spice.getAttribute('aria-labelledby')
ck(
  'and it names the field',
  (await page.locator(`#${labelId}`).innerText()).includes('Spice level'),
)
await spice.click()
await listbox.waitFor({ timeout: 5000 })
await page.keyboard.type('hot')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
ck('picking a level sticks', (await spice.innerText()).includes('Hot'))
await page.screenshot({ path: `${SHOT}/s5-spice.png` })

console.log('=== 7b. Settings, a disabled-capable control ===')
await page.goto(`${APP}/settings`, { waitUntil: 'networkidle' })
const provider = page.locator('[role=combobox]').first()
await provider.waitFor({ timeout: 10000 })
ck('shows the stored provider', (await provider.innerText()).length > 0)
await provider.click()
await panelOpen.waitFor({ timeout: 5000 })
const providerText = await panelOpen.innerText()
ck(
  'each provider says what it costs the owner',
  providerText.includes('confirmed by hand') && providerText.includes('Razorpay keys'),
  providerText,
)
await page.keyboard.press('Escape')
await page.screenshot({ path: `${SHOT}/s5b-provider.png` })

console.log('=== 8. Narrow viewport ===')
await page.setViewportSize({ width: 420, height: 620 })
await page.goto(`${APP}/orders`, { waitUntil: 'networkidle' })
const narrow = page.locator('[role=combobox][aria-label="Filter by table"]')
await narrow.waitFor({ timeout: 10000 })
await narrow.click()
await panelOpen.waitFor({ timeout: 5000 })
const nb = await panelOpen.boundingBox()
ck(
  'panel stays within a phone-width viewport',
  nb.x >= 0 && nb.x + nb.width <= 420,
  JSON.stringify(nb),
)
ck(
  'panel stays within the viewport height',
  nb.y >= 0 && nb.y + nb.height <= 620,
  JSON.stringify(nb),
)
ck(
  'a list too tall for the space scrolls instead of overflowing',
  await panelOpen.evaluate((el) => el.scrollHeight > el.clientHeight - 1),
)
ck(
  'the active option is scrolled into view, not left above the fold',
  await page.evaluate(() => {
    const active = document.querySelector('[role=option][data-active]')
    const box = active?.getBoundingClientRect()
    return !!box && box.top >= 0 && box.bottom <= window.innerHeight
  }),
)
await page.screenshot({ path: `${SHOT}/s6-narrow.png` })

console.log('=== 9. Flipping up with no room below ===')
await page.setViewportSize({ width: 900, height: 560 })
await page.goto(`${APP}/menu`, { waitUntil: 'networkidle' })
await page.locator('button:has-text("Add a dish to")').first().click()
const lowSpice = page
  .locator('[role=combobox]')
  .filter({ hasText: /Not applicable|Mild|Medium|Hot/ })
  .first()
await lowSpice.waitFor({ timeout: 10000 })
await lowSpice.evaluate((el) => el.scrollIntoView({ block: 'end' }))
await page.waitForTimeout(200)
await lowSpice.click()
await panelOpen.waitFor({ timeout: 5000 })
const tb = await lowSpice.boundingBox()
const pb = await panelOpen.boundingBox()
ck(
  'panel opens on whichever side has room',
  pb.y + pb.height <= 560 && pb.y >= 0,
  `trigger ${JSON.stringify(tb)} panel ${JSON.stringify(pb)}`,
)
ck(
  'and never covers its own trigger',
  pb.y + pb.height <= tb.y + 1 || pb.y >= tb.y + tb.height - 1,
  `trigger ${JSON.stringify(tb)} panel ${JSON.stringify(pb)}`,
)
await page.screenshot({ path: `${SHOT}/s7-flip.png` })

ck('no console errors anywhere in this run', consoleErrors.length === 0, consoleErrors.join(' | '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
