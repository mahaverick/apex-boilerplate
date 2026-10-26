import { describe, expect, it } from 'vite-plus/test'
import { testFreeTenantBilling, testPlans, testTenantBilling } from '@/tests/fixtures/billing'
import type { EntitlementValue, StaffTenantBilling } from '@/types/billing.types'

/**
 * What express's `mergeEntitlements` (billing-rules.utilities.ts) gives a
 * tenant: its plan's values, raised by its active grants. A feature grant
 * turns a feature on; a limit grant takes the larger limit, null being no
 * limit, so a grant never lowers a limit. A key changes source only when a
 * grant changes its value.
 */
function merged(view: StaffTenantBilling) {
  const plan = testPlans.plans.find((candidate) => candidate.key === view.plan.key)
  const values: Record<string, EntitlementValue> = { ...plan?.entitlements }
  const sources: Record<string, 'plan' | 'grant'> = {}
  for (const key of Object.keys(values)) sources[key] = 'plan'
  for (const grant of view.grants) {
    if (grant.status !== 'active') continue
    const entry = testPlans.catalog.find((candidate) => candidate.key === grant.key)
    const current = values[grant.key]
    if (entry?.kind === 'feature') {
      if (current !== true) [values[grant.key], sources[grant.key]] = [true, 'grant']
      continue
    }
    if (typeof current !== 'number' && current !== null) continue
    if (typeof grant.value !== 'number' && grant.value !== null) continue
    const next = current === null || grant.value === null ? null : Math.max(current, grant.value)
    if (next !== current) [values[grant.key], sources[grant.key]] = [next, 'grant']
  }
  return { values, sources }
}

describe('billing fixtures', () => {
  it.each([
    ['the paying tenant', testTenantBilling],
    ['the Free tenant', testFreeTenantBilling],
  ])('give %s the entitlements and sources express would', (_name, view) => {
    const { values, sources } = merged(view)
    for (const entry of testPlans.catalog) {
      const shown =
        entry.kind === 'feature'
          ? view.entitlements.features[entry.key]
          : view.entitlements.limits[entry.key]?.limit
      expect(shown, entry.key).toBe(values[entry.key])
    }
    expect(view.sources).toEqual(sources)
  })

  it('keeps an active grant on the paying tenant that changes nothing, and one that raises Free', () => {
    expect(testTenantBilling.grants.some((grant) => grant.status === 'active')).toBe(true)
    expect(testTenantBilling.sources.members).toBe('plan')
    expect(testFreeTenantBilling.sources.members).toBe('grant')
    expect(testFreeTenantBilling.entitlements.limits.members?.limit).toBe(50)
  })
})
