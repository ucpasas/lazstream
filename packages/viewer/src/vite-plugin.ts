import type { Plugin } from 'vite'

/**
 * Vite plugin for @lazstream/viewer consumers.
 *
 * Prevents Vite from pre-bundling @lazstream/core during dev mode.
 * Without this, Vite's esbuild pre-bundler rewrites import.meta.url in
 * worker-pool.ts to point at the Vite cache (.vite/deps/), causing every
 * decode worker to fail fetching laz-perf-worker.{js,wasm} with a 404.
 *
 * Usage in vite.config.ts:
 *   import { lazstreamVitePlugin } from '@lazstream/viewer/vite'
 *   export default defineConfig({ plugins: [lazstreamVitePlugin()] })
 */
export function lazstreamVitePlugin(): Plugin {
  return {
    name: 'lazstream',
    config() {
      return {
        optimizeDeps: {
          exclude: ['@lazstream/core', 'laz-perf'],
        },
      }
    },
  }
}
