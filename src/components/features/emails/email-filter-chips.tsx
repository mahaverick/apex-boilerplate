import { useQuery } from '@tanstack/react-query'
import { DataTableChip } from '@/components/shared/data-table/data-table-chip'
import { fullName } from '@/lib/format'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'

/**
 * The user a `?user=` filter names. The page's own rows name them when any
 * are listed; otherwise their record is read, and an id that does not
 * resolve (a purged account) says so rather than showing the raw id.
 */
export function UserFilterChip({
  userId,
  knownName,
  onRemove,
}: {
  userId: string
  knownName: string | undefined
  onRemove: () => void
}) {
  const user = useQuery({ ...platformUserQueryOptions(userId), enabled: knownName === undefined })
  const name =
    knownName ??
    (user.data
      ? (fullName(user.data) ?? user.data.email)
      : user.isError
        ? 'Unknown user'
        : 'Loading…')
  return <DataTableChip prefix="User: " value={name} isPersonal onRemove={onRemove} />
}

/** The tenant a `?tenant=` filter names, resolved as `UserFilterChip` resolves a user. */
export function TenantFilterChip({
  tenantId,
  knownName,
  onRemove,
}: {
  tenantId: string
  knownName: string | undefined
  onRemove: () => void
}) {
  const tenant = useQuery({
    ...platformTenantQueryOptions(tenantId),
    enabled: knownName === undefined,
  })
  const name = knownName ?? tenant.data?.name ?? (tenant.isError ? 'Unknown tenant' : 'Loading…')
  return <DataTableChip prefix="Tenant: " value={name} onRemove={onRemove} />
}
