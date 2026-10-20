import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Pii } from '@/components/shared/pii'
import { ROUTES } from '@/constants/routes'
import { formatDate } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import type { OnboardingListState, OnboardingTenantRow } from '@/types/api.types'

const column = createColumnHelper<DataTableFeatures, OnboardingTenantRow>()

/** A day, or the fallback when there is none to show. */
function day(iso: string | null, fallback: string): string {
  return iso === null ? fallback : (formatDate(iso, 'medium') ?? fallback)
}

/** The tab's own order: the column it names carries `-order`, the API's default, never sent. */
const TAB_ORDER = { sorts: ['-order'], sortName: analyticsKey('order') } as const

/**
 * The columns for one tab. Days stuck shows on the stuck tab only; the
 * column the tab is ordered by carries the `-order` sort. Each tab's columns
 * are built once, so the table keeps them stable between renders.
 * @param state - The tab.
 */
function onboardingColumns(state: OnboardingListState) {
  const isStuck = state === 'stuck'
  return column.columns([
    column.accessor('name', {
      header: 'Tenant',
      meta: { sorts: ['name'], sortName: analyticsKey('name') },
      cell: ({ row }) => (
        <Link
          to={ROUTES.tenantOnboarding}
          params={{ tenantId: row.original.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    }),
    column.accessor('owners', {
      header: 'Owners',
      meta: { className: 'whitespace-normal' },
      cell: ({ getValue }) =>
        getValue().length > 0 ? (
          <Pii>
            {getValue()
              .map((owner) => owner.name)
              .join(', ')}
          </Pii>
        ) : (
          'No active owner'
        ),
    }),
    column.accessor('startedAt', {
      header: 'Started',
      meta: isStuck ? undefined : { ...TAB_ORDER, sortWords: 'date' },
      cell: ({ getValue }) => day(getValue(), 'Awaiting owner'),
    }),
    column.accessor('lastProgressAt', {
      header: 'Last progress',
      cell: ({ getValue }) => day(getValue(), '—'),
    }),
    ...(isStuck
      ? [
          column.accessor('daysStuck', {
            header: 'Days stuck',
            meta: { ...TAB_ORDER, sortWords: 'number', className: 'text-right tabular-nums' },
            cell: ({ getValue }) => getValue() ?? '—',
          }),
        ]
      : []),
    column.accessor((row) => row.nextStep?.title ?? 'All required steps done', {
      id: 'nextStep',
      header: 'Next required step',
      meta: { className: 'whitespace-normal' },
    }),
    column.accessor((row) => `${row.requiredDone} of ${row.requiredTotal} steps`, {
      id: 'progress',
      header: 'Progress',
      meta: { className: 'text-right tabular-nums' },
    }),
  ])
}

/** One set of columns per tab, built at load so `DataTable` gets a stable array. */
const COLUMNS = {
  stuck: onboardingColumns('stuck'),
  in_progress: onboardingColumns('in_progress'),
  awaiting_owner: onboardingColumns('awaiting_owner'),
  complete: onboardingColumns('complete'),
  dismissed: onboardingColumns('dismissed'),
} satisfies Record<OnboardingListState, unknown>

/**
 * One tab's tracked tenants, through the shared list table. The Days stuck
 * column shows on the stuck tab only; the next step is the first required
 * one not yet done.
 */
export function OnboardingTenantsTable({
  state,
  query,
  empty,
}: {
  state: OnboardingListState
  query: ListQueryState<OnboardingTenantRow>
  empty: ReactNode
}) {
  return (
    <DataTable
      columns={COLUMNS[state]}
      query={query}
      label="Onboarding tenants"
      errorMessage="We couldn’t load these tenants. Select Try again."
      getRowId={(row) => row.id}
      empty={empty}
      search={{ label: 'Search tenants', placeholder: 'Search by tenant name' }}
    />
  )
}
