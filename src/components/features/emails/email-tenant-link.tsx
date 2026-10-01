import { Link } from '@tanstack/react-router'
import { PLATFORM_TENANT_SLUG, ROUTES } from '@/constants/routes'

/**
 * A link to the tenant an email concerns. The platform tenant has no tenant
 * page worth opening; its people are on Staff, so it links there.
 */
export function EmailTenantLink({
  tenant,
  className,
}: {
  tenant: { id: string; name: string; slug: string }
  className: string
}) {
  return tenant.slug === PLATFORM_TENANT_SLUG ? (
    <Link to={ROUTES.staff} className={className}>
      {tenant.name}
    </Link>
  ) : (
    <Link to={ROUTES.tenant} params={{ tenantId: tenant.id }} className={className}>
      {tenant.name}
    </Link>
  )
}
