import { cn } from '@tablex/ui'
import { PlateMark, QrGlyph } from './glyphs'
import { MockDescription } from './shell'

/**
 * The card that actually stands on the table.
 *
 * It is here because the product's whole premise is a physical object in a restaurant, and a
 * page that shows only screens argues for software rather than for a way of taking orders. The
 * single 6px sliver behind it, rotated the other way, is what turns a tilted rectangle into an
 * object standing up — without it the card reads as a sticker lying flat.
 *
 * The only rotated element on the page. One tilt is a hand-placed object; two is a template.
 */
export function TableTent({ className }: { className?: string }) {
  return (
    <div className={cn('relative w-[228px]', className)}>
      <div aria-hidden="true">
        {/* The fold of the stand, behind the card and tilted against it. */}
        <div className="absolute inset-x-3 bottom-0 h-[6px] translate-y-1 rotate-[2deg] rounded-b bg-surface-sunken" />
        <div className="relative rotate-[-3.5deg] rounded-[14px] border border-line bg-surface p-5 text-center shadow-[0_10px_24px_-16px_rgb(28_25_23/0.22)]">
          <PlateMark size={16} className="mx-auto" />
          <p className="mt-2 font-display text-[1.15rem] font-semibold leading-tight text-ink">
            Spice Garden
          </p>
          <div className="my-3 border-t border-line" />
          <QrGlyph size={112} className="mx-auto text-ink" />
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[0.6875rem] uppercase tracking-[0.18em] text-muted">Table 4</p>
          </div>
        </div>
      </div>
      <MockDescription>
        A printed table card standing on a table: the restaurant name, a QR code, and the label
        Table 4.
      </MockDescription>
    </div>
  )
}
