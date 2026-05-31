import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig({
  publicDir: resolve(__dirname, '../viewer/public/lib'),
  plugins: [
    dts({ include: ['src'], exclude: ['src/workers/decode-worker.ts'] }),
  ],
  build: {
    lib: {
      entry: {
        index:           resolve(__dirname, 'src/index.ts'),
        'decode-worker': resolve(__dirname, 'src/workers/decode-worker.ts'),
      },
      formats: ['es'],
    },
  },
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['laz-perf'] },
})
