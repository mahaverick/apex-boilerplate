import { ActivityList } from '@/components/features/activity/activity-list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { platformRoleAtLeast } from '@/constants/roles'
import {
  flattenAuditPages,
  usePlatformAuditLog,
  type PlatformAuditFilters,
} from '@/queries/audit.queries'
import { useAuthStore } from '@/states/auth.store'

interface HistoryCardProps {
  /** The platform audit-log filter that picks this record's entries. */
  filters: PlatformAuditFilters
  /** The record the card sits on; an entry targeting it gets no link back to this page. */
  subjectId: string
  title: string
  emptyMessage: string
}

/**
 * A record's entries from the platform audit log. That log is for admins and
 * owners (its route answers 404 below admin), so a viewer gets no card rather
 * than an error.
 */
function HistoryCard({ filters, subjectId, title, emptyMessage }: HistoryCardProps) {
  const role = useAuthStore((s) => s.user?.platformRole)
  if (!platformRoleAtLeast(role, 'admin')) return null
  return (
    <History filters={filters} subjectId={subjectId} title={title} emptyMessage={emptyMessage} />
  )
}

function History({ filters, subjectId, title, emptyMessage }: HistoryCardProps) {
  const log = usePlatformAuditLog(filters)
  const headingId = `history-${subjectId}`
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId}>{title}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityList
            entries={flattenAuditPages(log.data)}
            isPending={log.isPending}
            isError={log.isError}
            onRetry={() => void log.refetch()}
            hasNextPage={log.hasNextPage}
            isFetchingNextPage={log.isFetchingNextPage}
            isFetchNextPageError={log.isFetchNextPageError}
            onLoadMore={() => void log.fetchNextPage()}
            emptyMessage={emptyMessage}
            subjectId={subjectId}
          />
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * Every entry whose target is this user: staff actions on the account, and
 * whatever else targets it, such as a tenant's member changes.
 */
export function UserHistoryCard({ userId }: { userId: string }) {
  return (
    <HistoryCard
      filters={{ targetId: userId }}
      subjectId={userId}
      title="Recorded actions on this account"
      emptyMessage="Nothing recorded yet."
    />
  )
}

/**
 * Entries filed under this tenant with `access: 'platform'`, meaning staff did
 * them: among them its creation by staff, lifecycle changes, owner
 * invitations, revoked invitations and staff visits. Its members' own
 * activity is on the Activity tab.
 */
export function TenantHistoryCard({ tenantId }: { tenantId: string }) {
  return (
    <HistoryCard
      filters={{ tenantId, access: 'platform' }}
      subjectId={tenantId}
      title="Staff actions on this tenant"
      emptyMessage="No staff actions recorded yet."
    />
  )
}
