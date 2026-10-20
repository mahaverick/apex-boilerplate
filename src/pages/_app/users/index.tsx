import { IconUsers } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'
import { CreateUserDialog } from '@/components/features/users/create-user-dialog'
import { UsersTable } from '@/components/features/users/users-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { useArrivalFocus } from '@/hooks/use-arrival-focus'
import { usersList, usersListOptions } from '@/queries/user-admin.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'
import { useAuthStore } from '@/states/auth.store'

/** The Users page: every user, with everything that picks the rows in the URL. */
export const Route = createFileRoute('/_app/users/')({
  validateSearch: usersList.schema,
  loaderDeps: ({ search }) => listRequest(usersList, listValues(usersList, search)),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(usersListOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Users') }] }),
  staticData: { crumb: 'Users' },
  component: UsersPage,
})

/**
 * Every user. The view is the URL's (`?search`, the filters, `?sort`, and the
 * page as `?cursor`), so it can be shared and Back walks through it. The
 * table owns the loading, error and empty states. The heading takes focus on
 * arrival after an account is deleted for good.
 */
function UsersPage() {
  const role = useAuthStore((state) => state.user?.platformRole)
  const heading = useRef<HTMLHeadingElement>(null)
  useArrivalFocus(heading, true)
  const list = useListSearch(usersList)
  const query = useListQuery(list, usersListOptions)

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
        Users
      </h1>
      <UsersTable
        query={query}
        errorMessage="We could not load the users."
        empty={
          <EmptyState
            icon={<IconUsers aria-hidden="true" />}
            title="No users yet."
            description="Users appear here once they sign up or staff create them."
          />
        }
        toolbar={platformRoleAtLeast(role, 'admin') && <CreateUserDialog />}
      />
    </div>
  )
}
