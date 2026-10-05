/**
 * @file The staff navigation: one typed list the sidebar and the command
 * palette both read. Later sub-projects add entries here; an item above the
 * user's role, or behind a flag that is off, is hidden, never shown disabled.
 */
import {
  Building2,
  Gauge,
  History,
  LayoutDashboard,
  ListChecks,
  Mail,
  MailX,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { platformRoleAtLeast, type MembershipRole } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import type { BooleanClientFlagKey } from '@/observability/flags/flag-keys'
import type { ClientFlagValues } from '@/observability/flags/flag-types'
import { fallbackFlags, filterByFlag } from '@/observability/flags/flag-values'

/** Sidebar sections, in display order. */
export const NAV_GROUPS = ['General', 'Directory', 'Operations', 'Growth', 'Security'] as const

export type NavGroup = (typeof NAV_GROUPS)[number]

/** Every route the navigation can point at; a new page widens this union. */
export type NavPath =
  | typeof ROUTES.overview
  | typeof ROUTES.tenants
  | typeof ROUTES.users
  | typeof ROUTES.staff
  | typeof ROUTES.emails
  | typeof ROUTES.deliverability
  | typeof ROUTES.suppressions
  | typeof ROUTES.onboarding
  | typeof ROUTES.activity

export interface NavItem {
  label: string
  to: NavPath
  Icon: LucideIcon
  /** The least platform role that sees this item. The API enforces the same bar. */
  minRole: MembershipRole
  group: NavGroup
  /** A boolean flag that must be on for the item to show; its route enforces the same flag. */
  flag?: BooleanClientFlagKey
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Overview',
    to: ROUTES.overview,
    Icon: LayoutDashboard,
    minRole: 'viewer',
    group: 'General',
  },
  { label: 'Tenants', to: ROUTES.tenants, Icon: Building2, minRole: 'viewer', group: 'Directory' },
  { label: 'Users', to: ROUTES.users, Icon: Users, minRole: 'viewer', group: 'Directory' },
  { label: 'Staff', to: ROUTES.staff, Icon: ShieldCheck, minRole: 'viewer', group: 'Directory' },
  { label: 'Emails', to: ROUTES.emails, Icon: Mail, minRole: 'viewer', group: 'Operations' },
  {
    label: 'Deliverability',
    to: ROUTES.deliverability,
    Icon: Gauge,
    minRole: 'viewer',
    group: 'Operations',
  },
  {
    label: 'Suppressions',
    to: ROUTES.suppressions,
    Icon: MailX,
    minRole: 'viewer',
    group: 'Operations',
  },
  {
    label: 'Onboarding',
    to: ROUTES.onboarding,
    Icon: ListChecks,
    minRole: 'viewer',
    group: 'Growth',
  },
  {
    label: 'Activity log',
    to: ROUTES.activity,
    Icon: History,
    minRole: 'admin',
    group: 'Security',
  },
]

/**
 * The items of a list a platform role may see, given this app's flag values.
 * @param items - The items, in display order.
 * @param role - The signed-in user's platform role; null when not staff.
 * @param flags - The flag values; an item whose flag is not `true` here is hidden.
 * @returns The visible items, in the same order.
 */
export function visibleNavItems(
  items: readonly NavItem[],
  role: MembershipRole | null | undefined,
  flags: ClientFlagValues
): NavItem[] {
  return filterByFlag(
    items.filter((item) => platformRoleAtLeast(role, item.minRole)),
    flags
  )
}

/**
 * The items a platform role may see, given this app's flag values.
 * @param role - The signed-in user's platform role; null when not staff.
 * @param flags - The flag values (`useFlagValues()`); every fallback when left out.
 * @returns The visible items, in NAV_ITEMS order.
 */
export function navItemsFor(
  role: MembershipRole | null | undefined,
  flags: ClientFlagValues = fallbackFlags()
): NavItem[] {
  return visibleNavItems(NAV_ITEMS, role, flags)
}

/**
 * The visible items, sectioned for the sidebar.
 * @param role - The signed-in user's platform role.
 * @param flags - The flag values, as for `navItemsFor`.
 * @returns One entry per non-empty group, in NAV_GROUPS order.
 */
export function navGroupsFor(
  role: MembershipRole | null | undefined,
  flags: ClientFlagValues = fallbackFlags()
): { group: NavGroup; items: NavItem[] }[] {
  const visible = navItemsFor(role, flags)
  return NAV_GROUPS.map((group) => ({
    group,
    items: visible.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0)
}
