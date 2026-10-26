import { Link } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import type { BillingAlert } from '@/types/billing.types'

/**
 * The alert's tenant as a link to its Billing tab, or "No tenant" when the
 * alert names none or the tenant is archived or gone (express sends null).
 */
export function AlertTenant({ tenant }: { tenant: BillingAlert['tenant'] }) {
  if (tenant === null) return <span className="text-muted-foreground">No tenant</span>
  return (
    <Link
      to={ROUTES.tenantBilling}
      params={{ tenantId: tenant.id }}
      className="underline-offset-4 hover:underline"
    >
      {tenant.name}
    </Link>
  )
}
