/**
 * @file An audit log as a table: when, who, what happened and what it
 * happened to. The time shows relative, with the absolute time in a tooltip
 * and, since Base UI's tooltip is not announced, in the cell's own visually
 * hidden text. The platform page adds a Tenant column; a user or tenant
 * target links to its page unless it is the record the list sits on.
 */
import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { createContext, useContext, type ReactNode } from 'react'
import { auditTargetLabel } from '@/components/features/activity/activity-filters'
import { TenantLink } from '@/components/features/tenants/tenant-link'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableColumns,
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { actorName, auditSentence } from '@/constants/audit-actions'
import { ROUTES } from '@/constants/routes'
import { useNow } from '@/hooks/use-now'
import { absoluteTime, relativeTime } from '@/lib/relative-time'
import { analyticsKey } from '@/observability/telemetry'
import type { AuditEntry, PlatformAuditEntry } from '@/types/api.types'

/** What the cells need from the table's caller: whether tenants show, and the record the list sits on. */
interface ActivityContextValue {
  showTenant: boolean
  subjectId: string | undefined
}

const ActivityContext = createContext<ActivityContextValue>({
  showTenant: false,
  subjectId: undefined,
})

/**
 * The entry's tenant, which only the platform log carries.
 * @param entry - A row of either log.
 */
function tenantOf(entry: AuditEntry): PlatformAuditEntry['tenant'] | undefined {
  return 'tenant' in entry ? (entry as PlatformAuditEntry).tenant : undefined
}

/**
 * The entry's time, relative, with the absolute time in a tooltip and in hidden text.
 * @param props - The entry's ISO time.
 * @param props.occurredAt - When the entry was recorded.
 */
function When({ occurredAt }: { occurredAt: string }) {
  const now = useNow()
  const absolute = absoluteTime(occurredAt)
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
        <time dateTime={occurredAt}>{relativeTime(occurredAt, now)}</time>
        <span className="sr-only">, {absolute}</span>
      </TooltipTrigger>
      <TooltipContent>{absolute}</TooltipContent>
    </Tooltip>
  )
}

/**
 * What the entry acted on: its kind in a word, then a link to a user's page,
 * or (on the platform page) a tenant's, unless the record is the one the list
 * sits on. A link to a purged target lands on the not-found page.
 * @param props - The entry.
 * @param props.entry - The row.
 */
function Target({ entry }: { entry: AuditEntry }) {
  const { showTenant, subjectId } = useContext(ActivityContext)
  const { target } = entry
  if (!target) return <span className="text-muted-foreground">—</span>
  const linked = target.id !== subjectId
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {auditTargetLabel(target.type)}
      {linked && target.type === 'user' && (
        <Link
          to={ROUTES.user}
          params={{ userId: target.id }}
          className="underline underline-offset-4"
        >
          View user
        </Link>
      )}
      {linked && showTenant && target.type === 'tenant' && (
        <Link
          to={ROUTES.tenant}
          params={{ tenantId: target.id }}
          className="underline underline-offset-4"
        >
          View tenant
        </Link>
      )}
    </span>
  )
}

const column = createColumnHelper<DataTableFeatures, AuditEntry>()

const when = column.accessor('occurredAt', {
  header: 'When',
  meta: {
    sorts: ['-occurred', 'occurred'],
    sortName: analyticsKey('occurred'),
    sortWords: 'date',
  },
  cell: ({ getValue }) => <When occurredAt={getValue()} />,
})

const actor = column.accessor('actor', {
  header: 'Actor',
  cell: ({ row }) => {
    const { actor: who, access } = row.original
    return (
      <span className="grid gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          {who ? (
            <Link
              to={ROUTES.user}
              params={{ userId: who.id }}
              className="font-medium underline-offset-4 hover:underline"
            >
              <Pii>{actorName(who)}</Pii>
            </Link>
          ) : (
            <Pii className="font-medium">{actorName(who)}</Pii>
          )}
          {access === 'platform' && <Badge variant="outline">Staff</Badge>}
        </span>
        {who && who.name !== who.email && (
          <Pii className="text-xs break-all text-muted-foreground">{who.email}</Pii>
        )}
      </span>
    )
  },
})

const tenant = column.display({
  id: 'tenant',
  header: 'Tenant',
  cell: ({ row }) => {
    const entryTenant = tenantOf(row.original)
    return entryTenant ? (
      <TenantLink tenant={entryTenant} className="font-medium underline-offset-4 hover:underline" />
    ) : (
      <span className="text-muted-foreground">—</span>
    )
  },
})

const action = column.display({
  id: 'action',
  header: 'Action',
  cell: ({ row }) => <Pii className="whitespace-normal">{auditSentence(row.original)}</Pii>,
})

const target = column.accessor('target', {
  header: 'Target',
  cell: ({ row }) => <Target entry={row.original} />,
})

/** The columns of a tenant's log, and of a History card; the platform page adds Tenant. */
const COLUMNS = {
  tenant: column.columns([when, actor, action, target]),
  platform: column.columns([when, actor, tenant, action, target]),
}

/** We could not load the activity; the reader must not read an empty table as "nothing happened". */
const ACTIVITY_ERROR =
  'We could not load the activity, so none is listed here. This is not a sign that there is none.'

/**
 * An audit log through the shared list table: the platform page's, a tenant's
 * Activity tab, or a History card's.
 * @param props - The list query, the empty state and the facets.
 * @param props.query - From `useListQuery`.
 * @param props.empty - Shown when the log has no entries and no filter is set.
 * @param props.label - The table's name; "Activity" by default.
 * @param props.filters - The facets: the Action facet and the page's own.
 * @param props.showTenant - Adds the Tenant column, and a link on a tenant target, for the platform-wide log.
 * @param props.subjectId - The record the list sits on; a target that is this record gets no link to the page already open.
 * @param props.landmark - False when the parent is already the list's named region.
 */
export function ActivityTable<T extends AuditEntry>({
  query,
  empty,
  label = 'Activity',
  filters,
  showTenant = false,
  subjectId,
  landmark,
}: {
  query: ListQueryState<T>
  empty: ReactNode
  label?: string
  filters: readonly DataTableFilter[]
  showTenant?: boolean
  subjectId?: string
  landmark?: boolean
}) {
  return (
    <ActivityContext.Provider value={{ showTenant, subjectId }}>
      <DataTable
        columns={(showTenant ? COLUMNS.platform : COLUMNS.tenant) as DataTableColumns<T>}
        query={query}
        label={label}
        landmark={landmark}
        errorMessage={ACTIVITY_ERROR}
        getRowId={(entry) => entry.id}
        empty={empty}
        search={{ label: 'Search activity', placeholder: 'Search by email or action' }}
        filters={filters}
      />
    </ActivityContext.Provider>
  )
}
