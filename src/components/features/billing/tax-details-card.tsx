import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { TaxDetailsDialog } from '@/components/features/billing/tax-details-dialog'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { EmptyState } from '@/components/shared/empty-state'
import { Note } from '@/components/shared/note'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { billingDate } from '@/constants/billing-labels'
import { codeFrom } from '@/lib/api-error'
import { isRoleDenied } from '@/lib/role-denied'
import { staffMessageFrom } from '@/lib/staff-message'
import { IST } from '@/lib/tax-format'
import { staffTaxDetailsQueryOptions } from '@/queries/billing-admin.queries'
import type { PlatformTenantDetail } from '@/types/api.types'
import {
  TAX_DOCUMENTS_DISABLED,
  type StaffTaxDetails,
  type StaffTenantBilling,
} from '@/types/billing.types'

/**
 * The address on one line: each part that is set, or an em dash when none is.
 * @param details - The stored details.
 */
function addressText(details: StaffTaxDetails): string {
  const parts = [details.addressLine1, details.addressLine2, details.city, details.pincode].filter(
    (part): part is string => part !== null
  )
  return parts.length === 0 ? '—' : parts.join(', ')
}

/**
 * A failed read of the details. A 404 `tax_documents_disabled` keeps express's
 * sentence in a note; any other 404 is the role gate (`RoleDenied`); anything
 * else offers a retry.
 * @param props.error - The read's error.
 * @param props.onRetry - Reads again.
 */
function ReadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (codeFrom(error) === TAX_DOCUMENTS_DISABLED) {
    return <Note tone="warning">{staffMessageFrom(error)}</Note>
  }
  if (isRoleDenied(error)) return <RoleDenied />
  return <LoadError message={staffMessageFrom(error)} onRetry={onRetry} />
}

/**
 * What a tenant's tax invoices name as the buyer: GSTIN, legal name, address,
 * state and SEZ unit, and who last changed them. The details load on mount.
 * A manager corrects them in a dialog while registration is on (`canEdit`);
 * with registration off the card reads only, and a note says so.
 * @param props.tenant - The tenant's platform detail.
 * @param props.billing - The tenant's billing.
 * @param props.canEdit - Whether the signed-in role may correct the details now.
 */
export function TaxDetailsCard({
  tenant,
  billing,
  canEdit,
}: {
  tenant: PlatformTenantDetail
  billing: StaffTenantBilling
  canEdit: boolean
}) {
  const query = useQuery(staffTaxDetailsQueryOptions(tenant.id))
  const [open, setOpen] = useState(false)
  const details = query.data
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Tax details</h2>
        </CardTitle>
        {billing.taxDocumentsEnabled && (
          <CardDescription>
            What this tenant’s tax invoices name as the buyer. A change applies to invoices issued
            from then on; issued documents keep the details they were issued with.
          </CardDescription>
        )}
        {canEdit && details !== undefined && (
          <CardAction>
            <Button variant="outline" onClick={() => setOpen(true)}>
              {details === null ? 'Add tax details' : 'Correct tax details'}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {!billing.taxDocumentsEnabled && (
          <Note tone="info">
            This server no longer issues tax documents. These details are read-only, and every
            issued document stays downloadable.
          </Note>
        )}
        {query.isError && <ReadError error={query.error} onRetry={() => void query.refetch()} />}
        {details === null && (
          <EmptyState
            size="compact"
            title="No tax details saved."
            description="This tenant’s invoices carry no GSTIN (Goods and Services Tax Identification Number), so we issue them as business-to-consumer (B2C) invoices."
          />
        )}
        {details !== undefined && details !== null && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">GSTIN</dt>
            <dd>
              {details.gstin === null ? (
                'None (B2C, business-to-consumer)'
              ) : (
                <Pii>{details.gstin}</Pii>
              )}
            </dd>
            <dt className="text-muted-foreground">Legal name</dt>
            <dd>
              <Pii>{details.legalName}</Pii>
            </dd>
            <dt className="text-muted-foreground">Address</dt>
            <dd>
              <Pii>{addressText(details)}</Pii>
            </dd>
            <dt className="text-muted-foreground">State</dt>
            <dd>
              {details.state.code} {details.state.name}
            </dd>
            <dt className="text-muted-foreground">SEZ unit</dt>
            <dd>
              {details.isSez ? 'Yes. We hold its charges for staff to invoice by hand.' : 'No'}
            </dd>
            <dt className="text-muted-foreground">Last changed</dt>
            <dd>
              {billingDate(details.updatedAt, IST)} by{' '}
              {details.updatedBy === null ? (
                'a deleted account'
              ) : (
                <Pii>{details.updatedBy.name}</Pii>
              )}
            </dd>
          </dl>
        )}
      </CardContent>
      {canEdit && details !== undefined && (
        <TaxDetailsDialog tenant={tenant} details={details} open={open} onOpenChange={setOpen} />
      )}
    </Card>
  )
}
