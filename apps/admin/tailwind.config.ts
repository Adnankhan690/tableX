import type { Config } from 'tailwindcss'

/**
 * The admin theme is deliberately unlike the diner app's (docs/DECISIONS.md D11): cool and
 * neutral where that one is warm. A staff member switching between the two on the same tablet
 * must never be unsure which they are looking at, and colour is what tells them at a glance.
 *
 * As in the diner app, colours are `var(--ad-*)` so dark mode is one variable swap rather than
 * a `dark:` variant on every element. The same caveat applies: Tailwind opacity modifiers do
 * not work on these tokens.
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
