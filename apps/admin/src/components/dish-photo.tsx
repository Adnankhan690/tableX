'use client'

import { cn } from '@tablex/ui'
import { ImagePlus, X } from 'lucide-react'
import Image from 'next/image'
import { useRef } from 'react'
import { ACCEPT_ATTRIBUTE } from '@/lib/image-upload'

/**
 * A dish's photograph, as one 40px control in the menu row (docs/DECISIONS.md D15).
 *
 * Deliberately not a dialog. Adding a photo is a single decision -- which file -- and a
 * manager working down a menu does it many times in a sitting; a modal per dish would put
 * two extra clicks on each. So the thumbnail IS the button, and its absence is the empty
 * state.
 *
 * Presentational only. Preparing, uploading and confirming live in the menu manager, where
 * the token and the reload live.
 */

export interface DishPhotoProps {
  /** The resolved URL, whether hosted by us or pasted from the restaurant's own site. */
  url: string | undefined
  /** Names the control per dish, so a screen reader hears which one it is on. */
  dishName: string
  /** False for floor staff, and on a deployment that stores no images. */
  canEdit: boolean
  /** 0 to 1 while this dish is uploading, or null when it is not. */
  progress: number | null
  busy: boolean
  onPick: (file: File) => void
  onRemove: () => void
}

const BOX = 'h-10 w-10 shrink-0 overflow-hidden rounded-control'

/**
 * An explicit `sizes`, because `fill` otherwise makes Next request the largest candidate --
 * a full-resolution dish photograph fetched to fill 40 square pixels, once per row, on a
 * page that is 93 rows long at production scale. 80px covers a high-DPI screen.
 */
const SIZES = '80px'

export function DishPhoto({
  url,
  dishName,
  canEdit,
  progress,
  busy,
  onPick,
  onRemove,
}: DishPhotoProps) {
  const input = useRef<HTMLInputElement | null>(null)

  const hasPhoto = url !== undefined && url !== ''

  // Read-only view: the photo, or nothing at all. An empty placeholder for someone who
  // cannot act on it is furniture that says "something is missing" and offers no way to fix
  // it, and floor staff see this screen all shift.
  if (!canEdit) {
    return hasPhoto ? (
      <span className={cn(BOX, 'relative block bg-surface-sunken')}>
        <Image src={url} alt="" fill sizes={SIZES} className="object-cover" loading="lazy" />
      </span>
    ) : (
      <span className={cn(BOX, 'block')} aria-hidden="true" />
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        /*
          BUSY, NOT DISABLED, and the distinction is load-bearing for a keyboard user.

          Disabling the element that currently has focus makes the browser drop focus to
          <body>. This button is activated by the very interaction that starts the upload, so
          `disabled={busy}` would throw the user back to the top of an 8,500px page every time
          they added a photo, leaving them to tab through 47 rows to get back.

          So it stays focusable and announces its state through aria-busy, and the click is
          guarded instead. `aria-disabled` is deliberately not used either: it would say the
          control is unavailable when it is merely working.
        */
        aria-busy={busy}
        onClick={() => {
          if (busy) return
          input.current?.click()
        }}
        /*
          The name changes with the state rather than carrying aria-pressed: "Replace" and
          "Add" are different actions, not two positions of one toggle, and a button whose
          accessible name states what it will do is what a screen-reader user expects here.
          While uploading it names the state instead, since neither action is available.
        */
        aria-label={
          busy
            ? `Uploading a photo for ${dishName}`
            : hasPhoto
              ? `Replace the photo for ${dishName}`
              : `Add a photo for ${dishName}`
        }
        className={cn(
          BOX,
          'relative flex items-center justify-center border transition-colors',
          busy ? 'cursor-progress' : '',
          hasPhoto
            ? 'border-line hover:border-muted'
            : 'border-dashed border-line-strong text-faint hover:border-muted hover:text-muted',
        )}
      >
        {hasPhoto ? (
          <Image src={url} alt="" fill sizes={SIZES} className="object-cover" loading="lazy" />
        ) : (
          <ImagePlus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        )}

        {/*
          The progress overlay sits on the thumbnail rather than replacing the row, so the
          manager keeps their place on a long page. Percentage text rather than a bar: at
          40px a bar is a few pixels tall and reads as decoration.

          aria-hidden, deliberately: a live region ticking through every percentage would talk
          over a screen-reader user for the whole upload. The outcome is announced once, by the
          Notice the menu manager raises on success or failure -- which is a role="status" /
          role="alert" region and is where a result belongs.
        */}
        {busy ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-bg/80 text-[10px] font-semibold tabular-nums text-ink"
          >
            {progress === null ? '…' : `${Math.round(progress * 100)}%`}
          </span>
        ) : null}
      </button>

      {hasPhoto && !busy ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove the photo for ${dishName}`}
          /*
            Offset outside the thumbnail so it never covers the image it applies to. It is
            8px of visible target, so the padding is what actually makes it tappable -- the
            hit area is the full 24px square.
          */
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:border-danger hover:text-danger"
        >
          <X aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
        </button>
      ) : null}

      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        // The button above is the labelled control; this input is never reached directly, so
        // it is hidden from the accessibility tree rather than double-announced.
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Reset before handing the file on, so picking the SAME file again after a failure
          // still fires a change event. Without this, a retry of the exact same photo
          // silently does nothing.
          event.target.value = ''
          if (file) onPick(file)
        }}
      />
    </div>
  )
}
