'use client'

import { cn } from '@tablex/ui'
import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { Button } from './button'

export interface DialogProps {
  open: boolean
  title: string
  /** One or two sentences naming the consequence. Wired to aria-describedby. */
  description?: ReactNode
  children?: ReactNode
  /** Right-aligned footer controls. The confirm goes last, as the rightmost thing. */
  footer?: ReactNode
  onClose: () => void
  /** Widens the panel for content, e.g. a QR code. */
  size?: 'sm' | 'md'
}

/**
 * The panel's modal, on the platform's own <dialog>.
 *
 * Native rather than a portal-and-focus-trap of our own: the browser gives us the top layer, the
 * backdrop, focus containment and Escape for free, and this app ships no dialog library
 * (docs/CONTRIBUTING.md). Two Playwright suites select `dialog[open]`, so the element stays.
 *
 * `aria-labelledby`/`aria-describedby` are wired here rather than left to the caller because a
 * dialog whose only accessible name comes from its first focusable child announces itself as
 * "dialog, Reason, edit text" -- the title, which is the statement of what is about to happen,
 * never reaches the user.
 */
export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  size = 'sm',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    /* The keyboard path for dismissal is the platform's own: <dialog> fires `cancel` on Escape,
       handled below. The click handler exists only to catch a pointer press on the backdrop, which
       has no keyboard equivalent to pair with. */
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // The browser's Escape and backdrop-dismiss both fire `cancel`/`close`; routing them through
      // the same callback keeps React's `open` prop and the element's own state from diverging.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
      onClick={(event) => {
        // A click on the element itself is a click on the backdrop -- the panel below stops
        // propagation by being a child with its own box.
        if (event.target === ref.current) onClose()
      }}
      className={cn(
        'w-[calc(100vw-2rem)] rounded-panel border border-line bg-surface p-0 text-ink shadow-dialog',
        'backdrop:bg-[rgb(14_21_32_/_0.45)]',
        size === 'md' ? 'max-w-lg' : 'max-w-md',
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-divider px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-0.5 text-sm text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="-mr-1.5 -mt-1"
          aria-label="Close"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>

      {children ? <div className="px-4 py-4">{children}</div> : null}

      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-divider bg-bg px-4 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  )
}
