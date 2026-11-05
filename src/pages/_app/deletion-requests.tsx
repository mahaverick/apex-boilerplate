import { createFileRoute } from '@tanstack/react-router'
import { DeletionRequestsTable } from '@/components/features/deletion-requests/deletion-requests-table'
import { PlatformNotFound } from '@/components/features/platform-not-found'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import {
  deletionRequestsList,
  deletionRequestsListOptions,
} from '@/queries/deletion-request.queries'
import { useAuthStore } from '@/states/auth.store'

/** The Deletion requests page: customers who asked to delete their account, for platform admins. */
export const Route = createFileRoute('/_app/deletion-requests')({
  validateSearch: deletionRequestsList.schema,
  head: () => ({ meta: [{ title: pageTitle('Deletion requests') }] }),
  staticData: { crumb: 'Deletion requests' },
  component: DeletionRequestsPage,
})

/** Below platform admin the API answers 404, so the page says the same without asking. */
function DeletionRequestsPage() {
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  return platformRoleAtLeast(platformRole, 'admin') ? (
    <DeletionRequestsList />
  ) : (
    <PlatformNotFound />
  )
}

/** The requests, sorted and paged in the URL. Mounted only for an admin, so a viewer sends no request. */
function DeletionRequestsList() {
  const list = useListSearch(deletionRequestsList)
  const query = useListQuery(list, deletionRequestsListOptions)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Deletion requests</h1>
        </CardTitle>
        <CardDescription>
          People who asked us to delete their account. Delete each account by its due date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DeletionRequestsTable
          query={query}
          empty={<EmptyState size="compact" title="No one has asked to delete their account." />}
        />
      </CardContent>
    </Card>
  )
}
