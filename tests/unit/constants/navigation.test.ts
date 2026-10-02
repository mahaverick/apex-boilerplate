import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, NAV_ITEMS, navGroupsFor, navItemsFor } from '@/constants/navigation'

describe('navigation', () => {
  it('gives a viewer the Directory, Operations and Growth pages, not the activity log', () => {
    expect(navItemsFor('viewer').map((item) => item.label)).toEqual([
      'Overview',
      'Tenants',
      'Users',
      'Staff',
      'Emails',
      'Deliverability',
      'Suppressions',
      'Onboarding',
    ])
  })

  it('gives an admin every item', () => {
    expect(navItemsFor('admin').map((item) => item.label)).toEqual([
      'Overview',
      'Tenants',
      'Users',
      'Staff',
      'Emails',
      'Deliverability',
      'Suppressions',
      'Onboarding',
      'Activity log',
    ])
  })

  it('gives someone who is not staff nothing', () => {
    expect(navItemsFor(null)).toEqual([])
    expect(navItemsFor(undefined)).toEqual([])
  })

  it('sections the sidebar with Growth between Operations and Security', () => {
    expect(NAV_GROUPS).toEqual(['General', 'Directory', 'Operations', 'Growth', 'Security'])
  })

  it('groups in NAV_GROUPS order and drops empty groups', () => {
    expect(navGroupsFor('viewer').map((entry) => entry.group)).toEqual([
      'General',
      'Directory',
      'Operations',
      'Growth',
    ])
    expect(navGroupsFor('owner').map((entry) => entry.group)).toEqual([
      'General',
      'Directory',
      'Operations',
      'Growth',
      'Security',
    ])
  })

  it('has unique destinations', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.to)).size).toBe(NAV_ITEMS.length)
  })
})
