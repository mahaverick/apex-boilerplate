import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, navGroupsFor, navItemsFor } from '@/constants/navigation'

describe('navigation', () => {
  it('gives a viewer Overview and Tenants, not the activity log', () => {
    expect(navItemsFor('viewer').map((item) => item.label)).toEqual(['Overview', 'Tenants'])
  })

  it('gives an admin every item', () => {
    expect(navItemsFor('admin').map((item) => item.label)).toEqual([
      'Overview',
      'Tenants',
      'Activity log',
    ])
  })

  it('gives someone who is not staff nothing', () => {
    expect(navItemsFor(null)).toEqual([])
    expect(navItemsFor(undefined)).toEqual([])
  })

  it('groups in NAV_GROUPS order and drops empty groups', () => {
    expect(navGroupsFor('viewer').map((entry) => entry.group)).toEqual(['General', 'Directory'])
    expect(navGroupsFor('owner').map((entry) => entry.group)).toEqual([
      'General',
      'Directory',
      'Security',
    ])
  })

  it('has unique destinations', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.to)).size).toBe(NAV_ITEMS.length)
  })
})
