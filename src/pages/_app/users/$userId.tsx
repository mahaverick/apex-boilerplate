import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { UserHistoryCard } from '@/components/features/history-card'
import { LoadError } from '@/components/features/load-error'
import { UserActionsMenu } from '@/components/features/users/user-actions-menu'
import { UserStatusBadges } from '@/components/features/users/user-status-badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROLE_LABELS } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { statusFrom } from '@/lib/api-error'
import { formatDate, fullName } from '@/lib/format'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'
import type { PlatformUserDetail } from '@/types/api.types'

export const Route = createFileRoute('/_app/users/$userId')({
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(platformUserQueryOptions(params.userId))
  },
  head: () => ({ meta: [{ title: pageTitle('User') }] }),
  staticData: { crumb: 'User' },
  component: UserDetailPage,
})

/** A sign-in provider's label; an unknown one renders as the API names it. */
const PROVIDER_LABELS: Record<string, string> = { email: 'Email', google: 'Google' }

function NotFound() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h1>User not found</h1>
        </CardTitle>
        <CardDescription>This user does not exist, or was permanently deleted.</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to={ROUTES.users} className="text-sm underline underline-offset-4">
          Back to users
        </Link>
      </CardContent>
    </Card>
  )
}

function UserDetailPage() {
  const { userId } = Route.useParams()
  const detail = useQuery(platformUserQueryOptions(userId))

  if (detail.isError) {
    return statusFrom(detail.error) === 404 ? (
      <NotFound />
    ) : (
      <LoadError message="We could not load this user." onRetry={() => void detail.refetch()} />
    )
  }
  if (detail.data === undefined) {
    return (
      <div className="grid gap-4">
        <h1 className="sr-only">User</h1>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return <UserDetail user={detail.data} />
}

function UserDetail({ user }: { user: PlatformUserDetail }) {
  const name = fullName(user)
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <div className="grid max-w-4xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
            {name ?? user.email}
          </h1>
          {name && <p className="text-sm text-muted-foreground">{user.email}</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <UserStatusBadges user={user} />
            {user.platformRole && (
              <Badge variant="outline">Staff · {ROLE_LABELS[user.platformRole]}</Badge>
            )}
            <span>Joined {formatDate(user.createdAt, 'medium') ?? 'Unknown'}</span>
            <span>
              Last sign-in{' '}
              {user.lastLoggedInAt === null
                ? 'never'
                : (formatDate(user.lastLoggedInAt, 'medium') ?? 'unknown')}
            </span>
          </div>
        </div>
        <UserActionsMenu user={user} fallbackFocus={heading} />
      </div>

      {user.deletedAt !== null && (
        <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
          This account was deleted on {formatDate(user.deletedAt, 'medium') ?? 'an unknown date'}.
          It is read-only; a platform owner can delete it permanently.
        </p>
      )}

      <section aria-labelledby="user-tenants">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="user-tenants">Tenants</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user.memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not a member of any tenant.</p>
            ) : (
              <ul className="grid gap-2">
                {user.memberships.map((membership) => (
                  <li key={membership.tenantId} className="flex items-center justify-between gap-4">
                    <Link
                      to={ROUTES.tenant}
                      params={{ tenantId: membership.tenantId }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {membership.tenantName}
                    </Link>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {membership.lifecycleState !== 'active' && (
                        <Badge variant="outline">
                          {membership.lifecycleState === 'suspended' ? 'Suspended' : 'Archived'}
                        </Badge>
                      )}
                      {ROLE_LABELS[membership.role]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="user-sign-in">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="user-sign-in">Sign-in methods</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>{user.hasPassword ? 'Password set' : 'No password set'}</p>
            {user.authProviders.length > 0 && (
              <p className="text-muted-foreground">
                Linked: {user.authProviders.map((p) => PROVIDER_LABELS[p] ?? p).join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="user-invitations">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="user-invitations">Pending invitations</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user.pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {user.pendingInvitations.map((invitation) => (
                  <li key={invitation.id} className="flex justify-between gap-4">
                    <span>
                      {invitation.tenantName} · {ROLE_LABELS[invitation.role]}
                    </span>
                    <span className="text-muted-foreground">
                      Expires {formatDate(invitation.expiresAt, 'medium') ?? 'soon'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <UserHistoryCard userId={user.id} />
    </div>
  )
}
