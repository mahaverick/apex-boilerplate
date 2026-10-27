import { ACTION_FILTER } from '@/components/features/activity/activity-filters'
import { ActivityTable } from '@/components/features/activity/activity-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { platformRoleAtLeast } from '@/constants/roles'
import { historyList, platformAuditListOptions } from '@/queries/audit.queries'
import { useAuthStore } from '@/states/auth.store'

/** What a history card needs: the audit filter, the record it sits on, and its heading and empty text. */
interface HistoryCardProps {
  /** The platform audit-log filter that picks this record's entries, in the API's names. */
  filters: { target?: string; tenant?: string; access?: 'platform' }
  /** The record the card sits on; an entry targeting it gets no link back to this page. */
  subjectId: string
  title: string
  emptyMessage: string
  /** Whether the entries name their tenant: the user's card lists every tenant's. */
  showTenant?: boolean
  /** The tenant's `settings.timezone` when every entry is one tenant's, for its billing dates. */
  timeZone?: string
}

/**
 * A record's entries from the platform audit log. That log is for admins and
 * owners (its route answers 404 below admin), so a viewer gets no card rather
 * than an error.
 */
function HistoryCard(props: HistoryCardProps) {
  const role = useAuthStore((s) => s.user?.platformRole)
  if (!platformRoleAtLeast(role, 'admin')) return null
  return <History {...props} />
}

/** The card's body, mounted only for a role that may read the platform audit log. */
function History({
  filters,
  subjectId,
  title,
  emptyMessage,
  showTenant,
  timeZone,
}: HistoryCardProps) {
  const list = useListSearch(historyList)
  // The card's fixed filter is spread last; `historyList` filters only by `action`, so the two never name the same param.
  const log = useListQuery(list, (request) => platformAuditListOptions({ ...request, ...filters }))
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
          <ActivityTable
            query={log}
            label={title}
            landmark={false}
            subjectId={subjectId}
            showTenant={showTenant}
            timeZone={timeZone}
            filters={[ACTION_FILTER]}
            empty={<EmptyState size="compact" title={emptyMessage} />}
          />
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * Every entry whose target is this user: staff actions on the account
 * (`user.*`) and the user's own step-up attempts. A tenant's member
 * changes target the membership, not the user, so they are not listed here.
 */
export function UserHistoryCard({ userId }: { userId: string }) {
  return (
    <HistoryCard
      filters={{ target: userId }}
      showTenant
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
 * activity is on the Activity tab. Its billing dates read in the tenant's zone.
 */
export function TenantHistoryCard({ tenantId, timeZone }: { tenantId: string; timeZone: string }) {
  return (
    <HistoryCard
      filters={{ tenant: tenantId, access: 'platform' }}
      timeZone={timeZone}
      subjectId={tenantId}
      title="Staff actions on this tenant"
      emptyMessage="No staff actions recorded yet."
    />
  )
}
