import { PosthogLink } from '@/components/features/flags/posthog-link'
import { ToneBadge } from '@/components/features/tone-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { UnregisteredRow } from '@/types/api.types'

/**
 * Flags this environment's PostHog holds that no code declares. Listed for
 * information: express never evaluates them, so no app reads them.
 */
export function UnregisteredFlagsTable({ rows }: { rows: UnregisteredRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">None. Every PostHog flag is registered.</p>
  }
  return (
    <Table aria-label="Unregistered flags">
      <TableHeader>
        <TableRow>
          <TableHead>Flag</TableHead>
          <TableHead>In PostHog</TableHead>
          <TableHead>
            <span className="sr-only">PostHog</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>
              <code className="text-sm break-all">{row.key}</code>
            </TableCell>
            <TableCell>
              {row.active ? (
                <ToneBadge tone="success">Active</ToneBadge>
              ) : (
                <ToneBadge tone="muted">Inactive</ToneBadge>
              )}
            </TableCell>
            <TableCell>
              <PosthogLink href={row.posthogUrl} flagKey={row.key} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
