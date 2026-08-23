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
     * Menu photographs are uploaded by the restaurant and served from whatever host the
     * deployment uses, which is not known at build time.
     *
     * A wildcard host makes the Next image optimiser an open proxy for arbitrary URLs, so
     * this should be narrowed to the actual image host (or a signed upload bucket) before
     * the panel is exposed to the internet. It is wide here because staff-only routes
     * behind auth are the only thing rendering these images in v1.
     */
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
}

export default config
