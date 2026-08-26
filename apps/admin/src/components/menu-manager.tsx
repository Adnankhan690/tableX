'use client'

import { isApiError } from '@tablex/api-client'
import type {
  AdminMenuCategoryView,
  AdminMenuItemView,
  CreateMenuItemRequest,
  FoodType,
  SpiceLevel,
} from '@tablex/shared'
import { FOOD_TYPE_LABEL } from '@tablex/shared'
import { cn, EmptyState, ErrorState, FoodTypeBadge, Spinner } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { Select, type SelectOption } from '@/components/select'
import { api } from '@/lib/api'
import { formatMinorForInput, parsePriceToMinor } from '@/lib/price-input'

const FOOD_TYPES: readonly FoodType[] = ['veg', 'non_veg', 'egg']
const SPICE_LEVELS: readonly SpiceLevel[] = ['mild', 'medium', 'hot']

/**
 * Spice options. "Not applicable" is first and is a real choice, not a placeholder: a naan has no
 * heat level, and the server stores the absence rather than a zero.
 */
const SPICE_OPTIONS: readonly SelectOption<SpiceLevel | ''>[] = [
  { value: '', label: 'Not applicable' },
  ...SPICE_LEVELS.map((level) => ({
    value: level,
    label: level.charAt(0).toUpperCase() + level.slice(1),
  })),
]

interface ItemDraft {
  categoryUid: string
  name: string
  description: string
  price: string
  /**
   * Null, not a default.
   *
   * Food type is required and has no sensible default: guessing "veg" would mislabel meat, and
   * guessing "non_veg" would hide vegetarian dishes from diners filtering for them. In this
   * market an unlabelled or mislabelled dish is simply not orderable for a large share of
   * customers (PRD 6.2), so the manager has to choose.
   */
  foodType: FoodType | null
  spiceLevel: SpiceLevel | ''
  prepTime: string
}

const emptyDraft = (categoryUid: string): ItemDraft => ({
  categoryUid,
  name: '',
  description: '',
  price: '',
  foodType: null,
  spiceLevel: '',
  prepTime: '',
})

export function MenuManager() {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [categories, setCategories] = useState<AdminMenuCategoryView[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<ItemDraft | null>(null)
  const [newCategory, setNewCategory] = useState('')

  const canEdit = auth?.staff.role === 'owner' || auth?.staff.role === 'manager'

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .getMenu(token)
        .then((result) => {
          setCategories(result.categories)
          setError(null)
        })
        .catch(setError)
    })
  }, [getToken])

  useEffect(() => {
    load()
  }, [load])

  /**
   * The sold-out toggle. Every role can use it, unlike the rest of this screen: marking a dish
   * unavailable is a floor action taken mid-service, and routing it through a manager means
   * diners keep ordering something the kitchen ran out of.
   */
  const toggleAvailability = useCallback(
    (item: AdminMenuItemView) => {
      setBusy(true)
      getToken().then((token) => {
        if (!token) {
          setBusy(false)
          return
        }
        api
          .setAvailability(token, item.uid, !item.is_available)
          .then(() => {
            setBusy(false)
            load()
          })
          .catch((err: unknown) => {
            setBusy(false)
            setNotice(isApiError(err) ? err.message : 'Could not update availability.')
          })
      })
    },
    [getToken, load],
  )

  const createItem = useCallback(() => {
    if (draft === null) return

    const priceResult = parsePriceToMinor(draft.price)
    if (!priceResult.ok) {
      setNotice(priceResult.error)
      return
    }
    if (draft.foodType === null) {
      setNotice('Choose veg, non-veg or contains egg — diners filter on this.')
      return
    }

    const body: CreateMenuItemRequest = {
      category_uid: draft.categoryUid,
      name: draft.name.trim(),
      price_minor: priceResult.minor,
      food_type: draft.foodType,
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.spiceLevel ? { spice_level: draft.spiceLevel } : {}),
      ...(draft.prepTime ? { prep_time_mins: Number.parseInt(draft.prepTime, 10) } : {}),
    }

    setBusy(true)
    setNotice(null)
    getToken().then((token) => {
      if (!token) {
        setBusy(false)
        return
      }
      api
        .createItem(token, body)
        .then(() => {
          setDraft(null)
          setBusy(false)
          load()
        })
        .catch((err: unknown) => {
          setBusy(false)
          setNotice(isApiError(err) ? err.message : 'Could not add the dish.')
        })
    })
  }, [draft, getToken, load])

  const createCategory = useCallback(() => {
    const name = newCategory.trim()
    if (!name) return

    setBusy(true)
    getToken().then((token) => {
      if (!token) {
        setBusy(false)
        return
      }
      api
        .createCategory(token, { name })
        .then(() => {
          setNewCategory('')
          setBusy(false)
          load()
        })
        .catch((err: unknown) => {
          setBusy(false)
          setNotice(isApiError(err) ? err.message : 'Could not add the category.')
        })
    })
  }, [newCategory, getToken, load])

  const updatePrice = useCallback(
    (item: AdminMenuItemView, raw: string) => {
      const result = parsePriceToMinor(raw)
      if (!result.ok) {
        setNotice(result.error)
        return
      }
      if (result.minor === item.price.minor) return

      setBusy(true)
      getToken().then((token) => {
        if (!token) {
          setBusy(false)
          return
        }
        api
          .updateItem(token, item.uid, { price_minor: result.minor })
          .then(() => {
            setBusy(false)
            load()
          })
          .catch((err: unknown) => {
            setBusy(false)
            setNotice(isApiError(err) ? err.message : 'Could not update the price.')
          })
      })
    },
    [getToken, load],
  )

  if (auth === null) return null

  return (
    <>
      <PageHeader
        title="Menu"
        subtitle={canEdit ? undefined : 'Read only — ask an owner or manager to make changes'}
      />

      {notice !== null ? (
        <p
          role="status"
          className="border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent"
        >
          {notice}
        </p>
      ) : null}

      <main className="space-y-3 p-4">
        {error !== null ? (
          <ErrorState
            message={isApiError(error) ? error.message : 'Could not load the menu.'}
            {...(isApiError(error) && error.code ? { code: error.code } : {})}
            onRetry={load}
          />
        ) : categories === null ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Spinner /> Loading the menu
          </div>
        ) : categories.length === 0 ? (
          <EmptyState title="No categories yet" description="Add one to start building the menu." />
        ) : (
          categories.map((category) => {
            const isCollapsed = collapsed[category.uid] === true
            return (
              <section
                key={category.uid}
                className="overflow-hidden rounded-card border border-line bg-surface"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({
                      ...c,
                      [category.uid]: !isCollapsed,
                    }))
                  }
                  className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
                >
                  <span className="text-sm font-semibold">
                    {category.name}
                    <span className="ml-2 font-normal text-muted">
                      {category.items.length} {category.items.length === 1 ? 'dish' : 'dishes'}
                    </span>
                    {category.status !== 'active' ? (
                      <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-muted">
                        {category.status}
                      </span>
                    ) : null}
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    {isCollapsed ? '+' : '−'}
                  </span>
                </button>

                {!isCollapsed ? (
                  <>
                    <ul className="border-t border-line">
                      {category.items.map((item) => (
                        <li
                          key={item.uid}
                          className={cn(
                            'flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0',
                            !item.is_available && 'bg-surface-sunken',
                          )}
                        >
                          <FoodTypeBadge type={item.food_type} size={14} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{item.name}</p>
                            {item.description ? (
                              <p className="truncate text-xs text-muted">{item.description}</p>
                            ) : null}
                          </div>

                          {canEdit ? (
                            <label className="flex shrink-0 items-center gap-1 text-sm">
                              <span className="text-muted">₹</span>
                              <input
                                defaultValue={formatMinorForInput(item.price.minor)}
                                inputMode="decimal"
                                aria-label={`Price of ${item.name} in rupees`}
                                // Committed on blur, not per keystroke: a request per character
                                // would fight the manager's typing and could land out of order.
                                onBlur={(event) => updatePrice(item, event.target.value)}
                                className="w-20 rounded border border-line bg-bg px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-accent"
                              />
                            </label>
                          ) : (
                            <span className="shrink-0 text-sm tabular-nums">
                              {item.price.display}
                            </span>
                          )}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggleAvailability(item)}
                            aria-pressed={!item.is_available}
                            className={cn(
                              'min-h-tap shrink-0 rounded-card border px-3 text-xs font-semibold disabled:opacity-40',
                              item.is_available
                                ? 'border-line text-muted'
                                : 'border-danger bg-danger-soft text-danger',
                            )}
                          >
                            {item.is_available ? 'Mark sold out' : 'Sold out — restore'}
                          </button>
                        </li>
                      ))}
                      {category.items.length === 0 ? (
                        <li className="px-4 py-3 text-sm text-muted">
                          No dishes in this category.
                        </li>
                      ) : null}
                    </ul>

                    {canEdit ? (
                      draft?.categoryUid === category.uid ? (
                        <ItemForm
                          draft={draft}
                          busy={busy}
                          onChange={setDraft}
                          onCancel={() => setDraft(null)}
                          onSave={createItem}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDraft(emptyDraft(category.uid))}
                          className="w-full border-t border-line px-4 py-2.5 text-left text-sm font-medium text-accent"
                        >
                          + Add a dish to {category.name}
                        </button>
                      )
                    ) : null}
                  </>
                ) : null}
              </section>
            )
          })
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-4">
            <label className="min-w-[12rem] flex-1">
              <span className="text-xs font-medium">New category</span>
              <input
                value={newCategory}
                maxLength={64}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="e.g. Soups"
                className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              disabled={busy || newCategory.trim() === ''}
              onClick={createCategory}
              className="min-h-tap rounded-card bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
            >
              Add category
            </button>
          </div>
        ) : null}
      </main>
    </>
  )
}

function ItemForm({
  draft,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ItemDraft
  busy: boolean
  onChange: (draft: ItemDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="space-y-3 border-t border-line bg-surface-sunken p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium">Dish name</span>
          <input
            value={draft.name}
            maxLength={128}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Price (₹)</span>
          <input
            value={draft.price}
            inputMode="decimal"
            placeholder="249.50"
            onChange={(event) => onChange({ ...draft, price: event.target.value })}
            className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium">Description (optional)</span>
        <input
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
        />
      </label>

      <fieldset>
        <legend className="text-xs font-medium">
          Food type <span className="text-danger">*</span>
        </legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {FOOD_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onChange({ ...draft, foodType: type })}
              aria-pressed={draft.foodType === type}
              className={cn(
                'flex min-h-tap items-center gap-1.5 rounded-card border px-3 text-sm font-medium',
                draft.foodType === type
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line',
              )}
            >
              <FoodTypeBadge type={type} size={13} />
              {FOOD_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          Required. Diners filter on this, and an unlabelled dish will not be ordered.
        </p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Select
            label="Spice level (optional)"
            value={draft.spiceLevel}
            onChange={(spiceLevel) => onChange({ ...draft, spiceLevel })}
            options={SPICE_OPTIONS}
            className="w-full"
          />
        </div>
        <label className="block">
          <span className="text-xs font-medium">Prep time, minutes (optional)</span>
          <input
            value={draft.prepTime}
            inputMode="numeric"
            onChange={(event) =>
              onChange({
                ...draft,
                prepTime: event.target.value.replace(/\D/g, '').slice(0, 3),
              })
            }
            className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="min-h-tap rounded-card bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Add dish'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-tap rounded-card border border-line px-4 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
