/**
 * @file The tenant detail page's tabs, in display order. A tab is a child route
 * under `src/pages/_app/tenants/$tenantId.*.tsx` plus one entry here.
 */
import type { MembershipRole } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'

/** Every route a tenant tab can point at. */
type TenantTabPath =
  | typeof ROUTES.tenant
  | typeof ROUTES.tenantMembers
  | typeof ROUTES.tenantInvitations
  | typeof ROUTES.tenantActivity
  | typeof ROUTES.tenantEmails
  | typeof ROUTES.tenantOnboarding
  | typeof ROUTES.tenantBilling
  | typeof ROUTES.tenantFlags

/** One tab of the tenant detail page. */
export interface TenantTab {
  to: TenantTabPath
  label: string
  /** The least platform role that sees the tab; unset is every staff member. The API enforces the same bar. */
  minRole?: MembershipRole
  /** Only customer tenants have it: the platform tenant (the staff team) leaves it out. */
  customerOnly?: true
}

/** The tenant detail tabs in display order; a tab with `minRole` is hidden below it, and a `customerOnly` tab on the platform tenant. */
export const TENANT_DETAIL_TABS: readonly TenantTab[] = [
  { to: ROUTES.tenant, label: 'Overview' },
  { to: ROUTES.tenantMembers, label: 'Members' },
  { to: ROUTES.tenantInvitations, label: 'Invitations' },
  { to: ROUTES.tenantActivity, label: 'Activity' },
  { to: ROUTES.tenantEmails, label: 'Emails' },
  { to: ROUTES.tenantOnboarding, label: 'Onboarding' },
  { to: ROUTES.tenantBilling, label: 'Billing', customerOnly: true },
  { to: ROUTES.tenantFlags, label: 'Flags', minRole: 'admin' },
]
