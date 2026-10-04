/**
 * @file The tenant detail page's tabs, in display order. A later sub-project
 * (usage) adds a tab by creating its child route under
 * `src/pages/_app/tenants/$tenantId.*.tsx` and appending one entry here.
 */
import type { MembershipRole } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'

export type TenantTabPath =
  | typeof ROUTES.tenant
  | typeof ROUTES.tenantMembers
  | typeof ROUTES.tenantInvitations
  | typeof ROUTES.tenantActivity
  | typeof ROUTES.tenantTimeline
  | typeof ROUTES.tenantEmails
  | typeof ROUTES.tenantOnboarding

export interface TenantTab {
  to: TenantTabPath
  label: string
  /** The least platform role that sees the tab; unset is every staff member. The API enforces the same bar. */
  minRole?: MembershipRole
}

export const TENANT_DETAIL_TABS: readonly TenantTab[] = [
  { to: ROUTES.tenant, label: 'Overview' },
  { to: ROUTES.tenantMembers, label: 'Members' },
  { to: ROUTES.tenantInvitations, label: 'Invitations' },
  { to: ROUTES.tenantActivity, label: 'Activity' },
  { to: ROUTES.tenantTimeline, label: 'Timeline', minRole: 'admin' },
  { to: ROUTES.tenantEmails, label: 'Emails' },
  { to: ROUTES.tenantOnboarding, label: 'Onboarding' },
]
