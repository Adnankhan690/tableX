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
     * Dish photos come from whatever host the restaurant already uses -- a Cloudinary
     * account, a Shopify CDN, or a URL pasted out of their existing website. We do not know
     * the hostnames at build time and a restaurant cannot be asked to redeploy the diner app
     * to add a photo, so any https host is allowed.
     *
     * The cost is real and worth stating: this makes /_next/image an open image proxy, so a
     * third party can have our server fetch and cache arbitrary images at our bandwidth
     * expense. Accepted for v1 because the alternative -- an allowlist -- breaks the
     * restaurant's own menu photos, which is a product failure rather than a cost. The fix
     * when it matters is uploading through our own storage and narrowing this to one host,
     * which is additive and needs no schema change.
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
