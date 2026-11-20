
// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'static',
  // Local build/dev must not open remote binding proxy sessions.
  adapter: cloudflare({ remoteBindings: false }),
  // Only explicitly marked catalog links are warmed; do not crawl every detail page.
  prefetch: { prefetchAll: false },

  vite: {
    ssr: {
      optimizeDeps: {
        exclude: [
          '@astrojs/cloudflare/entrypoints/server',
        ],
      },
    },
  },
});
