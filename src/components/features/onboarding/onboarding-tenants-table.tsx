import { Link } from '@tanstack/react-router'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ONBOARDING_TAB_LABELS } from '@/constants/onboarding.constants'
import { ROUTES } from '@/constants/routes'
import { formatDate } from '@/lib/format'
import type { OnboardingListState, OnboardingTenantRow } from '@/types/api.types'

/** A day, or the fallback when there is none to show. */
function day(iso: string | null, fallback: string): string {
  return iso === null ? fallback : (formatDate(iso, 'medium') ?? fallback)
}

/**
 * One page of tracked tenants in one state, in the API's order. The Days
 * stuck column shows on the stuck tab only, where the rows are sorted by it;
 * the next step is the first required one not yet done.
 */
export function OnboardingTenantsTable({
  rows,
  state,
}: {
  rows: OnboardingTenantRow[]
  state: OnboardingListState
}) {
  const isStuck = state === 'stuck'
  return (
    <Table aria-label="Onboarding tenants">
      <TableCaption className="sr-only">
        {ONBOARDING_TAB_LABELS[state]} tenants, {isStuck ? 'longest stuck first' : 'newest first'}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Tenant</TableHead>
          <TableHead scope="col">Owners</TableHead>
          <TableHead scope="col">Started</TableHead>
          <TableHead scope="col">Last progress</TableHead>
          {isStuck && (
            <TableHead scope="col" className="text-right">
              Days stuck
            </TableHead>
          )}
          <TableHead scope="col">Next required step</TableHead>
          <TableHead scope="col" className="text-right">
            Progress
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link
                to={ROUTES.tenantOnboarding}
                params={{ tenantId: row.id }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {row.name}
              </Link>
            </TableCell>
            <TableCell className="whitespace-normal">
              {row.owners.length > 0
                ? row.owners.map((owner) => owner.name).join(', ')
                : 'No active owner'}
            </TableCell>
            <TableCell>{day(row.startedAt, 'Awaiting owner')}</TableCell>
            <TableCell>{day(row.lastProgressAt, '—')}</TableCell>
            {isStuck && (
              <TableCell className="text-right tabular-nums">{row.daysStuck ?? '—'}</TableCell>
            )}
            <TableCell className="whitespace-normal">
              {row.nextStep?.title ?? 'All required steps done'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.requiredDone} of {row.requiredTotal}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
