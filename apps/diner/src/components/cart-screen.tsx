'use client'

import type { MenuResponse } from '@tablex/shared'
import { computeTotals, formatBps, formatINR } from '@tablex/shared'
import { EmptyState, FoodTypeBadge, Spinner } from '@tablex/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useCart } from '@/components/providers'
import { QuantityStepper } from '@/components/quantity-stepper'
import { BackLink, BottomBar, PrimaryButton, ScreenHeader } from '@/components/screen'
import { useGatedSession } from '@/components/session-gate'
import { api } from '@/lib/api'
import { totalsInput } from '@/lib/cart'

/** Bill review before payment (PRD 6.3). */
export function CartScreen() {
  const session = useGatedSession()

  const router = useRouter()
  const { cart, setQuantity, remove } = useCart()

  /**
   * The tax and service-charge rates are fetched rather than stored in the cart, so the
   * breakdown reflects the restaurant's current configuration rather than whatever it was when
   * the diner first opened the menu. It is one cached request and the page is usable without
   * it -- if it fails, the rates fall back to zero and the diner still sees line items.
   */
  const [menu, setMenu] = useState<MenuResponse | null>(null)
  /**
   * Tracked separately from `menu` so a failed rate fetch is distinguishable from one still in
   * flight. Without that distinction the total below cannot know whether to wait or to give up.
   */
  const [ratesFailed, setRatesFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api
      .getMenu(session.token, controller.signal)
      .then((fresh) => {
        setMenu(fresh)
        setRatesFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setRatesFailed(true)
      })
    return () => controller.abort()
  }, [session.token])

  const totals = useMemo(() => {
    if (cart === null || menu === null) return null
    return computeTotals(totalsInput(cart), menu.tax_bps, menu.service_charge_bps)
  }, [cart, menu])

  /** The subtotal needs no rates, so it can be shown while they are still loading. */
  const subtotalMinor = useMemo(
    () => cart?.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0) ?? 0,
    [cart],
  )

  if (cart === null) {
    return (
      <>
        <ScreenHeader title="Your order" subtitle={`Table ${session.tableLabel}`} />
        <div className="flex items-center justify-center gap-2 py-24 text-muted">
          <Spinner /> Loading
        </div>
      </>
    )
  }

  if (cart.lines.length === 0) {
    return (
      <>
        <ScreenHeader
          title="Your order"
          subtitle={`Table ${session.tableLabel}`}
          back={<BackLink href="/menu" label="Back to the menu" />}
        />
        <div className="py-16">
          <EmptyState
            title="Your cart is empty"
            description="Add something from the menu to get started."
            action={
              <Link href="/menu" className="text-[0.9375rem] font-medium text-accent">
                Browse the menu
              </Link>
            }
          />
        </div>
      </>
    )
  }

  return (
    <>
      <ScreenHeader
        title="Your order"
        subtitle={`Table ${session.tableLabel}`}
        back={<BackLink href="/menu" label="Back to the menu" />}
      />

      <main className="pb-bar">
        <ul>
          {cart.lines.map((line) => (
            <li key={line.menuItemUid} className="flex gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <FoodTypeBadge type={line.foodType} size={13} />
                  <p className="truncate text-[0.9375rem] font-semibold">{line.name}</p>
                </div>
                <p className="mt-0.5 text-[0.8125rem] text-muted tabular-nums">
                  {formatINR(line.unitPriceMinor)} each
                </p>
                {line.note ? (
                  <p className="mt-0.5 text-[0.8125rem] italic text-muted">“{line.note}”</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(line.menuItemUid)}
                  className="mt-1 text-[0.8125rem] font-medium text-nonveg"
                >
                  Remove
                </button>
              </div>

              <div className="flex flex-col items-end justify-between gap-2">
                <p className="text-[0.9375rem] font-semibold tabular-nums">
                  {formatINR(line.unitPriceMinor * line.quantity)}
                </p>
                <QuantityStepper
                  quantity={line.quantity}
                  label={line.name}
                  onChange={(next) => setQuantity(line.menuItemUid, next)}
                />
              </div>
            </li>
          ))}
        </ul>

        <section className="px-4 py-4" aria-label="Bill total">
          <Row label="Subtotal" value={formatINR(subtotalMinor)} />

          {/*
            A "Total" is shown only once the tax rates have loaded. Rendering the subtotal under
            a Total label while they are in flight would put a number in front of the diner that
            is lower than what they will be charged -- and a bill that goes up after the fact is
            precisely the surprise this screen exists to prevent.
          */}
          {totals !== null && menu !== null ? (
            <>
              {menu.tax_bps > 0 ? (
                <Row
                  // The rate is named, not just the amount. An unexplained line on a bill is the
                  // thing diners query at the counter.
                  label={`GST (${formatBps(menu.tax_bps)})`}
                  value={formatINR(totals.taxMinor)}
                />
              ) : null}
              {menu.service_charge_bps > 0 ? (
                <Row
                  label={`Service charge (${formatBps(menu.service_charge_bps)})`}
                  value={formatINR(totals.serviceChargeMinor)}
                />
              ) : null}
              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
                <span className="text-[1.0625rem] font-semibold">Total</span>
                <span className="text-[1.0625rem] font-semibold tabular-nums">
                  {formatINR(totals.totalMinor)}
                </span>
              </div>
            </>
          ) : (
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2 text-muted">
              <span className="text-[0.9375rem]">Taxes</span>
              <span className="text-[0.9375rem]">
                {ratesFailed ? 'shown at checkout' : 'calculating…'}
              </span>
            </div>
          )}

          {/*
            Stated plainly rather than buried. The figure above is computed on the phone from
            prices captured when each item was added, and the server re-prices the order at
            placement (docs/DECISIONS.md D7). They agree unless the kitchen changed a price
            mid-visit, and the diner should not be surprised if that happens.
          */}
          <p className="mt-2 text-[0.75rem] leading-snug text-muted">
            Your final bill is confirmed when you place the order.
          </p>
        </section>
      </main>

      <BottomBar>
        <PrimaryButton onClick={() => router.push('/checkout')}>
          {totals !== null
            ? `Proceed to payment · ${formatINR(totals.totalMinor)}`
            : 'Proceed to payment'}
        </PrimaryButton>
      </BottomBar>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[0.9375rem] text-muted">{label}</span>
      <span className="text-[0.9375rem] tabular-nums">{value}</span>
    </div>
  )
}
