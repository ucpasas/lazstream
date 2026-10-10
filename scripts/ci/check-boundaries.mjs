// Enforces the Core Extension Contract (wiki/concepts/core-extension-contract.md).
// Phase 0 of wiki [[Extension Sockets — Implementation Plan]].
//
//   1. Name guard  — core/viewer source never names an add-on.
//   2. Dependencies — core has no @lazstream/* deps; the viewer's only
//      @lazstream/* dep is @lazstream/core (package.json, every dep section).
//   3. Imports     — core/viewer source never imports another @lazstream/*
//      package except viewer → @lazstream/core, and never relative-imports
//      outside its own package (allowlist below).
//   4. Fixture     — packages/_socket-fixture imports core/viewer only through
//      their published `exports` entry points (no deep / relative paths).
//
// Usage: node scripts/ci/check-boundaries.mjs   (exit 1 on any violation)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

/** Add-on names core and viewer must never contain. Specific names only:
 *  bare "epoch" / "provenance" would trip on GPS-time docs and npm provenance. */
const ADDON_NAME = /\b(m3c2|epoch-?diff|tile-?vitals|provenance-?x|vendor-?tell)\b/i

/** Relative imports allowed to leave their package: [importer, target package dir].
 *  Each entry needs a reason; keep this list short. */
const RELATIVE_ESCAPE_ALLOW = [
  // Demo app (not in the lib build, which imports core by name only): Vite
  // ?worker&url needs the worker's source path for dev hot reload.
  ['packages/viewer/src/main.ts', 'packages/core'],
]

const PACKAGES = {
  core:    { dir: 'packages/core',   allowedLazstream: [] },
  viewer:  { dir: 'packages/viewer', allowedLazstream: ['@lazstream/core'] },
}
const FIXTURE_DIR = 'packages/_socket-fixture'
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|wgsl)$/

const violations = []
const fail = (msg) => violations.push(msg)

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))
}

function walk(dir) {
  const out = []
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return out
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(child))
    else if (SOURCE_EXT.test(entry.name)) out.push(child)
  }
  return out
}

/** Blank out comments (block, and whole-line //) so usage examples in docs
 *  aren't read as imports. Newlines are kept so line numbers stay exact. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** Module specifiers of static imports/exports, dynamic import() and import 'x'. */
function specifiers(source) {
  source = stripComments(source)
  const re = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g
  const out = []
  for (const m of source.matchAll(re)) {
    const spec = m[1] ?? m[2] ?? m[3]
    const line = source.slice(0, m.index).split('\n').length
    out.push({ spec, line })
  }
  return out
}

/** Published entry specifiers of a package, from its `exports` map. */
function publicEntries(pkgDir) {
  const pkg = readJson(path.join(pkgDir, 'package.json'))
  const keys = pkg.exports ? Object.keys(pkg.exports) : ['.']
  return keys.map(k => (k === '.' ? pkg.name : `${pkg.name}/${k.replace(/^\.\//, '')}`))
}

// ── 1 + 3: core / viewer source ─────────────────────────────────────────────
for (const [name, { dir, allowedLazstream }] of Object.entries(PACKAGES)) {
  for (const file of walk(path.join(dir, 'src'))) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')

    source.split('\n').forEach((text, i) => {
      const m = text.match(ADDON_NAME)
      if (m) fail(`[name] ${file}:${i + 1} names add-on "${m[0]}" — core/viewer must not name or detect add-ons`)
    })

    for (const { spec, line } of specifiers(source)) {
      if (spec.startsWith('@lazstream/')) {
        const pkgName = spec.split('/').slice(0, 2).join('/')
        if (!allowedLazstream.includes(pkgName) || spec !== pkgName) {
          fail(`[import] ${file}:${line} imports "${spec}" — ${name} may import ` +
            (allowedLazstream.length ? allowedLazstream.join(', ') + ' (entry point only)' : 'no @lazstream/* package'))
        }
        continue
      }
      if (!spec.startsWith('.')) continue
      const target = rel(path.resolve(path.join(ROOT, path.dirname(file)), spec.split('?')[0]))
      if (target === dir || target.startsWith(dir + '/')) continue
      const allowed = RELATIVE_ESCAPE_ALLOW.some(([f, t]) => f === file && (target === t || target.startsWith(t + '/')))
      if (!allowed) fail(`[import] ${file}:${line} relative import "${spec}" leaves ${dir}`)
    }
  }
}

// ── 2: package.json dependency direction ────────────────────────────────────
for (const [name, { dir, allowedLazstream }] of Object.entries(PACKAGES)) {
  const pkg = readJson(path.join(dir, 'package.json'))
  for (const section of DEP_SECTIONS) {
    for (const dep of Object.keys(pkg[section] ?? {})) {
      if (dep.startsWith('@lazstream/') && !allowedLazstream.includes(dep)) {
        fail(`[deps] ${dir}/package.json ${section} has "${dep}" — ${name} may depend on ` +
          (allowedLazstream.length ? allowedLazstream.join(', ') : 'no @lazstream/* package'))
      }
    }
  }
}

// ── 4: fixture uses public entry points only ────────────────────────────────
if (fs.existsSync(path.join(ROOT, FIXTURE_DIR))) {
  const allowed = new Set([
    ...publicEntries(PACKAGES.core.dir),
    ...publicEntries(PACKAGES.viewer.dir),
  ])
  for (const file of walk(path.join(FIXTURE_DIR, 'src'))) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    for (const { spec, line } of specifiers(source)) {
      if (spec.startsWith('@lazstream/') && !allowed.has(spec)) {
        fail(`[fixture] ${file}:${line} imports "${spec}" — only public entries: ${[...allowed].join(', ')}`)
      }
      if (spec.startsWith('.')) {
        const target = rel(path.resolve(path.join(ROOT, path.dirname(file)), spec.split('?')[0]))
        if (!target.startsWith(FIXTURE_DIR + '/')) {
          fail(`[fixture] ${file}:${line} relative import "${spec}" leaves the fixture — use the public API`)
        }
      }
    }
  }
} else {
  fail(`[fixture] ${FIXTURE_DIR} is missing`)
}

if (violations.length > 0) {
  console.error(`check-boundaries: ${violations.length} violation(s)\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nSee wiki/concepts/core-extension-contract.md')
  process.exit(1)
}
console.log('check-boundaries: OK (name guard, dependency direction, imports, fixture)')
