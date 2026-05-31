import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    resolve: {
      // Dev mode: resolve core from TypeScript source for hot reload.
      // Omitted in lib mode so that @lazstream/core stays external in the bundle.
      alias: !isLib ? {
        '@lazstream/core': resolve(__dirname, '../core/src/index.ts'),
      } : {},
    },
    plugins: isLib ? [
      dts({ include: ['src'], rollupTypes: true, tsconfigPath: resolve(__dirname, 'tsconfig.lib.json') }),
    ] : [],
    publicDir: isLib ? false : undefined,
    build: {
      outDir: isLib ? 'dist' : 'dist-app',
      lib: isLib ? {
        entry: resolve(__dirname, 'src/index.ts'),
        formats: ['es'],
        fileName: 'index',
      } : undefined,
      rollupOptions: isLib ? {
        external: ['three', /^three\//, '@lazstream/core'],
      } : undefined,
    },
    worker: { format: 'es' },
    assetsInclude: ['**/*.wasm', '**/*.wgsl'],
    optimizeDeps: { exclude: ['laz-perf'] },
  }
})
