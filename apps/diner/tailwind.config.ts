import type { Config } from 'tailwindcss'

/**
 * Colours are declared as `var(--tx-*)` rather than literal hex so that a single set of CSS
 * variables in globals.css is the one definition of each colour, and so a restaurant-specific
 * palette can be injected later as a single <style> block. The theme is light-only -- see the
 * note in globals.css.
 *
 * The trade-off, stated because it will otherwise surprise someone: Tailwind's opacity
 * modifiers do NOT work on these tokens (`bg-surface/50` produces nothing usable), since
 * that requires the variable to hold a bare channel triplet rather than a colour. Encoding
 * them as triplets was rejected -- it makes the theme unreadable and unusable from plain CSS
 * for the sake of a modifier. For a scrim or a tint, use Tailwind's own palette
 * (`bg-black/40`) or add a dedicated token.
 */
const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    // packages/ui is shared with the admin app, so its classes must be scanned here too or
    // they get purged out of the diner build (docs/DECISIONS.md D11).
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--tx-bg)',
        surface: 'var(--tx-surface)',
        // A second, slightly recessed surface: section headers and disabled dish cards.
        'surface-sunken': 'var(--tx-surface-sunken)',
        ink: 'var(--tx-ink)',
        muted: 'var(--tx-muted)',
        line: 'var(--tx-line)',
        accent: 'var(--tx-accent)',
        // Foreground for text sitting ON accent. Kept as its own token rather than assumed to
        // be white, so a future warmer or paler accent only has to change one pair.
        'accent-ink': 'var(--tx-accent-ink)',
        'accent-soft': 'var(--tx-accent-soft)',
        veg: 'var(--tx-veg)',
        nonveg: 'var(--tx-nonveg)',
        egg: 'var(--tx-egg)',
      },
      fontFamily: {
        // No webfont anywhere in this app: a font file is 20-100KB of blocking payload on a
        // 3G connection for a menu that reads fine in the system face (PRD 7).
        sans: ['var(--tx-font-sans)'],
      },
      fontSize: {
        // Above Tailwind's scale on purpose -- this is read one-handed in dim restaurant
        // lighting, so dish names and prices get a floor.
        'dish-name': ['1.0625rem', { lineHeight: '1.35rem', fontWeight: '600' }],
        price: ['1.0625rem', { lineHeight: '1.35rem', fontWeight: '600' }],
      },
      spacing: {
        // The 44px minimum tap target, as a named token so a control cannot drift under it
        // by someone picking h-10 (40px) because it looked right on a desktop screen.
        tap: '2.75rem',
      },
      minHeight: { tap: '2.75rem' },
      minWidth: { tap: '2.75rem' },
      borderRadius: { card: '0.875rem' },
      boxShadow: {
        // The sticky cart bar needs to read as floating above the menu it covers. Upward
        // only, because the shadow is on the top edge of a bottom-anchored bar.
        bar: '0 -1px 12px rgb(0 0 0 / 0.08)',
        card: '0 1px 2px rgb(0 0 0 / 0.05)',
      },
      maxWidth: {
        // Desktop is not a v1 target (PRD 7), but an accidentally-wide window should not
        // stretch a phone layout to 2000px. This caps it as a phone-shaped column.
        phone: '30rem',
      },
    },
  },
  plugins: [],
}

export default config
