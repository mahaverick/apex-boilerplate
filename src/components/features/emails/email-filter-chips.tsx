import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { fullName } from '@/lib/format'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'

/** A filter the URL carries by id, shown by name with a control that removes it. */
function FilterChip({
  label,
  isPersonal = false,
  onRemove,
}: {
  label: string
  /** The label names a person, so it is masked from analytics. */
  isPersonal?: boolean
  onRemove: () => void
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-4xl border py-0.5 pr-0.5 pl-2.5 text-xs">
      {isPersonal ? (
        <Pii className="truncate">{label}</Pii>
      ) : (
        <span className="truncate">{label}</span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove filter: ${label}`}
        onClick={onRemove}
      >
        <X aria-hidden />
      </Button>
    </span>
  )
}

/**
 * The user a `?userId=` filter names. The page's own rows name them when any
 * are listed; otherwise their record is read, and an id that no longer
 * resolves (a purged account) says so rather than showing the raw id.
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
  return <FilterChip label={`User: ${name}`} isPersonal onRemove={onRemove} />
}

/** The tenant a `?tenantId=` filter names, resolved as `UserFilterChip` resolves a user. */
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
  return <FilterChip label={`Tenant: ${name}`} onRemove={onRemove} />
}
