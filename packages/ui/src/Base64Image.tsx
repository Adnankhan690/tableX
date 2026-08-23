import { cn } from './cn'

export interface Base64ImageProps {
  /** Raw base64 PNG bytes, without the data-URI prefix. */
  png: string
  alt: string
  /** Rendered edge length in CSS pixels. QR codes are square. */
  size: number
  className?: string
}

/**
 * Renders a base64 PNG that arrived in an API response.
 *
 * This exists as a component for one reason: it is the single place a plain `<img>` is correct in
 * either app, so the lint suppression lives here once instead of at every call site. next/image
 * cannot optimise a data URI -- the bytes are already in the document, so routing them through
 * /_next/image adds a request and a proxy hop to produce the same pixels.
 *
 * Used for table QR codes and UPI payment QR codes. Both are square, both come from the server
 * pre-rendered (so a diner's phone downloads no QR library on a 3G connection), and both need a
 * white background regardless of theme -- a scanner reading a QR inverted in dark mode is a
 * support call nobody enjoys.
 */
// No next/image suppression is needed here: that rule only fires inside a Next app, and this is a
// plain library. Keeping the <img> in this package rather than in either app is what makes that
// true -- which is a second, smaller reason for the component to exist.
export function Base64Image({ png, alt, size, className }: Base64ImageProps) {
  return (
    <img
      src={`data:image/png;base64,${png}`}
      alt={alt}
      width={size}
      height={size}
      className={cn('bg-white', className)}
      data-base64-image=""
    />
  )
}
