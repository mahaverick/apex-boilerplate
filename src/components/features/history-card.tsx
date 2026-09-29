import { ActivityList } from '@/components/features/activity/activity-list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { platformRoleAtLeast } from '@/constants/roles'
import { flattenAuditPages, usePlatformAuditLog } from '@/queries/audit.queries'
import { useAuthStore } from '@/states/auth.store'

/**
 * What staff have done to one user or tenant: the platform audit log filtered
 * to entries that target it. The platform log is for admins and
 * owners (its route answers 404 below admin), so a viewer gets no card rather
 * than an error.
 */
export function HistoryCard({ targetId }: { targetId: string }) {
  const role = useAuthStore((s) => s.user?.platformRole)
  if (!platformRoleAtLeast(role, 'admin')) return null
  return <History targetId={targetId} />
}

function History({ targetId }: { targetId: string }) {
  const log = usePlatformAuditLog({ targetId })
  const headingId = `history-${targetId}`
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId}>History</h2>
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
            emptyMessage="No staff actions recorded yet."
          />
        </CardContent>
      </Card>
    </section>
  )
}
