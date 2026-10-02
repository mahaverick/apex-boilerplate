/**
 * @file The staff navigation: one typed list the sidebar and the command
 * palette both read. Later sub-projects add entries here; an item above the
 * user's role is hidden, never shown disabled.
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
 * The items a platform role may see.
 * @param role - The signed-in user's platform role; null when not staff.
 * @returns The visible items, in NAV_ITEMS order.
 */
export function navItemsFor(role: MembershipRole | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => platformRoleAtLeast(role, item.minRole))
}

/**
 * The visible items, sectioned for the sidebar.
 * @param role - The signed-in user's platform role.
 * @returns One entry per non-empty group, in NAV_GROUPS order.
 */
export function navGroupsFor(
  role: MembershipRole | null | undefined
): { group: NavGroup; items: NavItem[] }[] {
  const visible = navItemsFor(role)
  return NAV_GROUPS.map((group) => ({
    group,
    items: visible.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0)
}
