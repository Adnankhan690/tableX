'use client'

import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Textarea } from '@/components/ui'

/** The shortest reason that tells a diner anything. Below this it is noise in their order screen. */
const MIN_REASON = 3
const MAX_REASON = 200

export interface ReasonDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (reason: string) => void
}

/**
 * The reason a refusal needs before it can happen.
 *
 * Asked for up front rather than after a rejected submit: the server refuses these without a
 * reason (docs/DECISIONS.md D1), and collecting it afterwards makes the staff member do the work
 * twice.
 *
 * The confirm button is a filled danger control, and it stays LEGIBLE while disabled. It used to
 * fade to `opacity-40` -- white on pale red at 2.05:1 -- in the state the dialog always opens in,
 * so the one word telling a staff member what is about to happen to a real order was unreadable
 * until they had already typed.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('')

  // Cleared on open, not on close: closing animates, and a flash of the previous refusal's reason
  // on the way out is worse than an empty box on the way in.
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const trimmed = reason.trim()
  const ready = trimmed.length >= MIN_REASON

  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Keep the order</Button>
          <Button variant="danger" disabled={!ready} onClick={() => onConfirm(trimmed)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field
        label="Reason"
        hint={`The diner sees this. ${MAX_REASON - reason.length} characters left.`}
      >
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            // Autofocus is right for a single-field dialog: the only reason it is open is to
            // collect this, and the Dialog announces its title as the accessible name before the
            // caret lands here, so a screen-reader user still hears what they are refusing.
            autoFocus
            value={reason}
            maxLength={MAX_REASON}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Out of stock, kitchen closing, duplicate order…"
            rows={3}
          />
        )}
      </Field>
    </Dialog>
  )
}
