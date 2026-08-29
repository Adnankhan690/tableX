import { parseBaseUrl } from './env'

/**
 * Build-time configuration for the PUBLIC marketing page at `/`.
 *
 * Kept apart from `env.ts` because the two have different audiences and different failure
 * modes: `env.ts` configures the diner flow and its values are wrong only if the backend moves,
 * whereas everything here is a link a stranger clicks on the open internet. The same literal
 * `process.env.NEXT_PUBLIC_X` rule applies — Next's inlining is a textual substitution, so a
 * computed key reads an empty object in the browser (see the note at the top of env.ts).
 */

/** Localhost defaults so a fresh clone renders the landing page with no .env file at all. */
const DEFAULT_SITE_URL = 'http://localhost:3000'
const DEFAULT_ADMIN_BASE_URL = 'http://localhost:3001'

/** Origin of this site, no trailing slash. Feeds metadataBase, the canonical, robots, sitemap. */
export const SITE_URL: string = parseBaseUrl(
  'NEXT_PUBLIC_SITE_URL',
  process.env.NEXT_PUBLIC_SITE_URL,
  DEFAULT_SITE_URL,
  ['http:', 'https:'],
)

/** Origin of the admin app, for the "Staff sign in" link. */
export const ADMIN_BASE_URL: string = parseBaseUrl(
  'NEXT_PUBLIC_ADMIN_BASE_URL',
  process.env.NEXT_PUBLIC_ADMIN_BASE_URL,
  DEFAULT_ADMIN_BASE_URL,
  ['http:', 'https:'],
)

/**
 * Where "Email us about your restaurant" goes.
 *
 * Empty is a legitimate state in development and CI, and the page degrades to an in-page
 * anchor. It is NOT a legitimate state in production — see the gate below.
 */
export const CONTACT_EMAIL: string = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim()

/**
 * Slug of a restaurant onboarded *as a demo*, or empty.
 *
 * Gated rather than hardcoded because the two failure modes are both bad in public: a slug that
 * does not exist sends a prospect to a 404 on a page whose whole argument is reliability, and a
 * paying tenant's slug walks strangers into a live menu and mints guest sessions on their
 * tables. Unset, the demo section and the hero's secondary CTA fall back to an in-page anchor.
 */
export const DEMO_RESTAURANT_SLUG: string = (
  process.env.NEXT_PUBLIC_DEMO_RESTAURANT_SLUG ?? ''
).trim()

/**
 * A production build of the public site with no contact address ships a page whose primary
 * call to action goes nowhere. That is worse than a failed build.
 *
 * Scoped to https so `next build` in CI and a local production build against localhost both
 * stay green — the condition is "this artefact is going somewhere real", not "NODE_ENV".
 */
if (process.env.NODE_ENV === 'production' && SITE_URL.startsWith('https://') && !CONTACT_EMAIL) {
  throw new Error(
    'NEXT_PUBLIC_CONTACT_EMAIL is required for a production build of the landing page',
  )
}

/**
 * NOTE: the `mailto:` itself is NOT built here.
 *
 * It was, back when every CTA was a bare mail link. The demo form now composes its own from the
 * four answers it collects (`sections/book-demo.tsx`), so a second copy here would be a second
 * definition of the subject line and body -- and the one that is easier to find is the one that
 * is not used. What stays here is the address and the build-time guard above it, because those
 * are configuration; the message is not.
 */
export const DEMO_MENU_HREF = DEMO_RESTAURANT_SLUG ? `/r/${DEMO_RESTAURANT_SLUG}` : ''
