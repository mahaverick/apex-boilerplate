import { PLATFORM_TENANT_SLUG } from '@/constants/routes'

/** A tenant as the API names it: its display name and its slug. */
interface NamedTenant {
  name: string
  slug: string
}

/**
 * The platform tenant as staff see it in a label, such as a table cell or a
 * filter chip. Its stored name is internal, so it never reaches the screen.
 */
export const STAFF_TEAM_LABEL = 'Staff team'

/**
 * Whether `tenant` is the platform tenant, whose members are the staff.
 * @param tenant - Any tenant with a slug.
 */
export function isPlatformTenant(tenant: { slug: string }): boolean {
  return tenant.slug === PLATFORM_TENANT_SLUG
}

/**
 * A tenant's label: "Staff team" for the platform tenant, its name otherwise.
 * @param tenant - The tenant to label.
 */
export function tenantLabel(tenant: NamedTenant): string {
  return isPlatformTenant(tenant) ? STAFF_TEAM_LABEL : tenant.name
}

/**
 * A tenant inside a sentence, as in "Join {team}": "the staff team" for the
 * platform tenant, its name otherwise.
 * @param tenant - The tenant to name.
 */
export function teamName(tenant: NamedTenant): string {
  return isPlatformTenant(tenant) ? 'the staff team' : tenant.name
}
