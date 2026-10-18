import { test, expect } from '@playwright/test'
import type { HarnessResult } from './result'

// The page runs every check itself (browser/harness.ts); this spec only hosts
// it, waits for window.__lazstreamHarness.done and turns it into pass/fail.
test('shipped sockets work through the built @lazstream/core in a real browser', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`))

  await page.goto('/')
  await page.waitForFunction(() => window.__lazstreamHarness?.done === true, null, { timeout: 170_000 })
  const result = await page.evaluate(() => window.__lazstreamHarness!) as HarnessResult

  for (const c of result.checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name} (${Math.round(c.ms)} ms)${c.detail ? ' — ' + c.detail : ''}`)
  }
  const failed = result.checks.filter(c => !c.ok)
  expect(failed, [...failed.map(c => `${c.name}: ${c.detail}`), ...consoleErrors].join('\n')).toEqual([])
  expect(result.ok).toBe(true)
})
