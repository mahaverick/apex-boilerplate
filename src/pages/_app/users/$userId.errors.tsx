import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ErrorsPanel } from '@/components/features/errors/errors-panel'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { UserNotFound } from '@/components/features/users/user-not-found'
import { Pii } from '@/components/shared/pii'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/users/$userId/errors')({
  head: () => ({ meta: [{ title: pageTitle('User errors') }] }),
  staticData: { crumb: 'Errors' },
  component: UserErrorsPage,
})

/**
 * The PostHog error issues one user hit in the last 30 days, from their
 * browser and from the API acting for them. Admins and up; below that the
 * page says so without asking the API, which would answer 404. The panel
 * mounts only once the user has loaded, so an unknown user never asks for
 * errors or reads its 404 as a role refusal.
 */
function UserErrorsPage() {
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  if (!platformRoleAtLeast(platformRole, 'admin')) {
    return (
      <div className="grid max-w-4xl gap-4">
        <h1 className="text-2xl font-semibold">Errors</h1>
        <RoleDenied />
      </div>
    )
  }
  return <UserErrors />
}

function UserErrors() {
  const { userId } = Route.useParams()
  const user = useQuery(platformUserQueryOptions(userId))

  if (user.isError && statusFrom(user.error) === 404) return <UserNotFound />

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">Errors</h1>
        {user.data !== undefined && (
          <Pii as="p" className="text-sm text-muted-foreground">
            {fullName(user.data) ?? user.data.email}
          </Pii>
        )}
      </div>
      {user.data !== undefined ? (
        <ErrorsPanel kind="user" id={userId} />
      ) : user.isError ? (
        <LoadError message="We could not load this user." onRetry={() => void user.refetch()} />
      ) : (
        <Skeleton className="h-16 w-full" />
      )}
    </div>
  )
}
