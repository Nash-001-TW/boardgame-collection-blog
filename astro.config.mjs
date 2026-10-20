
// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'static',
  adapter: cloudflare(),

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
