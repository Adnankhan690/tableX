import type { Config } from 'tailwindcss'

/**
 * The admin theme is deliberately unlike the diner app's (docs/DECISIONS.md D11): cool and
 * neutral where that one is warm. A staff member switching between the two on the same tablet
 * must never be unsure which they are looking at, and colour is what tells them at a glance.
 *
 * As in the diner app, colours are `var(--ad-*)` rather than literal hex: it keeps one
 * definition per colour in globals.css, and it leaves room to inject a per-restaurant palette as
 * a single <style> block without rebuilding. The theme is light-only -- see the note in
 * globals.css. The same caveat applies as in the diner app: Tailwind opacity modifiers do not
 * work on these tokens.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--ad-bg)',
        surface: 'var(--ad-surface)',
        'surface-sunken': 'var(--ad-surface-sunken)',
        ink: 'var(--ad-ink)',
        muted: 'var(--ad-muted)',
        line: 'var(--ad-line)',
        accent: 'var(--ad-accent)',
        'accent-ink': 'var(--ad-accent-ink)',
        'accent-soft': 'var(--ad-accent-soft)',
        danger: 'var(--ad-danger)',
        'danger-soft': 'var(--ad-danger-soft)',
        success: 'var(--ad-success)',

        // Order age escalation. Three steps rather than a gradient, because staff need to
        // recognise "this one is late" instantly, and a continuous ramp gives no threshold to
        // recognise.
        'age-warn': 'var(--ad-age-warn)',
        // The warn card's outline. Separate from the fill because a card whose border and
        // background are the same colour is the one card on the board with no visible edge.
        'age-warn-line': 'var(--ad-age-warn-line)',
        'age-late': 'var(--ad-age-late)',
      },
      fontFamily: { sans: ['var(--ad-font-sans)'] },
      borderRadius: { card: '0.625rem' },
      boxShadow: { card: '0 1px 2px rgb(15 23 42 / 0.06)' },
      spacing: { tap: '2.5rem' },
      minHeight: { tap: '2.5rem' },
    },
  },
  plugins: [],
}

export default config
