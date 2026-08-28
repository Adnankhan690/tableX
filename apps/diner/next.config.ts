import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * The workspace packages ship raw TypeScript -- their package.json `main` points at
   * `src/index.ts` with no build step (docs/DECISIONS.md D11). Next has to compile them as
   * if they were app source, which is what this list does. Omitting one produces an
   * "unexpected token" at import time, not a missing-module error, so the failure reads as
   * a syntax bug in a file that is fine.
   */
  transpilePackages: ['@tablex/shared', '@tablex/api-client', '@tablex/ui'],

  images: {
    /**
     * Dish photos come from one of two places, and this has to cover both.
     *
     * Since docs/DECISIONS.md D15 a restaurant can UPLOAD a photo, which is stored in this
     * deployment's own R2 bucket and served from `storage.r2.public_base_url`. That is one
     * known host -- but it is configured at run time, per deployment, and this file is
     * evaluated at build time, so it cannot be named here.
     *
     * The other place is unchanged: a URL pasted out of the restaurant's existing website or
     * Cloudinary account. Those hostnames are unknowable and always will be, and a
     * restaurant cannot be asked to redeploy this app to add a photo.
     *
     * So the wildcard stays, and the cost stays with it, stated plainly: /_next/image is an
     * open image proxy, and a third party can have our server fetch and cache arbitrary
     * images at our bandwidth expense.
     *
     * NARROWING IS NOW POSSIBLE, for a deployment that has moved every restaurant onto
     * uploaded photos: replace the wildcard with that one bucket hostname. It is a one-line
     * change here and needs no schema change, because image_key already resolves through
     * configuration rather than through stored URLs. It is not done by default because it
     * would break the menu of every restaurant still using a pasted URL, and a broken menu
     * is a product failure where an open proxy is a cost.
     *
     * http is deliberately absent: a mixed-content image silently fails to render on an
     * https page, which looks like a broken menu.
     */
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    /** Menus are photo-heavy on 3G (PRD 7); a long cache beats a re-encode per visit. */
    minimumCacheTTL: 60 * 60 * 24,
  },
}

export default nextConfig
