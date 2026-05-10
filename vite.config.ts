import { defineConfig } from 'vite'

export default defineConfig({
  // Allow laz-perf WASM to load correctly
  optimizeDeps: {
    exclude: ['laz-perf']
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer in future phases
      // Included now so we don't need to reconfigure later
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  }
})