import { Link } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import { isPlatformTenant, tenantLabel } from '@/lib/staff-team'

/**
 * A link to a tenant's page, labelled as staff know it. The platform tenant
 * has no tenant page (the API's detail leaves it out); its people are on
 * Staff, so it reads "Staff team" and links there.
 */
export function TenantLink({
  tenant,
  className,
}: {
  tenant: { id: string; name: string; slug: string }
  className: string
}) {
  return isPlatformTenant(tenant) ? (
    <Link to={ROUTES.staff} className={className}>
      {tenantLabel(tenant)}
    </Link>
  ) : (
    <Link to={ROUTES.tenant} params={{ tenantId: tenant.id }} className={className}>
      {tenant.name}
    </Link>
  )
}
