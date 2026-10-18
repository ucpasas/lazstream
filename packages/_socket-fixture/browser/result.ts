/** Contract between harness.ts (writes) and smoke.spec.ts (reads). */
export interface CheckResult { name: string; ok: boolean; ms: number; detail: string }
export interface HarnessResult { done: boolean; ok: boolean; mode: 'fixtures' | 'remote'; checks: CheckResult[] }

declare global {
  interface Window { __lazstreamHarness?: HarnessResult }
}
