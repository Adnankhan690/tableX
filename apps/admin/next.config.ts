import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * The workspace packages ship TypeScript source, not a build step (see their
   * package.json `main`). Without transpiling them here, Next hands raw .ts to the
   * runtime and the first import of @tablex/shared fails at boot.
   */
  transpilePackages: ['@tablex/shared', '@tablex/api-client', '@tablex/ui'],

  images: {
    /**
     * Menu photographs come from two places and neither hostname is known at build time:
     * this deployment's own R2 bucket, whose public origin is run-time configuration
     * (docs/DECISIONS.md D15), and whatever site a restaurant pasted a URL from.
     *
     * A wildcard host makes the Next image optimiser an open proxy for arbitrary URLs. The
     * exposure is much smaller here than in the diner app -- every route that renders one of
     * these is behind a staff login -- but it is the same shape, and the same narrowing
     * applies once a deployment serves only uploaded photos: replace the wildcard with the
     * bucket hostname.
     *
     * The thumbnails this renders are 40px, so they cost the optimiser almost nothing; see
     * the explicit `sizes` in components/dish-photo.tsx, without which Next would fetch a
     * full-resolution photograph per menu row.
     */
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
}

export default config
