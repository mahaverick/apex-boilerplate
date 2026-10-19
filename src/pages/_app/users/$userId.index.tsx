import { IconCopy } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { UserEmailsCard } from '@/components/features/emails/user-emails-card'
import { UserHistoryCard } from '@/components/features/history-card'
import { LoadError } from '@/components/features/load-error'
import { PagePaletteCommands } from '@/components/features/page-palette-commands'
import { UserActionsMenu } from '@/components/features/users/user-actions-menu'
import { UserNotFound } from '@/components/features/users/user-not-found'
import { UserStatusBadges } from '@/components/features/users/user-status-badges'
import { copyId } from '@/components/shared/command-palette/copy-id'
import { EmptyState } from '@/components/shared/empty-state'
import { Note } from '@/components/shared/note'
import { DetailPending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast, ROLE_LABELS } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useRecordRecent } from '@/hooks/use-record-recent'
import { statusFrom } from '@/lib/api-error'
import { formatDate, fullName } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import { historyList } from '@/queries/audit.queries'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformUserDetail } from '@/types/api.types'

/** One user's page: the account, its tenants, emails and, for admins, history. */
export const Route = createFileRoute('/_app/users/$userId/')({
  validateSearch: historyList.schema,
  head: () => ({ meta: [{ title: pageTitle('User') }] }),
  component: UserDetailPage,
  pendingComponent: DetailPending,
})

/**
 * Loads one user and shows them, a not-found state for a 404, or a load error.
 * A failed read with no user to show, or a 404, replaces the page; a failed
 * refetch with the user on screen keeps the page and shows a `LoadError` above
 * it. While the user loads, the page is its header in a `grid gap-1` (the
 * name at the heading's 2rem, the email and the badges line at `text-sm`'s
 * 1.25rem) and the five cards an admin sees (Tenants, Sign-in methods, Pending
 * invitations, Emails, History), each a title bar over two rows; the rows are
 * not measured against the loaded cards.
 */
function UserDetailPage() {
  const { userId } = Route.useParams()
  const detail = useQuery(platformUserQueryOptions(userId))
  const notFound = detail.isError && statusFrom(detail.error) === 404
  useRecordRecent('user', userId, detail.data && { label: detail.data.email }, notFound)

  if (detail.isError && (detail.data === undefined || statusFrom(detail.error) === 404)) {
    return statusFrom(detail.error) === 404 ? (
      <UserNotFound />
    ) : (
      <LoadError message="We could not load this user." onRetry={() => void detail.refetch()} />
    )
  }
  if (detail.data === undefined) {
    return (
      <div aria-busy="true" className="grid gap-4">
        <h1 className="sr-only">User</h1>
        <div className="grid gap-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-80 max-w-full" />
        </div>
        {[0, 1, 2, 3, 4].map((card) => (
          <Card key={card}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <CardRowsSkeleton rows={2} />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      {detail.isError && (
        <LoadError message="We could not load this user." onRetry={() => void detail.refetch()} />
      )}
      <UserDetail user={detail.data} />
      <PagePaletteCommands
        source="user-page"
        commands={[
          {
            id: 'copy-id',
            label: 'Copy user ID',
            icon: IconCopy,
            action: analyticsKey('copy_id'),
            timing: 'immediate',
            run: () => copyId(userId, 'User ID copied.'),
          },
        ]}
      />
    </div>
  )
}

/**
 * One account: who it is, its tenants, sign-in methods and pending
 * invitations, its emails and, for admins, its recorded history and a link
 * to its flag evaluation.
 */
function UserDetail({ user }: { user: PlatformUserDetail }) {
  const name = fullName(user)
  const heading = useRef<HTMLHeadingElement>(null)
  const isAdmin = platformRoleAtLeast(
    useAuthStore((state) => state.user?.platformRole),
    'admin'
  )
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
            <Pii>{name ?? user.email}</Pii>
          </h1>
          {name && (
            <Pii as="p" className="text-sm text-muted-foreground">
              {user.email}
            </Pii>
          )}
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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              to={ROUTES.flags}
              search={{ userId: user.id }}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Flags
            </Link>
          )}
          <UserActionsMenu user={user} fallbackFocus={heading} />
        </div>
      </div>

      {user.deletedAt !== null && (
        <Note tone="warning">
          This account was deleted on {formatDate(user.deletedAt, 'medium') ?? 'an unknown date'}.
          It is read-only; a platform owner can delete it permanently.
        </Note>
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
              <EmptyState size="compact" title="Not a member of any tenant." />
            ) : (
              <ItemGroup className="gap-2 has-data-[size=xs]:gap-2">
                {user.memberships.map((membership) => (
                  <Item key={membership.tenantId} size="xs" role="listitem" className="p-0">
                    <ItemContent>
                      <ItemTitle className="line-clamp-none">
                        <Link
                          to={ROUTES.tenant}
                          params={{ tenantId: membership.tenantId }}
                          className="underline-offset-4 hover:underline"
                        >
                          {membership.tenantName}
                        </Link>
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions className="text-muted-foreground">
                      {membership.lifecycleState !== 'active' && (
                        <Badge variant="outline">
                          {membership.lifecycleState === 'suspended' ? 'Suspended' : 'Archived'}
                        </Badge>
                      )}
                      {ROLE_LABELS[membership.role]}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
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
            {/* Every account can sign in by an emailed link; Google only once linked. */}
            <p>Email link</p>
            {user.authProviders.includes('google') && <p>Google</p>}
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
              <EmptyState size="compact" title="None." />
            ) : (
              <ItemGroup className="gap-2 has-data-[size=xs]:gap-2">
                {user.pendingInvitations.map((invitation) => (
                  <Item key={invitation.id} size="xs" role="listitem" className="p-0">
                    <ItemContent>
                      <ItemTitle className="line-clamp-none font-normal">
                        {invitation.tenantName} · {ROLE_LABELS[invitation.role]}
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions className="text-sm text-muted-foreground">
                      Expires {formatDate(invitation.expiresAt, 'medium') ?? 'soon'}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      </section>

      <UserEmailsCard userId={user.id} />

      <UserHistoryCard userId={user.id} />
    </div>
  )
}
