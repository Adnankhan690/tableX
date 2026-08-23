import type { FoodType, MenuItemView } from '@tablex/shared'
import { readStored, removeStored, writeStored } from './session'

/**
 * The cart, held entirely in the browser (PRD 6.3).
 *
 * Nothing about a cart reaches the server until checkout, which is what makes adding an item
 * instant on a 3G connection -- and it is why the cart carries a price snapshot at all: the
 * subtotal has to be recomputable offline as the diner taps + and -.
 *
 * Those snapshotted prices are for DISPLAY ONLY. The server re-prices the whole order from
 * the live menu at placement, which is why `PlaceOrderRequest` has no amount field
 * (docs/DECISIONS.md D7). If the two disagree -- a price changed while the diner browsed --
 * the server's answer is the bill, and the cart was simply showing a stale estimate.
 */
export interface CartLine {
  menuItemUid: string
  name: string
  /** Paise, snapshotted when the line was added. Display only. */
  unitPriceMinor: number
  foodType: FoodType
  quantity: number
  note?: string
}

export interface Cart {
  /** The table this cart belongs to. */
  tableUid: string
  lines: CartLine[]
}

/**
 * Carts are keyed by table, not stored as one global cart.
 *
 * A diner who moves tables and rescans must not inherit the previous table's half-built
 * order -- they would send someone else's food to their own table. Keying by table makes
 * that structurally impossible rather than something the UI has to remember to clear.
 */
function cartKey(tableUid: string): string {
  return `tablex.cart.v1.${tableUid}`
}

/** Bounds enforced by the API; mirrored here so the UI can stop before a rejected request. */
export const MAX_LINES = 50
export const MAX_QUANTITY = 99

const emptyCart = (tableUid: string): Cart => ({ tableUid, lines: [] })

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false
  return (
    'menuItemUid' in value &&
    typeof value.menuItemUid === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'unitPriceMinor' in value &&
    typeof value.unitPriceMinor === 'number' &&
    Number.isFinite(value.unitPriceMinor) &&
    'foodType' in value &&
    typeof value.foodType === 'string' &&
    'quantity' in value &&
    typeof value.quantity === 'number' &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0
  )
}

/**
 * Reads the cart for a table.
 *
 * Anything unparseable yields an empty cart rather than throwing. A diner whose stored cart
 * is corrupt should see an empty cart and be able to order, not a crashed page -- and the
 * validation is per-line so one bad entry does not discard the rest of the order.
 */
export function readCart(tableUid: string): Cart {
  const raw = readStored(cartKey(tableUid))
  if (raw === null) return emptyCart(tableUid)

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('lines' in parsed)) {
      return emptyCart(tableUid)
    }
    const lines = parsed.lines
    if (!Array.isArray(lines)) return emptyCart(tableUid)

    return { tableUid, lines: lines.filter(isCartLine).slice(0, MAX_LINES) }
  } catch {
    return emptyCart(tableUid)
  }
}

export function writeCart(cart: Cart): void {
  writeStored(cartKey(cart.tableUid), JSON.stringify(cart))
}

export function clearCart(tableUid: string): void {
  removeStored(cartKey(tableUid))
}

// --- Pure transforms ---
//
// Every function below returns a new Cart rather than mutating. React state updates depend on
// identity changing, and an in-place push would leave the sticky cart bar showing a stale
// count -- a bug that only appears once and is then very hard to attribute.

/** Adds one of an item, or increments it if already present. */
export function addLine(cart: Cart, item: MenuItemView, note?: string): Cart {
  const existing = cart.lines.find((line) => line.menuItemUid === item.uid)

  if (existing) {
    return setQuantity(cart, item.uid, existing.quantity + 1)
  }
  if (cart.lines.length >= MAX_LINES) {
    // Silently refusing is better than an error dialog: the API would reject a 51st line
    // anyway, and no real order reaches fifty distinct dishes by accident.
    return cart
  }

  return {
    ...cart,
    lines: [
      ...cart.lines,
      {
        menuItemUid: item.uid,
        name: item.name,
        unitPriceMinor: item.price.minor,
        foodType: item.food_type,
        quantity: 1,
        ...(note ? { note } : {}),
      },
    ],
  }
}

/** Sets an exact quantity. Zero or less removes the line, which is what the stepper needs. */
export function setQuantity(cart: Cart, menuItemUid: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, menuItemUid)

  const clamped = Math.min(quantity, MAX_QUANTITY)
  return {
    ...cart,
    lines: cart.lines.map((line) =>
      line.menuItemUid === menuItemUid ? { ...line, quantity: clamped } : line,
    ),
  }
}

export function removeLine(cart: Cart, menuItemUid: string): Cart {
  return {
    ...cart,
    lines: cart.lines.filter((line) => line.menuItemUid !== menuItemUid),
  }
}

export function setNote(cart: Cart, menuItemUid: string, note: string): Cart {
  return {
    ...cart,
    lines: cart.lines.map((line) =>
      line.menuItemUid === menuItemUid ? { ...line, note: note || undefined } : line,
    ),
  }
}

/** Total number of items, not lines -- this is the number on the cart badge. */
export function cartCount(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0)
}

export function quantityOf(cart: Cart, menuItemUid: string): number {
  return cart.lines.find((line) => line.menuItemUid === menuItemUid)?.quantity ?? 0
}

/** Shapes the cart for `computeTotals` from @tablex/shared. */
export function totalsInput(cart: Cart): Array<{ unitPriceMinor: number; quantity: number }> {
  return cart.lines.map((line) => ({
    unitPriceMinor: line.unitPriceMinor,
    quantity: line.quantity,
  }))
}

/** Shapes the cart for the API's `PlaceOrderRequest`. */
export function toOrderItems(cart: Cart): Array<{
  menu_item_uid: string
  quantity: number
  note?: string
}> {
  return cart.lines.map((line) => ({
    menu_item_uid: line.menuItemUid,
    quantity: line.quantity,
    ...(line.note ? { note: line.note } : {}),
  }))
}
