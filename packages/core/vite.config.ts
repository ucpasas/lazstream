import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

/** Runtime assets index.js locates via `new URL('./<file>', import.meta.url)`. */
const RUNTIME_ASSETS = ['decode-worker.js', 'laz-perf-worker.js', 'laz-perf-worker.wasm']

/**
 * Emit the runtime asset URLs in the canonical form consumer bundlers detect.
 *
 * Our own lib build can't resolve these files (decode-worker is a separate
 * entry; laz-perf comes from publicDir), so the source carries /* @vite-ignore *\/
 * and Vite rewrites the rest to `new URL(x, "" + import.meta.url)`. Both forms
 * survive into dist and tell the *consumer's* bundler to skip them too — so a
 * consumer's production build shipped none of the three files and every
 * decode worker failed to start. Rewriting to the plain
 * `new URL("./<file>", import.meta.url)` form lets Vite / webpack 5 / Parcel
 * emit them; native ESM and CDN use resolve exactly as before.
 *
 * Fails the build unless each asset is found exactly once, so a refactor of
 * worker-pool.ts can't silently reintroduce the bug. Regression test: the
 * `prod` leg of the browser smoke workflow.
 */
function consumerAssetUrls(): Plugin {
  return {
    name: 'lazstream:consumer-asset-urls',
    apply: 'build',
    renderChunk(code, chunk) {
      if (chunk.name !== 'index') return null
      let out = code
      for (const file of RUNTIME_ASSETS) {
        const escaped = file.replace(/\./g, '\\.')
        const re = new RegExp(
          String.raw`new\s+URL\(\s*(?:/\*\s*@vite-ignore\s*\*/\s*)?(["'\x60])\./` + escaped +
          String.raw`\1\s*,\s*(?:""\s*\+\s*)?import\.meta\.url\s*\)`,
          'g',
        )
        const hits = out.match(re)?.length ?? 0
        if (hits !== 1) this.error(`consumer-asset-urls: expected 1 reference to ./${file} in index.js, found ${hits}`)
        out = out.replace(re, `new URL("./${file}", import.meta.url)`)
      }
      return { code: out, map: null }
    },
  }
}

export default defineConfig({
  publicDir: resolve(__dirname, '../viewer/public/lib'),
  plugins: [
    dts({ include: ['src'], exclude: ['src/workers/decode-worker.ts'] }),
    consumerAssetUrls(),
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
