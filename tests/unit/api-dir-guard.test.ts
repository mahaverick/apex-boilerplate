// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { apiDirPlan } from '../../scripts/api-dir-guard.mjs'

/** The refusal text of a plan, failing the test when the plan resolved. */
function refusalOf(plan: ReturnType<typeof apiDirPlan>): string {
  if (!('refusal' in plan)) throw new Error('expected a refusal')
  return plan.refusal
}

const pkg = { scripts: { 'platform:grant': 'tsx x.ts' } }
const fs = {
  realpath: (p: string) => {
    if (p.startsWith('/missing')) throw new Error('ENOENT')
    return p
  },
  readJson: (file: string) => (file === '/api/package.json' ? pkg : null),
}

describe('apiDirPlan', () => {
  it('refuses an unset value, naming the variable', () => {
    const plan = apiDirPlan({ apiDir: undefined, use: 'grant', ...fs })
    expect(refusalOf(plan)).toMatch(/E2E_API_DIR, which is unset/)
  })

  it('refuses an empty value', () => {
    expect(apiDirPlan({ apiDir: '', use: 'grant', ...fs })).toHaveProperty('refusal')
  })

  it('refuses a directory that does not exist', () => {
    const plan = apiDirPlan({ apiDir: '/missing', use: 'grant', ...fs })
    expect(refusalOf(plan)).toMatch(/\/missing does not exist/)
  })

  it('refuses a directory without a readable package.json', () => {
    const plan = apiDirPlan({ apiDir: '/elsewhere', use: 'grant', ...fs })
    expect(refusalOf(plan)).toMatch(/no readable package\.json/)
  })

  it('refuses a package.json without the script, and one without scripts', () => {
    const plan = apiDirPlan({ apiDir: '/api', use: 'fire', script: 'email:fire-event', ...fs })
    expect(refusalOf(plan)).toMatch(/no email:fire-event script/)
    const bare = apiDirPlan({
      apiDir: '/api',
      use: 'fire',
      script: 'x',
      ...fs,
      readJson: () => ({}),
    })
    expect(bare).toHaveProperty('refusal')
  })

  it('resolves a directory holding the script, or any package.json when no script is run', () => {
    expect(apiDirPlan({ apiDir: '/api', use: 'grant', script: 'platform:grant', ...fs })).toEqual({
      dir: '/api',
    })
    expect(apiDirPlan({ apiDir: '/api', use: 'backdate', ...fs })).toEqual({ dir: '/api' })
  })
})
