import { IconSnowflake } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/empty-state'

/**
 * What a suspended or archived tenant's Members, Invitations and Activity
 * tabs show instead of their content. The tenant's own routes answer 404 for
 * a non-active tenant (express `findActiveBySlug`), so these tabs make no
 * request at all rather than showing that 404 as a permissions error. Only an
 * admin can reactivate, so `canReactivate` picks who the suspended text names.
 */
export function FrozenTenant({
  state,
  canReactivate,
}: {
  state: 'suspended' | 'archived'
  /** Whether the reader is an admin, who can reactivate a suspended tenant. */
  canReactivate: boolean
}) {
  return (
    <EmptyState
      icon={<IconSnowflake aria-hidden="true" />}
      title={`This tenant is ${state}. Its members and invitations are frozen.`}
      description={
        state === 'archived'
          ? 'Archiving can’t be undone. The Overview tab shows what the tenant held.'
          : canReactivate
            ? 'Reactivate it from the Actions menu to manage them again.'
            : 'An admin can reactivate it to manage them again.'
      }
    />
  )
}
