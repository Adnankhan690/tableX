'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Collects a required reason before a destructive transition.
 *
 * Built on the native `<dialog>` element rather than an overlay div or a dialog library. The
 * browser gives focus trapping, Escape-to-close, inert background content and the correct ARIA
 * role for free -- reimplementing those by hand is where accessible modals usually go wrong, and
 * a library would be a dependency for one component.
 *
 * The one thing the native element does not do is close on backdrop click, which is deliberate
 * here: an accidental tap outside must not silently abandon a reject the staff member was
 * halfway through explaining.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) {
      setReason('')
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // Escape fires the dialog's own cancel event; the parent has to hear about it or its `open`
  // state and the DOM would disagree, and the dialog could never be reopened.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    const handleCancel = (event: Event) => {
      event.preventDefault()
      onCancel()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [onCancel])

  const trimmed = reason.trim()

  return (
    <dialog
      ref={ref}
      className="w-[min(28rem,92vw)] rounded-card border border-line bg-surface p-5 text-ink backdrop:bg-black/40"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>

      <label className="mt-4 block">
        <span className="text-sm font-medium">Reason</span>
        <textarea
          // autoFocus is correct here: the dialog exists solely to collect this field, so the
          // caret belongs in it the moment it opens.
          autoFocus
          value={reason}
          maxLength={500}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. we have run out of paneer"
          className="mt-1 w-full rounded-card border border-line bg-bg p-2 text-sm outline-none focus:border-accent"
        />
      </label>
      <p className="mt-1 text-xs text-muted">The customer is shown this, so keep it clear.</p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-tap rounded-card border border-line px-4 text-sm font-medium"
        >
          Keep the order
        </button>
        <button
          type="button"
          // The server rejects these transitions without a reason, so the button stays disabled
          // rather than submitting into a guaranteed 422.
          disabled={trimmed === ''}
          onClick={() => onConfirm(trimmed)}
          className="min-h-tap rounded-card bg-danger px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
