import { createColumnHelper } from '@tanstack/react-table'
import { PosthogLink } from '@/components/features/flags/posthog-link'
import { ToneBadge } from '@/components/features/tone-badge'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { EmptyState } from '@/components/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { FLAG_APP_LABELS, FLAGS_LIST_ERROR, flagStateBadge } from '@/constants/flags.constants'
import type { FlagRow } from '@/types/api.types'

/** "3 conditions, up to 50%", or what PostHog holds when it has none. */
function rolloutText(row: FlagRow): string {
  if (row.conditions === 0) return 'No conditions'
  const count = row.conditions === 1 ? '1 condition' : `${row.conditions} conditions`
  return row.maxRollout === null ? count : `${count}, up to ${row.maxRollout}%`
}

const column = createColumnHelper<DataTableFeatures, FlagRow>()

/** Each registered flag: its declaration from code and its state in PostHog. */
const REGISTRY_COLUMNS = column.columns([
  column.accessor('key', {
    header: 'Flag',
    // Not sortable: `key` is the list's only sort and its default, so a sort control would change nothing.
    meta: { className: 'align-top' },
    cell: ({ row }) => (
      // Capped: the cell wraps its description instead of widening the table.
      <div className="max-w-sm whitespace-normal">
        <div className="flex flex-wrap items-center gap-1">
          <code className="text-sm font-medium break-all">{row.original.key}</code>
          {row.original.experiment && <Badge variant="secondary">Experiment</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{row.original.description}</p>
      </div>
    ),
  }),
  column.accessor('kind', {
    header: 'Kind',
    meta: { className: 'align-top' },
    cell: ({ row }) =>
      row.original.kind === 'boolean' ? (
        'Boolean'
      ) : (
        <span className="whitespace-normal">
          Variants <code className="text-sm">{(row.original.variants ?? []).join(', ')}</code>
        </span>
      ),
  }),
  column.accessor('scope', {
    header: 'Scope',
    meta: { className: 'align-top' },
    cell: ({ getValue }) => (getValue() === 'tenant' ? 'Tenant' : 'User'),
  }),
  column.accessor('apps', {
    id: 'sentTo',
    header: 'Sent to',
    meta: { label: 'Sent to', className: 'align-top' },
    cell: ({ row }) =>
      row.original.client ? (
        <div className="flex flex-wrap gap-1">
          {row.original.apps.map((app) => (
            <Badge key={app} variant="outline">
              {FLAG_APP_LABELS[app]}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground">Server only</span>
      ),
  }),
  column.accessor('fallback', {
    header: 'Fallback',
    meta: { className: 'align-top' },
    cell: ({ getValue }) => <code className="text-sm">{String(getValue())}</code>,
  }),
  column.accessor('state', {
    header: 'State',
    meta: { className: 'align-top' },
    // The state cell also names the construct that made a flag unsupported, so hiding it would hide that reason.
    enableHiding: false,
    cell: ({ row }) => {
      const state = flagStateBadge(row.original.state)
      return (
        <div className="whitespace-normal">
          <ToneBadge tone={state.tone}>{state.label}</ToneBadge>
          {row.original.unsupportedReason !== undefined && (
            <p className="text-xs text-muted-foreground">
              Uses <code>{row.original.unsupportedReason}</code>
            </p>
          )}
        </div>
      )
    },
  }),
  column.display({
    id: 'rollout',
    header: 'Rollout',
    meta: { className: 'align-top' },
    cell: ({ row }) => (
      <span className="text-sm whitespace-normal">{rolloutText(row.original)}</span>
    ),
  }),
  column.display({
    id: 'posthog',
    header: () => <span className="sr-only">PostHog</span>,
    meta: { label: 'PostHog', actions: true, className: 'align-top' },
    cell: ({ row }) => <PosthogLink href={row.original.posthogUrl} flagKey={row.original.key} />,
  }),
])

/** Boolean or multivariate; the API's `kind` values. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'kind',
    label: 'Kind',
    options: [
      { value: 'boolean', label: 'Boolean' },
      { value: 'multivariate', label: 'Multivariate' },
    ],
  },
  {
    name: 'state',
    label: 'State',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'missing', label: 'Missing' },
      { value: 'unsupported', label: 'Unsupported' },
    ],
  },
]

/**
 * Every flag the express registry declares, in key order, with the state of
 * its definition in this environment's PostHog snapshot, through the shared
 * list table. A flag that is missing or unsupported serves its fallback
 * everywhere. The page's section is already the "Registered flags" region.
 */
export function FlagRegistryTable({ query }: { query: ListQueryState<FlagRow> }) {
  return (
    <DataTable
      columns={REGISTRY_COLUMNS}
      query={query}
      label="Registered flags"
      landmark={false}
      errorMessage={FLAGS_LIST_ERROR}
      getRowId={(row) => row.key}
      search={{ label: 'Search flags', placeholder: 'Search by key or description' }}
      filters={FILTERS}
      empty={<EmptyState size="compact" title="No flags are registered." />}
    />
  )
}
