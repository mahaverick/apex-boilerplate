import { describe, expect, it } from 'vite-plus/test'
import { ENTITLEMENT_LABELS, entitlementLabel } from '@/constants/entitlements'
import { testPlans } from '@/tests/fixtures/billing'

describe('entitlementLabel', () => {
  it('names each registry key as express’s catalog does', () => {
    // The fixture catalog is express's GET /platform/plans answer, so the mirror must match it.
    for (const entry of testPlans.catalog) {
      expect(ENTITLEMENT_LABELS[entry.key]).toBe(entry.label)
    }
    expect(Object.keys(ENTITLEMENT_LABELS).sort()).toEqual(
      testPlans.catalog.map((entry) => entry.key).sort()
    )
  })

  it('falls back to the key for one this build does not know, inherited names included', () => {
    expect(entitlementLabel('members')).toBe('Members')
    expect(entitlementLabel('seats_v2')).toBe('seats_v2')
    expect(entitlementLabel('toString')).toBe('toString')
  })
})
