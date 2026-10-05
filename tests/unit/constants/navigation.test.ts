import { Flag } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import {
  NAV_GROUPS,
  NAV_ITEMS,
  navGroupsFor,
  navItemsFor,
  visibleNavItems,
  type NavItem,
} from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import type { BooleanClientFlagKey } from '@/observability/flags/flag-keys'
import type { ClientFlagValues } from '@/observability/flags/flag-types'

/** A flag key apex does not have: its slice is empty, so the type is `never`. */
const BETA = 'example_apex_beta' as BooleanClientFlagKey

/** A flagged item and an unflagged one, for the filter alone. */
const ITEMS: readonly NavItem[] = [
  { label: 'Plain', to: ROUTES.overview, Icon: Flag, minRole: 'viewer', group: 'General' },
  {
    label: 'Beta',
    to: ROUTES.activity,
    Icon: Flag,
    minRole: 'viewer',
    group: 'Operations',
    flag: BETA,
  },
]

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

  it('declares no flagged item yet, since apex reads no flag', () => {
    expect(NAV_ITEMS.filter((item) => item.flag !== undefined)).toEqual([])
  })

  /** The labels `visibleNavItems` keeps from ITEMS; the cast lets a test key into apex's empty slice. */
  function visibleLabels(
    flags: Record<string, boolean | string>,
    role: 'viewer' | null = 'viewer'
  ): string[] {
    return visibleNavItems(ITEMS, role, flags as unknown as ClientFlagValues).map(
      (item) => item.label
    )
  }

  it('shows a flagged item only while its flag is exactly true', () => {
    expect(visibleLabels({ [BETA]: true })).toEqual(['Plain', 'Beta'])
    expect(visibleLabels({ [BETA]: false })).toEqual(['Plain'])
    expect(visibleLabels({ [BETA]: 'true' })).toEqual(['Plain'])
    expect(visibleLabels({})).toEqual(['Plain'])
  })

  it('still applies the role bar to a flagged item whose flag is on', () => {
    expect(visibleLabels({ [BETA]: true }, null)).toEqual([])
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
