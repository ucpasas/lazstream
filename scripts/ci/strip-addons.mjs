// Zero-add-on build support (Core Extension Contract, enforcement item 2).
// Deletes every workspace package except core and viewer so the following
// filtered build/check/test proves neither depends on anything else in the
// tree. Destructive — refuses to run outside CI unless --force is passed.
//
// Usage (CI): node scripts/ci/strip-addons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const KEEP = new Set(['core', 'viewer'])

if (!process.env.CI && !process.argv.includes('--force')) {
  console.error('strip-addons: deletes workspace packages; runs only in CI (or pass --force)')
  process.exit(1)
}

const packagesDir = path.join(ROOT, 'packages')
const removed = []
for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || KEEP.has(entry.name)) continue
  fs.rmSync(path.join(packagesDir, entry.name), { recursive: true, force: true })
  removed.push(entry.name)
}
console.log(`strip-addons: kept ${[...KEEP].join(', ')}; removed ${removed.length ? removed.join(', ') : '(none)'}`)
