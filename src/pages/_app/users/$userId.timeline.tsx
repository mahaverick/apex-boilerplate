import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { TimelinePanel } from '@/components/features/timeline/timeline-panel'
import { UserNotFound } from '@/components/features/users/user-not-found'
import { Pii } from '@/components/shared/pii'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'
import { timelineSearchSchema } from '@/schemas/timeline.schemas'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/users/$userId/timeline')({
  validateSearch: timelineSearchSchema,
  head: () => ({ meta: [{ title: pageTitle('User timeline') }] }),
  staticData: { crumb: 'Timeline' },
  component: UserTimelinePage,
})

/**
 * What one user did, across browser and server, from PostHog: their own
 * events and staff actions on them. Admins and up; below that the page
 * says so without asking the API, which would answer 404. A soft-deleted
 * account still has a timeline; an unknown or purged one is not found. The
 * panel mounts only once the user has loaded, so an unknown user never asks
 * for a timeline or reads its 404 as a role refusal.
 */
function UserTimelinePage() {
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  if (!platformRoleAtLeast(platformRole, 'admin')) {
    return (
      <div className="grid max-w-4xl gap-4">
        <h1 className="text-2xl font-semibold">Timeline</h1>
        <RoleDenied />
      </div>
    )
  }
  return <UserTimeline />
}

function UserTimeline() {
  const { userId } = Route.useParams()
  const { range, view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const user = useQuery(platformUserQueryOptions(userId))

  if (user.isError && statusFrom(user.error) === 404) return <UserNotFound />

  return (
    <div className="grid max-w-4xl gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">Timeline</h1>
        {user.data !== undefined && (
          <Pii as="p" className="text-sm text-muted-foreground">
            {fullName(user.data) ?? user.data.email}
          </Pii>
        )}
      </div>
      {user.data !== undefined ? (
        <TimelinePanel
          kind="user"
          id={userId}
          range={range}
          view={view}
          onSearchChange={(search) => void navigate({ search, replace: true })}
        />
      ) : user.isError ? (
        <LoadError message="We could not load this user." onRetry={() => void user.refetch()} />
      ) : (
        <Skeleton className="h-16 w-full" />
      )}
    </div>
  )
}
