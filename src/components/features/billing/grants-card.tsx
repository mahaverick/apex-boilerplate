import type { ReactNode } from 'react'
import { ToneBadge } from '@/components/features/tone-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { BadgeTone } from '@/constants/badge-tones'
import { billingDate } from '@/constants/billing-labels'
import { formatCount } from '@/lib/format'
import type { EntitlementCatalogEntry, StaffTenantBilling } from '@/types/billing.types'

/** One grant, as the tenant's billing view carries it. */
type TenantGrant = StaffTenantBilling['grants'][number]

/** Each grant status's badge. */
const GRANT_STATUS_BADGE: Record<TenantGrant['status'], { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'muted' },
  revoked: { label: 'Revoked', tone: 'outline' },
}

/**
 * A grant's value: a feature grant is always on, a limit grant is its number
 * or no limit.
 * @param grant - The grant.
 */
function valueText(grant: TenantGrant): string {
  if (typeof grant.value === 'boolean') return grant.value ? 'On' : 'Off'
  return grant.value === null ? 'No limit' : formatCount(grant.value)
}

/**
 * The tenant's grants, newest first as the API sends them: what each sets,
 * until when, its status, who granted it and why. `actions` renders a row's
 * controls (Revoke) for a role that may use them; without it there is no
 * actions column.
 */
export function GrantsCard({
  grants,
  catalog,
  actions,
}: {
  grants: readonly TenantGrant[]
  catalog: readonly EntitlementCatalogEntry[]
  actions?: (grant: TenantGrant) => ReactNode
}) {
  const labels = new Map(catalog.map((entry) => [entry.key, entry.label]))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Grants</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <EmptyState
            size="compact"
            title="No grants."
            description="A grant raises a limit or turns on a feature beyond the plan."
          />
        ) : (
          <Table aria-label="Grants">
            <TableCaption className="sr-only">Grants</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Entitlement</TableHead>
                <TableHead scope="col">Value</TableHead>
                <TableHead scope="col">Ends</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Granted by</TableHead>
                <TableHead scope="col">Reason</TableHead>
                {actions !== undefined && (
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => {
                const status = GRANT_STATUS_BADGE[grant.status]
                return (
                  <TableRow key={grant.id}>
                    <TableCell className="font-medium">
                      {labels.get(grant.key) ?? grant.key}
                    </TableCell>
                    <TableCell>{valueText(grant)}</TableCell>
                    <TableCell>
                      {grant.expiresAt === null ? 'No end date' : billingDate(grant.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
                    </TableCell>
                    <TableCell>
                      {grant.grantedBy === null ? (
                        'A script or removed account'
                      ) : (
                        <Pii>{grant.grantedBy.name}</Pii>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Pii>{grant.reason}</Pii>
                    </TableCell>
                    {actions !== undefined && <TableCell>{actions(grant)}</TableCell>}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
