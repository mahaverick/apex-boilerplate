import { PosthogLink } from '@/components/features/flags/posthog-link'
import { ToneBadge } from '@/components/features/tone-badge'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FLAG_APP_LABELS, flagStateBadge } from '@/constants/flags.constants'
import type { FlagRow } from '@/types/api.types'

/** "3 conditions, up to 50%", or what PostHog holds when it has none. */
function rolloutText(row: FlagRow): string {
  if (row.conditions === 0) return 'No conditions'
  const count = row.conditions === 1 ? '1 condition' : `${row.conditions} conditions`
  return row.maxRollout === null ? count : `${count}, up to ${row.maxRollout}%`
}

/** One registered flag: its declaration from code and its state in PostHog. */
function FlagRegistryRow({ row }: { row: FlagRow }) {
  const state = flagStateBadge(row.state)
  return (
    <TableRow>
      <TableCell className="max-w-sm align-top whitespace-normal">
        <div className="flex flex-wrap items-center gap-1">
          <code className="text-sm font-medium break-all">{row.key}</code>
          {row.experiment && <Badge variant="secondary">Experiment</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{row.description}</p>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        {row.kind === 'boolean' ? (
          'Boolean'
        ) : (
          <span>
            Variants <code className="text-sm">{(row.variants ?? []).join(', ')}</code>
          </span>
        )}
      </TableCell>
      <TableCell className="align-top">{row.scope === 'tenant' ? 'Tenant' : 'User'}</TableCell>
      <TableCell className="align-top">
        {row.client ? (
          <div className="flex flex-wrap gap-1">
            {row.apps.map((app) => (
              <Badge key={app} variant="outline">
                {FLAG_APP_LABELS[app]}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">Server only</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <code className="text-sm">{String(row.fallback)}</code>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <ToneBadge tone={state.tone}>{state.label}</ToneBadge>
        {row.unsupportedReason !== undefined && (
          <p className="text-xs text-muted-foreground">
            Uses <code>{row.unsupportedReason}</code>
          </p>
        )}
      </TableCell>
      <TableCell className="align-top text-sm whitespace-normal">{rolloutText(row)}</TableCell>
      <TableCell className="align-top">
        <PosthogLink href={row.posthogUrl} flagKey={row.key} />
      </TableCell>
    </TableRow>
  )
}

/**
 * Every flag the express registry declares, in registry order, with the
 * state of its definition in this environment's PostHog snapshot. A flag
 * that is missing or unsupported serves its fallback everywhere.
 */
export function FlagRegistryTable({ items }: { items: FlagRow[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No flags are registered.</p>
  }
  return (
    <Table aria-label="Registered flags">
      <TableHeader>
        <TableRow>
          <TableHead>Flag</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Sent to</TableHead>
          <TableHead>Fallback</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Rollout</TableHead>
          <TableHead>
            <span className="sr-only">PostHog</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row) => (
          <FlagRegistryRow key={row.key} row={row} />
        ))}
      </TableBody>
    </Table>
  )
}
