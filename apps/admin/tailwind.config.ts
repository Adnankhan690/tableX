import type { Config } from 'tailwindcss'

/**
 * The admin theme is deliberately unlike the diner app's (docs/DECISIONS.md D11): cool and
 * neutral where that one is warm. A staff member switching between the two on the same tablet
 * must never be unsure which they are looking at, and colour is what tells them at a glance.
 *
 * Colours are `var(--ad-*)` rather than literal hex: it keeps one definition per colour in
 * globals.css, and it leaves room to inject a per-restaurant palette as a single <style> block
 * without rebuilding. The theme is light-only -- see the note in globals.css. The same caveat
 * applies as in the diner app: Tailwind opacity modifiers do not work on these tokens, so every
 * state that looks translucent is its own solid token.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--ad-bg)',
        surface: 'var(--ad-surface)',
        'surface-sunken': 'var(--ad-surface-sunken)',
        field: 'var(--ad-field)',

        ink: 'var(--ad-ink)',
        muted: 'var(--ad-muted)',
        faint: 'var(--ad-faint)',

        // Three weights of line, because one cannot both outline a card and rule a table. See the
        // note in globals.css.
        divider: 'var(--ad-divider)',
        line: 'var(--ad-line)',
        'line-strong': 'var(--ad-line-strong)',

        accent: 'var(--ad-accent)',
        'accent-hover': 'var(--ad-accent-hover)',
        'accent-ink': 'var(--ad-accent-ink)',
        'accent-soft': 'var(--ad-accent-soft)',
        'accent-line': 'var(--ad-accent-line)',

        danger: 'var(--ad-danger)',
        'danger-hover': 'var(--ad-danger-hover)',
        'danger-soft': 'var(--ad-danger-soft)',
        'danger-line': 'var(--ad-danger-line)',
        warning: 'var(--ad-warning)',
        'warning-soft': 'var(--ad-warning-soft)',
        'warning-line': 'var(--ad-warning-line)',
        success: 'var(--ad-success)',
        'success-soft': 'var(--ad-success-soft)',
        'success-line': 'var(--ad-success-line)',

        // Order age escalation. Three steps rather than a gradient, because staff need to
        // recognise "this one is late" instantly and a continuous ramp gives no threshold to
        // recognise. These are card FILLS -- see the contrast note in globals.css, which is the
        // binding constraint on the whole palette.
        'age-warn': 'var(--ad-age-warn)',
        'age-warn-line': 'var(--ad-age-warn-line)',
        'age-late': 'var(--ad-age-late)',
      },
      fontFamily: { sans: ['var(--ad-font-sans)'] },
      fontSize: {
        // A named scale, so a component picks a role rather than a number. Line heights are set
        // here to keep vertical rhythm out of the call sites.
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }], // 11px, column headers only
        xs: ['0.75rem', { lineHeight: '1.125rem' }], // 12px, meta
        sm: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px, dense body and controls
        base: ['0.875rem', { lineHeight: '1.375rem' }], // 14px, body
        lg: ['1rem', { lineHeight: '1.5rem' }], // 16px, card titles
        title: ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.011em' }], // 18px, page h1
        metric: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.014em' }], // 22px, figures
        display: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }], // 24px, auth screens
      },
      borderRadius: {
        control: '0.5rem', // buttons, inputs, chips
        card: '0.625rem', // cards, list containers, popovers
        panel: '0.875rem', // dialogs and the auth card
      },
      boxShadow: {
        // Two levels of elevation in the whole app, and a third only for modals. More than that
        // and "raised" stops meaning anything.
        card: '0 1px 2px rgb(14 21 32 / 0.04), 0 1px 3px rgb(14 21 32 / 0.03)',
        popover: '0 8px 24px rgb(14 21 32 / 0.10), 0 2px 6px rgb(14 21 32 / 0.05)',
        dialog: '0 24px 48px -12px rgb(14 21 32 / 0.25)',
      },
      spacing: { tap: '2.5rem' },
      minHeight: { tap: '2.5rem' },
      minWidth: { tap: '2.5rem' },
      keyframes: {
        // Motion exists here only to signal that something arrived or is waiting. Both are short
        // enough to read as feedback rather than as animation.
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulse: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'rise-in': 'rise-in 140ms ease-out',
        'pulse-slow': 'pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
