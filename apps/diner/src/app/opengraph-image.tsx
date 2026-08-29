import { ImageResponse } from 'next/og'

/**
 * The Open Graph card, drawn rather than photographed.
 *
 * It exists because `(marketing)/layout.tsx` declares `twitter: { card: 'summary_large_image' }`,
 * and that declaration without an image is worse than not making it: the platforms fall back to
 * a bare link with a blank slab where the picture should be, on the one surface where the page
 * gets shared. There is no `public/` directory in this app and no photography to put in one, so
 * the card is generated from the same tokens the page itself uses.
 *
 * Lives at `app/`, not in `(marketing)`: metadata files resolve from the app directory root, and
 * this is the site-wide card. The diner routes never reference it -- they are noindex and nobody
 * shares a table session -- so it costs them nothing.
 *
 * Colours are literal hex rather than `var(--tx-*)`. Satori rasterises this on the server with no
 * stylesheet in scope, so a CSS variable resolves to nothing and the card renders black on black.
 * The values are copied from globals.css and must be changed with it.
 */

export const alt = 'tabley — QR table ordering for Indian restaurants'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#fffcf8'
const INK = '#1c1917'
const MUTED = '#6d6560'
const ACCENT = '#ad5207'
const LINE = '#e7dccd'

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: BG,
        padding: '72px 80px',
        // Satori has no default font stack of its own, so naming the families the host has is
        // what keeps this from falling back to a notdef box for every glyph.
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            width: 44,
            height: 44,
            borderRadius: 12,
            background: ACCENT,
            alignItems: 'center',
            justifyContent: 'center',
            color: BG,
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          t
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, color: INK, letterSpacing: -0.5 }}>tabley</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            color: INK,
            lineHeight: 1.05,
            letterSpacing: -2.5,
            maxWidth: 900,
          }}
        >
          The code on the table is the whole ordering counter.
        </div>
        <div style={{ marginTop: 28, fontSize: 30, color: MUTED, lineHeight: 1.35, maxWidth: 860 }}>
          Diners scan, order and pay from their own phone. Nothing to install, nothing to log in to.
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          borderTop: `1px solid ${LINE}`,
          paddingTop: 28,
          fontSize: 24,
          color: MUTED,
        }}
      >
        <span style={{ color: ACCENT, fontWeight: 600 }}>tabley.in</span>
        <span>Built for Indian restaurants</span>
      </div>
    </div>,
    size,
  )
}
