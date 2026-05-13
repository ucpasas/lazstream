import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    // Exclude laz-perf from Vite's pre-bundler — it lives in public/lib/
    // and is loaded at runtime via dynamic import() inside the worker.
    exclude: ['laz-perf'],
  },
  // Note: worker.format only affects vite build (production).
  // Vite dev mode always produces module workers regardless of this setting.
  // Our decode-worker.ts uses dynamic import() which works in module workers.
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm', '**/*.wgsl'],
})