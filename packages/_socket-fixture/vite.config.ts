// Browser harness build (T3, wiki [[Extension Sockets — Build Plan]] PR-0).
//
// Builds browser/ the way an npm consumer's Vite app would: @lazstream/core
// resolves through package.json `exports` to the built dist (no aliases, no
// source paths), with the documented consumer plugin. The core test fixtures
// are the public dir, so the preview server serves them same-origin with
// Range support — no cloud access in CI.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { lazstreamVitePlugin } from '@lazstream/viewer/vite'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export const HARNESS_PORT = 4179

export default defineConfig({
  root: here('./browser'),
  publicDir: here('../core/test/fixtures'),
  plugins: [lazstreamVitePlugin()],
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
  },
  worker: { format: 'es' },
  // ?url= collides with Vite's /[?&]url\b/ transform regex (see viewer config).
  server: { fs: { strict: false }, port: HARNESS_PORT, strictPort: true },
  preview: { port: HARNESS_PORT, strictPort: true },
})
