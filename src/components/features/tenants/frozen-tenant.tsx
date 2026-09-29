import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

/**
 * What a suspended or archived tenant's Members, Invitations and Activity
 * tabs show instead of their content. The tenant's own routes answer 404 for
 * a non-active tenant (express `findActiveBySlug`), so these tabs make no
 * request at all rather than showing that 404 as a permissions error.
 */
export function FrozenTenant({ state }: { state: 'suspended' | 'archived' }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>This tenant is {state}. Its members and invitations are frozen.</EmptyTitle>
        <EmptyDescription>
          {state === 'suspended'
            ? 'Reactivate it from the Actions menu to manage them again.'
            : 'Archiving is permanent; the Overview tab still shows what it held.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
