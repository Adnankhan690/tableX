'use client'

import { cn } from '@tablex/ui'
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  /** A second line under the label, for a choice whose consequence is not obvious from its name. */
  description?: string
  disabled?: boolean
}

export interface SelectProps<T extends string = string> {
  value: T
  onChange: (value: T) => void
  options: readonly SelectOption<T>[]
  /** Visible label, rendered above the control and wired up with aria-labelledby. */
  label?: string
  /** For a control whose purpose is clear from context and needs no visible label. */
  ariaLabel?: string
  /** Shown when `value` matches no option -- a filter cleared from elsewhere, say. */
  placeholder?: string
  disabled?: boolean
  /** Applied to the trigger, so a caller can set width without reaching inside. */
  className?: string
}

/** How far the list may grow before it scrolls. About eight rows -- past that, scanning beats scrolling. */
const MAX_PANEL_HEIGHT = 320
/** Never render a list shorter than this; below it, flipping to the other side is better. */
const MIN_PANEL_HEIGHT = 160
/** Gap between the trigger and the panel, and the panel and the viewport edge. */
const GAP = 4
const EDGE = 8
/** Typeahead buffer lifetime. The WAI-ARIA reference implementations use 500ms. */
const TYPEAHEAD_RESET_MS = 500

interface PanelPosition {
  left: number
  minWidth: number
  maxWidth: number
  maxHeight: number
  /** One of the two is set; `bottom` is what makes an upward flip need no panel measurement. */
  top?: number
  bottom?: number
}

/**
 * A select-only combobox, replacing the native `<select>` across the panel.
 *
 * Why not `<select>`: its dropdown is drawn by the operating system, so on a staff member's
 * machine set to dark mode the panel renders a dark grey menu over this deliberately light-only
 * theme (globals.css) -- the one piece of UI the app cannot style. It also cannot show a second
 * line per option, which the role and payment-provider choices both want, and its options ignore
 * the 2.5rem tap target the rest of the app holds to for tablet use.
 *
 * What it is not: a searchable or multi-select control. Every list here is short and known, so
 * typeahead covers what a filter field would, without a text input's ambiguity about whether
 * typing filters or selects.
 *
 * Implements the ARIA 1.2 select-only combobox pattern. The two decisions worth knowing:
 *
 *  - **Focus never leaves the trigger.** The listbox is `aria-activedescendant`-driven rather
 *    than focus-driven, so arrowing through options fires no focus events and there is no focus
 *    to restore on close -- the class of bug where a dropdown closes and the page jumps to the
 *    top simply cannot happen.
 *  - **The panel is a portal, positioned fixed.** It escapes any `overflow` ancestor. The order
 *    board's filter bar is fine today, but a dropdown that clips inside a scrolling table is a
 *    bug that appears later, at the call site, far from this file.
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  placeholder = 'Select…',
  disabled = false,
  className,
}: SelectProps<T>) {
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const labelId = `${baseId}-label`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ buffer: '', at: 0 })

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<PanelPosition | null>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex]

  /**
   * Measure the trigger and decide where the panel goes.
   *
   * Reads the viewport on every call rather than caching: the panel stays open across scrolls
   * and window resizes, and a cached rect is how a dropdown ends up detached from its trigger.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()

    const spaceBelow = window.innerHeight - rect.bottom - GAP - EDGE
    const spaceAbove = rect.top - GAP - EDGE
    // Flip up only when below genuinely cannot hold a usable list AND above is roomier.
    // Flipping on any shortfall makes the panel jump sides as the page scrolls.
    const flipUp = spaceBelow < MIN_PANEL_HEIGHT && spaceAbove > spaceBelow
    const space = flipUp ? spaceAbove : spaceBelow

    setPosition({
      left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - EDGE - rect.width)),
      minWidth: rect.width,
      maxWidth: window.innerWidth - 2 * EDGE,
      maxHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, space)),
      top: flipUp ? undefined : rect.bottom + GAP,
      bottom: flipUp ? window.innerHeight - rect.top + GAP : undefined,
    })
  }, [])

  // Before paint, so the panel never renders at a stale position for a frame.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    // Capture phase: a scroll inside any ancestor has to move the panel too, and scroll events
    // from a nested container do not bubble.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  /**
   * Dismissal by pointer, on `pointerdown` rather than `click`.
   *
   * A `click` listener fires after the press has already moved focus, which on a control that
   * opens its own dropdown produces a close-then-reopen flicker when the press lands on the
   * trigger itself.
   */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the active option in view. `nearest` scrolls the list by the minimum needed, so
  // arrowing down one row moves one row rather than centring and jolting the whole list.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    document.getElementById(`${baseId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, baseId])

  /** The first selectable option at or after `from`, searching one row at a time in `direction`. */
  const firstEnabled = (from: number, direction: number) => {
    const step = direction < 0 ? -1 : 1
    for (let i = from; i >= 0 && i < options.length; i += step) {
      if (!options[i]?.disabled) return i
    }
    return -1
  }

  const openWith = (index: number) => {
    setActiveIndex(index === -1 ? firstEnabled(0, 1) : index)
    setOpen(true)
  }

  const commit = (index: number) => {
    const option = options[index]
    setOpen(false)
    if (!option || option.disabled) return
    // Re-picking the option that is already selected fires nothing: several callers refetch or
    // PATCH on change, and confirming the current value should not cost a request.
    if (option.value !== value) onChange(option.value)
  }

  const move = (step: number) => {
    const from =
      activeIndex === -1 ? (selectedIndex === -1 ? 0 : selectedIndex) : activeIndex + step
    // Deliberately clamped, not wrapped: wrapping means holding ArrowDown silently loops, and
    // hitting the end is a useful signal that the list is exhausted.
    const next = firstEnabled(Math.max(0, Math.min(options.length - 1, from)), step)
    // Nothing selectable in that direction: hold position rather than collapsing to no active
    // option, which would strand aria-activedescendant.
    if (next !== -1) setActiveIndex(next)
  }

  /** Jump to the next option starting with what was typed. */
  const jumpTo = (char: string) => {
    const now = Date.now()
    const buffer =
      now - typeahead.current.at > TYPEAHEAD_RESET_MS ? char : typeahead.current.buffer + char
    typeahead.current = { buffer, at: now }

    const needle = buffer.toLowerCase()
    // A repeated single character cycles through the options starting with it -- "t", "t", "t"
    // walks the tables -- which is how a native select behaves and what fast typists expect.
    const cycling = buffer.length > 1 && buffer.split('').every((c) => c === char)
    const prefix = cycling ? char.toLowerCase() : needle
    const start = activeIndex === -1 ? 0 : activeIndex
    const from = cycling || buffer.length === 1 ? start + 1 : start

    for (let step = 0; step < options.length; step++) {
      const index = (from + step + options.length) % options.length
      const option = options[index]
      if (!option || option.disabled) continue
      if (option.label.toLowerCase().startsWith(prefix)) {
        setActiveIndex(index)
        if (!open) setOpen(true)
        return
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return

    /**
     * A printable character is typeahead, in both the open and closed state.
     *
     * Space is the exception, and it is ambiguous: on its own it activates the control, but
     * mid-word it belongs to the search -- "Table 1" and "Not applicable" are both unreachable by
     * typeahead if a space commits instead. Resolved by whether a search is already in flight,
     * which is how a native select behaves.
     */
    const typing =
      typeahead.current.buffer !== '' && Date.now() - typeahead.current.at <= TYPEAHEAD_RESET_MS
    if (
      event.key.length === 1 &&
      (event.key !== ' ' || typing) &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault()
      jumpTo(event.key)
      return
    }

    if (!open) {
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Enter':
        case ' ':
          event.preventDefault()
          openWith(selectedIndex)
          return
        case 'Home':
          event.preventDefault()
          openWith(firstEnabled(0, 1))
          return
        case 'End':
          event.preventDefault()
          openWith(firstEnabled(options.length - 1, -1))
          return
        default:
          return
      }
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(firstEnabled(0, 1))
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(firstEnabled(options.length - 1, -1))
        break
      case 'PageDown':
        event.preventDefault()
        move(5)
        break
      case 'PageUp':
        event.preventDefault()
        move(-5)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(activeIndex)
        break
      case 'Escape':
        event.preventDefault()
        // Stopped here: the menu editor's dropdowns sit inside a form that closes on Escape, and
        // one key press should dismiss one layer.
        event.stopPropagation()
        // Closes without committing, which is why the active index is discarded here.
        setOpen(false)
        break
      case 'Tab':
        // Not prevented: Tab commits and lets focus move on, as a native select does. Swallowing
        // it would trap a keyboard user inside the control.
        commit(activeIndex)
        break
      default:
        break
    }
  }

  const panelStyle: CSSProperties | undefined = position
    ? {
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        minWidth: position.minWidth,
        maxWidth: position.maxWidth,
        maxHeight: position.maxHeight,
      }
    : undefined

  return (
    <>
      {label ? (
        <span id={labelId} className="mb-1 block text-xs font-medium">
          {label}
        </span>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        data-state={open ? 'open' : 'closed'}
        data-value={value}
        onClick={() => (open ? setOpen(false) : openWith(selectedIndex))}
        onKeyDown={onKeyDown}
        className={cn(
          'flex min-h-tap items-center justify-between gap-2 rounded-card border bg-bg px-3 text-sm',
          'text-left transition-colors',
          // The open trigger takes the accent border the focused input does, so the pair reads as
          // one control rather than a panel floating next to an inert button.
          open ? 'border-accent' : 'border-line hover:border-muted',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          className,
        )}
      >
        <span className={cn('truncate', selected ? '' : 'text-muted')}>
          {selected ? selected.label : placeholder}
        </span>
        <Chevron open={open} />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              style={panelStyle}
              // The scroll container, and the box whose geometry matters: the listbox inside it is
              // as tall as its content. Named so a test can measure the right one.
              data-select-panel={open ? 'open' : undefined}
              // Invisible until measured, rather than absent: mounting on the first frame lets the
              // scroll-into-view effect find the selected option before the panel is seen.
              className={cn(
                'fixed z-50 overflow-y-auto overscroll-contain rounded-card border border-line',
                'bg-surface py-1 shadow-[0_8px_24px_rgb(15_23_42_/_0.12)]',
                position ? 'opacity-100' : 'opacity-0',
              )}
            >
              <div role="listbox" id={listboxId} aria-labelledby={label ? labelId : undefined}>
                {options.map((option, index) => {
                  const isSelected = option.value === value
                  const isActive = index === activeIndex
                  return (
                    /* An option is not a keyboard target here. In the select-only combobox pattern
                       the trigger keeps focus and drives the list through aria-activedescendant,
                       so the keyboard handler lives there and one on this node could never fire. */
                    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
                    <div
                      key={option.value}
                      id={optionId(index)}
                      role="option"
                      // Not reachable by Tab, by design; present so the node is programmatically
                      // focusable, which is what scrollIntoView and assistive tech expect of an
                      // option that aria-activedescendant can point at.
                      tabIndex={-1}
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      data-value={option.value}
                      data-active={isActive || undefined}
                      data-selected={isSelected || undefined}
                      // Pointer, not mouse: one handler covers touch and pen, so a tablet gets the
                      // same highlight-then-commit behaviour as a laptop.
                      onPointerMove={() => {
                        if (!option.disabled && index !== activeIndex) setActiveIndex(index)
                      }}
                      // Keeps focus on the trigger. Without this the press blurs it, and the
                      // combobox loses the focus that aria-activedescendant is reported against.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => commit(index)}
                      className={cn(
                        'flex min-h-tap cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                        isActive ? 'bg-accent-soft' : '',
                        option.disabled ? 'cursor-not-allowed opacity-50' : '',
                      )}
                    >
                      {/* Reserved width whether or not the tick shows, so labels line up and the
                          list does not shift by 1.25rem as the selection moves. */}
                      <span className="flex w-4 shrink-0 justify-center">
                        {isSelected ? <Check /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', isSelected ? 'font-semibold' : '')}>
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="mt-0.5 block text-xs text-muted">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={cn(
        'h-4 w-4 shrink-0 text-muted transition-transform',
        open ? '-rotate-180' : 'rotate-0',
      )}
      fill="none"
      stroke="currentColor"
    >
      <path d="M6 8l4 4 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Check() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5 text-accent"
      fill="none"
      stroke="currentColor"
    >
      <path d="M4 10.5l4 4 8-9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
