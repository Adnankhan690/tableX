import Image from 'next/image'

/**
 * A dish photo, or a stable stand-in.
 *
 * `image_url` is optional in the schema and most restaurants will not photograph their whole
 * menu, so the placeholder is the common case rather than an edge case. It is derived from the
 * dish name so it stays the same across renders and reloads -- a colour that changed on every
 * visit would read as a rendering bug.
 */

/** Muted, food-adjacent tints. Deliberately low-saturation so they recede behind the text. */
const PLACEHOLDER_TINTS = [
  'bg-[#e9dcc6] text-[#70562c]',
  'bg-[#dfe6d5] text-[#4e6238]',
  'bg-[#eddad5] text-[#7d4a3f]',
  'bg-[#dbe1ea] text-[#465468]',
  'bg-[#ece0ea] text-[#6b4a63]',
] as const

/** A small deterministic hash, so the same dish always gets the same tint. */
function tintFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 1_000_003
  }
  // noUncheckedIndexedAccess is on, so the fallback is required rather than decorative.
  return PLACEHOLDER_TINTS[hash % PLACEHOLDER_TINTS.length] ?? PLACEHOLDER_TINTS[0]
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? '?'
  const second = words[1]?.[0] ?? ''
  return (first + second).toUpperCase()
}

export function DishImage({ name, url, size = 76 }: { name: string; url?: string; size?: number }) {
  if (!url) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-card font-semibold ${tintFor(name)}`}
        style={{ width: size, height: size }}
        // aria-hidden because the dish name is already adjacent in the DOM; announcing
        // "PT" after it would just be noise.
        aria-hidden="true"
      >
        {initials(name)}
      </div>
    )
  }

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-card bg-surface-sunken"
      style={{ width: size, height: size }}
    >
      <Image
        src={url}
        alt=""
        fill
        // An explicit sizes value, because `fill` otherwise makes Next request the largest
        // candidate -- which on a photo-heavy menu over 3G is exactly the payload PRD 7 is
        // about.
        sizes={`${size * 2}px`}
        className="object-cover"
        // Menus are long; only the images actually scrolled to should be fetched.
        loading="lazy"
      />
    </div>
  )
}
