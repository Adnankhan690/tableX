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
import { cn, ErrorState, FoodTypeBadge } from '@tablex/ui'
import { ChevronDown, UtensilsCrossed } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { Select, type SelectOption } from '@/components/select'
import {
  Badge,
  Button,
  Card,
  Count,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  SearchInput,
  Skeleton,
  Toolbar,
} from '@/components/ui'
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

/**
 * The collapse motion, asymmetric on purpose, and declared here so the section and its arrow
 * cannot drift apart.
 *
 * Both directions used to be `duration-300 ease-out`, i.e. identical -- and opening still read as
 * noticeably faster than closing. The cause is the curve, not the clock: `ease-out` front-loads,
 * putting roughly 44% of the travel into the first fifth of the time. Closing reads as graceful
 * because that profile ENDS slowly; opening reads as abrupt because it starts fast and dumps a
 * section of dishes into view before the eye can follow it.
 *
 * So opening gets `ease-in-out` (cubic-bezier(0.4, 0, 0.2, 1)) -- a soft start, a steady middle, a
 * soft stop -- and 420ms rather than 300. Closing keeps the curve that already felt right.
 *
 * TO TUNE: these two lines are the only knobs. Raise the 420ms if opening still feels hurried.
 */
const OPEN_MOTION = 'duration-[420ms] ease-in-out'
const CLOSE_MOTION = 'duration-300 ease-out'

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
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  /**
   * The uid of the dish whose request is in flight, or 'category'/'item' for the two panels.
   *
   * One page-wide boolean used to disable every sold-out button at once: a single price blur greyed
   * out all 93 dishes, so the page looked frozen for the length of one request.
   */
  const [pending, setPending] = useState<string | null>(null)
  /**
   * A name filter across every category.
   *
   * The one control that scales past 14 sections. At production scale this page is 93 dishes and
   * roughly 8,500px tall, with no way to reach one dish except scrolling -- and marking something
   * sold out mid-service is the most time-critical action on it.
   */
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<ItemDraft | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)

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
      setPending(item.uid)
      getToken().then((token) => {
        if (!token) {
          setPending(null)
          return
        }
        api
          .setAvailability(token, item.uid, !item.is_available)
          .then(() => {
            setPending(null)
            load()
          })
          .catch((err: unknown) => {
            setPending(null)
            setNotice({
              tone: 'danger',
              text: isApiError(err) ? err.message : 'Could not update availability.',
            })
          })
      })
    },
    [getToken, load],
  )

  const createItem = useCallback(() => {
    if (draft === null) return

    const priceResult = parsePriceToMinor(draft.price)
    if (!priceResult.ok) {
      setNotice({ tone: 'danger', text: priceResult.error })
      return
    }
    if (draft.foodType === null) {
      setNotice({
        tone: 'danger',
        text: 'Choose veg, non-veg or contains egg — diners filter on this.',
      })
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

    setPending('new-item')
    setNotice(null)
    getToken().then((token) => {
      if (!token) {
        setPending(null)
        return
      }
      api
        .createItem(token, body)
        .then(() => {
          setDraft(null)
          setPending(null)
          load()
        })
        .catch((err: unknown) => {
          setPending(null)
          setNotice({
            tone: 'danger',
            text: isApiError(err) ? err.message : 'Could not add the dish.',
          })
        })
    })
  }, [draft, getToken, load])

  const createCategory = useCallback(() => {
    const name = newCategory.trim()
    if (!name) return

    setPending('new-category')
    getToken().then((token) => {
      if (!token) {
        setPending(null)
        return
      }
      api
        .createCategory(token, { name })
        .then(() => {
          setNewCategory('')
          setPending(null)
          load()
        })
        .catch((err: unknown) => {
          setPending(null)
          setNotice({
            tone: 'danger',
            text: isApiError(err) ? err.message : 'Could not add the category.',
          })
        })
    })
  }, [newCategory, getToken, load])

  const updatePrice = useCallback(
    (item: AdminMenuItemView, raw: string) => {
      const result = parsePriceToMinor(raw)
      if (!result.ok) {
        setNotice({ tone: 'danger', text: result.error })
        return
      }
      if (result.minor === item.price.minor) return

      setPending(item.uid)
      getToken().then((token) => {
        if (!token) {
          setPending(null)
          return
        }
        api
          .updateItem(token, item.uid, { price_minor: result.minor })
          .then(() => {
            setPending(null)
            // Money changing silently is the one edit on this page that needs saying out loud.
            setNotice({ tone: 'success', text: `${item.name} is now ${raw.trim()}.` })
            load()
          })
          .catch((err: unknown) => {
            setPending(null)
            setNotice({
              tone: 'danger',
              text: isApiError(err) ? err.message : 'Could not update the price.',
            })
          })
      })
    },
    [getToken, load],
  )

  if (auth === null) return null

  /**
   * The filtered view.
   *
   * Filtering keeps a category whose NAME matches as well as one whose dishes match, so typing
   * "biryani" finds both the section and the dish. Categories that match nothing disappear
   * entirely rather than rendering as empty shells -- 14 empty headers is not a search result.
   */
  const query = filter.trim().toLowerCase()
  const visible = (categories ?? [])
    .map((category) => {
      if (query === '') return category
      if (category.name.toLowerCase().includes(query)) return category
      return {
        ...category,
        items: category.items.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            (item.description ?? '').toLowerCase().includes(query),
        ),
      }
    })
    .filter((category) => query === '' || category.items.length > 0)

  const totalDishes = (categories ?? []).reduce((n, c) => n + c.items.length, 0)
  const shownDishes = visible.reduce((n, c) => n + c.items.length, 0)
  const soldOut = (categories ?? []).reduce(
    (n, c) => n + c.items.filter((i) => !i.is_available).length,
    0,
  )
  const allCollapsed = visible.length > 0 && visible.every((c) => collapsed[c.uid] === true)

  return (
    <>
      <PageHeader
        title="Menu"
        subtitle={
          categories === null
            ? undefined
            : `${(categories ?? []).length} categories · ${totalDishes} dishes${
                soldOut > 0 ? ` · ${soldOut} sold out` : ''
              }${canEdit ? '' : ' · read only'}`
        }
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setAddingCategory(true)}>
              Add category
            </Button>
          ) : null
        }
      />

      <Toolbar>
        <SearchInput
          value={filter}
          onValueChange={setFilter}
          placeholder="Find a dish"
          label="Filter dishes by name"
          className="min-w-[14rem]"
        />
        {/* A collapse-all, because a 14-section page is navigable only when it can be folded down
            to its section headings. */}
        <Button
          onClick={() => {
            const next: Record<string, boolean> = {}
            for (const category of categories ?? []) next[category.uid] = !allCollapsed
            setCollapsed(next)
          }}
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </Button>
        {query !== '' ? (
          <span className="text-sm text-muted">
            {shownDishes} of {totalDishes} dishes
          </span>
        ) : null}
      </Toolbar>

      {notice !== null ? (
        <div className="border-b border-line bg-surface px-4 py-2.5">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}

      <main className="space-y-3 p-4">
        {error !== null ? (
          <ErrorState
            message={isApiError(error) ? error.message : 'Could not load the menu.'}
            {...(isApiError(error) && error.code ? { code: error.code } : {})}
            onRetry={load}
          />
        ) : categories === null ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Card key={i} flush>
                <div className="px-4 py-3">
                  <Skeleton className="h-4 w-40" />
                </div>
                {[0, 1, 2].map((j) => (
                  <div
                    key={j}
                    className="flex items-center gap-3 border-t border-divider px-4 py-3"
                  >
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-tap w-24" />
                  </div>
                ))}
              </Card>
            ))}
          </div>
        ) : categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="A menu is built from categories — Starters, Mains, Breads — and dishes inside them."
            action={
              canEdit ? (
                <Button variant="primary" onClick={() => setAddingCategory(true)}>
                  Add the first category
                </Button>
              ) : null
            }
            icon={UtensilsCrossed}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`Nothing matches “${filter.trim()}”`}
            description="Try part of a dish name, or clear the filter to see the whole menu."
            action={<Button onClick={() => setFilter('')}>Clear the filter</Button>}
          />
        ) : (
          visible.map((category) => {
            const isCollapsed = collapsed[category.uid] === true
            const listId = `category-${category.uid}`
            return (
              <Card key={category.uid} flush>
                {/* The heading is a real h2 wrapping the toggle, and the toggle announces its
                    state: it used to be a bare <button> around a span with no aria-expanded, so a
                    screen-reader user could not tell a collapsed section from an empty one. */}
                <h2>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    aria-controls={listId}
                    onClick={() => setCollapsed((c) => ({ ...c, [category.uid]: !isCollapsed }))}
                    className="flex min-h-tap w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-lg font-semibold">{category.name}</span>
                      <Count value={category.items.length} />
                      {category.status !== 'active' ? (
                        <Badge tone="neutral">{category.status}</Badge>
                      ) : null}
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        // Same motion spec as the panel below, both directions. It was on
                        // Tailwind's default 150ms, so the arrow used to finish turning while the
                        // section was still opening.
                        'h-4 w-4 shrink-0 text-muted transition-transform',
                        'motion-reduce:transition-none',
                        isCollapsed ? `${CLOSE_MOTION}` : `rotate-180 ${OPEN_MOTION}`,
                      )}
                      strokeWidth={2}
                    />
                  </button>
                </h2>

                {/*
                  THE COLLAPSE IS PURE CSS, and it is the same idiom as order-card.tsx and
                  stats-strip.tsx rather than a third way of doing the same thing.

                  A grid whose single row goes from `0fr` to `1fr` transitions to the content's own
                  height, which `height: auto` cannot do -- so there is no measuring, no
                  ResizeObserver and no layout thrash on a page that is 8,500px tall at production
                  scale. `overflow-hidden` clips during the transition and the inner `min-h-0` is
                  what lets the row actually reach zero; without it the child's min-content height
                  holds the section open.

                  It replaced `{!isCollapsed ? ... : null}`, which snapped. Keeping the content
                  mounted costs nothing in the common case: categories are expanded by DEFAULT
                  (`collapsed[uid] === true` is the collapsed test), so every dish is already in the
                  DOM until someone chooses to fold a section away.

                  `inert` when collapsed, which the two older usages do not do and this one needs:
                  a folded category still contains price fields and "Mark sold out" buttons, and
                  without it a keyboard user tabs into controls they cannot see. It also takes the
                  hidden rows out of the accessibility tree, so `aria-expanded` on the toggle stops
                  disagreeing with what a screen reader can reach.
                */}
                <div
                  id={listId}
                  role="region"
                  aria-label={`Dishes in ${category.name}`}
                  inert={isCollapsed}
                  className={cn(
                    'grid overflow-hidden transition-[grid-template-rows]',
                    'motion-reduce:transition-none',
                    isCollapsed
                      ? `grid-rows-[0fr] ${CLOSE_MOTION}`
                      : `grid-rows-[1fr] ${OPEN_MOTION}`,
                  )}
                >
                  <div className="min-h-0">
                    <ul>
                      {category.items.map((item) => (
                        <li
                          key={item.uid}
                          /*
                            An explicit grid, not a flex row with one greedy gap: at 1440 the old
                            row put ~700px of empty space between a dish's description and its
                            price, so the two halves of one row read as unrelated columns.

                            IT STACKS BELOW sm, and this is not cosmetic. The row's fixed furniture
                            -- 32px of padding, the 14px food-type mark, a 96px price field, a
                            ~107px button and three 12px gaps -- comes to roughly 285px before the
                            dish name gets anything at all. On a 360px phone that left the name
                            about 75px ("Chicken ...", "Murgh M..."), and on a sold-out row the
                            "Sold out" badge took most of what remained, collapsing the name to a
                            single letter. Four columns is a desktop shape; a phone gets two rows.
                          */
                          className={cn(
                            'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-divider px-4 py-2',
                            'sm:grid-cols-[auto_minmax(0,1fr)_auto]',
                            !item.is_available ? 'bg-surface-sunken' : '',
                          )}
                        >
                          <FoodTypeBadge type={item.food_type} size={14} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-base font-medium">
                              <span className="truncate">{item.name}</span>
                              {/* Sold out is a STATE on the row, so the red no longer lands on the
                                  button that undoes it -- the only red on the page used to be the
                                  two rows that were already handled. */}
                              {!item.is_available ? (
                                <Badge tone="danger" className="shrink-0">
                                  Sold out
                                </Badge>
                              ) : null}
                            </p>
                            {item.description ? (
                              <p className="truncate text-sm text-muted">{item.description}</p>
                            ) : null}
                          </div>

                          {/*
                            Price and action are ONE grid child, so they move to the second row
                            together instead of the button wrapping away from the field it applies
                            to. Right-aligned: below sm this puts the action at the edge the thumb
                            reaches, and at sm+ the column is auto-width so it has no effect.
                          */}
                          <div className="col-start-2 flex items-center justify-end gap-2 sm:col-start-3">
                            {/* No wrapping <label>: the field is named by the aria-label below,
                                which names it per dish ("Price of Butter Chicken in rupees")
                                rather than repeating the word "Price" 93 times down the page. */}
                            {canEdit ? (
                              <Input
                                defaultValue={formatMinorForInput(item.price.minor)}
                                inputMode="decimal"
                                numeric
                                prefix="₹"
                                aria-label={`Price of ${item.name} in rupees`}
                                // Committed on blur, not per keystroke: a request per character
                                // would fight the manager's typing and could land out of order.
                                onBlur={(event) => updatePrice(item, event.target.value)}
                                className="w-24"
                              />
                            ) : (
                              <span className="figures shrink-0 text-base">
                                {item.price.display}
                              </span>
                            )}

                            <Button
                              size="sm"
                              variant={item.is_available ? 'secondary' : 'primary'}
                              disabled={pending !== null && pending !== item.uid}
                              loading={pending === item.uid}
                              aria-pressed={!item.is_available}
                              onClick={() => toggleAvailability(item)}
                            >
                              {item.is_available ? 'Mark sold out' : 'Back on sale'}
                            </Button>
                          </div>
                        </li>
                      ))}
                      {category.items.length === 0 ? (
                        <li className="border-t border-divider px-4 py-4">
                          <p className="text-sm text-muted">No dishes in this category yet.</p>
                        </li>
                      ) : null}
                    </ul>

                    {canEdit ? (
                      draft?.categoryUid === category.uid ? (
                        <ItemForm
                          draft={draft}
                          busy={pending === 'new-item'}
                          onChange={setDraft}
                          onCancel={() => setDraft(null)}
                          onSave={createItem}
                        />
                      ) : (
                        <Button
                          variant="ghost"
                          block
                          className="justify-start rounded-none border-t border-divider text-accent"
                          onClick={() => setDraft(emptyDraft(category.uid))}
                        >
                          + Add a dish to {category.name}
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </main>
      <Dialog
        open={addingCategory}
        title="Add a category"
        description="Categories are the sections a diner scrolls through — Starters, Mains, Breads."
        onClose={() => {
          setAddingCategory(false)
          setNewCategory('')
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setAddingCategory(false)
                setNewCategory('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={newCategory.trim() === ''}
              loading={pending === 'new-category'}
              loadingLabel="Adding…"
              onClick={createCategory}
            >
              Add category
            </Button>
          </>
        }
      >
        <Field label="Category name" hint="Diners see this as a section heading.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={newCategory}
              maxLength={64}
              onChange={(event) => setNewCategory(event.target.value)}
              placeholder="e.g. Soups"
            />
          )}
        </Field>
      </Dialog>
    </>
  )
}

/**
 * The add-a-dish form.
 *
 * Every input here used to carry `outline-none`, which Tailwind compiles to a transparent 2px
 * outline in the UTILITIES layer -- outranking the `:focus-visible` rule globals.css defines in
 * @layer base, and silently deleting the focus ring on the one screen where a stray keystroke
 * changes a price. The Field/Input primitives do not do that; do not reintroduce it here.
 */
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
    <div className="space-y-3 border-t border-divider bg-bg p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dish name">
          {({ id }) => (
            <Input
              id={id}
              value={draft.name}
              maxLength={128}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              placeholder="Paneer Tikka"
            />
          )}
        </Field>
        <Field label="Price" hint="In rupees. Two decimal places at most.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={draft.price}
              inputMode="decimal"
              numeric
              prefix="₹"
              placeholder="249.50"
              onChange={(event) => onChange({ ...draft, price: event.target.value })}
            />
          )}
        </Field>
      </div>

      <Field label="Description" optional hint="One line. Diners read this under the dish name.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={draft.description}
            maxLength={200}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            placeholder="Cottage cheese marinated in yoghurt and spices, char-grilled"
          />
        )}
      </Field>

      {/*
        FOOD TYPE HAS NO DEFAULT, and the three options are a radio group rather than a dropdown:
        it is required, there are exactly three, and guessing "veg" would mislabel meat while
        guessing "non_veg" would hide a vegetarian dish from the diners who filter for it.
      */}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">Food type</legend>
        <div className="flex flex-wrap gap-2">
          {FOOD_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={draft.foodType === type}
              onClick={() => onChange({ ...draft, foodType: type })}
              className={cn(
                'inline-flex min-h-tap items-center gap-2 rounded-control border px-3 text-base font-medium transition-colors',
                draft.foodType === type
                  ? 'border-accent-line bg-accent-soft text-accent'
                  : 'border-line-strong bg-surface text-muted hover:border-muted hover:text-ink',
              )}
            >
              <FoodTypeBadge type={type} size={13} />
              {FOOD_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          Required. Diners filter on this, and an unlabelled dish will not be ordered.
        </p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Select
            label="Spice level"
            value={draft.spiceLevel}
            onChange={(spiceLevel) => onChange({ ...draft, spiceLevel })}
            options={SPICE_OPTIONS}
            className="w-full"
          />
        </div>
        <Field label="Prep time" optional hint="Minutes. Shown to the kitchen, not to diners.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={draft.prepTime}
              inputMode="numeric"
              numeric
              suffix="min"
              placeholder="18"
              onChange={(event) =>
                onChange({ ...draft, prepTime: event.target.value.replace(/\D/g, '').slice(0, 3) })
              }
            />
          )}
        </Field>
      </div>

      <div className="flex gap-2 border-t border-divider pt-3">
        <Button variant="primary" loading={busy} loadingLabel="Saving…" onClick={onSave}>
          Add dish
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
