import { IconCopy } from '@tabler/icons-react'
import { useLocation } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { ToneBadge } from '@/components/features/tone-badge'
import { copyId } from '@/components/shared/command-palette/copy-id'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Note } from '@/components/shared/note'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { billingDate, TAX_HELD_STATUS_BADGE } from '@/constants/billing-labels'
import { useStepUp } from '@/hooks/use-step-up'
import { codeFrom } from '@/lib/api-error'
import { formatInr } from '@/lib/billing-format'
import { staffMessageFrom } from '@/lib/staff-message'
import { IST } from '@/lib/tax-format'
import { toast } from '@/lib/toast'
import { taxHeldChargesListOptions, useResolveHeldCharge } from '@/queries/billing-admin.queries'
import { taxHeldChargesList } from '@/queries/billing-reads.queries'
import type { PlatformTenantDetail } from '@/types/api.types'
import {
  TAX_DOCUMENTS_DISABLED,
  TAX_HELD_STATUSES,
  type TaxHeldCharge,
} from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, TaxHeldCharge>()

/** The hash that sends staff to this card. */
const HELD_HASH = 'held-charges'

/** The Status facet over a held charge's two states. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'status',
    label: 'Status',
    options: TAX_HELD_STATUSES.map((value) => ({
      value,
      label: TAX_HELD_STATUS_BADGE[value].label,
    })),
  },
]

/** An open row's Mark resolved button and its dialog; the dialog asks for the note express records. */
function ResolveAction({
  tenant,
  charge,
}: {
  tenant: PlatformTenantDetail
  charge: TaxHeldCharge
}) {
  const stepUp = useStepUp()
  const resolve = useResolveHeldCharge(tenant.id)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Mark payment ${charge.paymentId} resolved`}
        onClick={() => setOpen(true)}
      >
        Mark resolved
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={`Mark payment ${charge.paymentId} resolved?`}
        description="Do this after you issue its tax invoice by hand. We record your note and issue nothing."
        confirmLabel="Mark resolved"
        refusalMessage={staffMessageFrom}
        onConfirm={async (reason) => {
          await stepUp.run(() => resolve.mutateAsync({ heldId: charge.id, reason }))
          toast.success('Held charge marked resolved.')
        }}
      />
    </>
  )
}

/** The table's columns. Dates are in IST, as on the tax documents. */
const columnsFor = (tenant: PlatformTenantDetail, canResolve: boolean) =>
  column.columns([
    column.accessor('paymentId', {
      header: 'Payment ID',
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2">
          <code className="break-all">{getValue()}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Copy payment ID ${getValue()}`}
            onClick={() => copyId(getValue(), 'Payment ID copied.')}
          >
            <IconCopy aria-hidden="true" />
          </Button>
        </span>
      ),
    }),
    column.accessor('subscriptionId', {
      header: 'Subscription ID',
      cell: ({ getValue }) => {
        const id = getValue()
        return id === null ? '—' : <code className="break-all">{id}</code>
      },
    }),
    column.accessor('amountMinor', {
      header: 'Amount',
      meta: { className: 'tabular-nums' },
      cell: ({ getValue }) => formatInr(getValue()),
    }),
    column.accessor('paidAt', {
      header: 'Paid',
      cell: ({ getValue }) => billingDate(getValue(), IST),
    }),
    column.accessor('heldAt', {
      header: 'Held',
      cell: ({ getValue }) => billingDate(getValue(), IST),
    }),
    column.display({
      id: 'status',
      header: 'Status',
      meta: { label: 'Status' },
      cell: ({ row }) => {
        const badge = TAX_HELD_STATUS_BADGE[row.original.resolvedAt === null ? 'open' : 'resolved']
        return <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
      },
    }),
    column.display({
      id: 'resolution',
      header: 'Resolution',
      meta: { label: 'Resolution' },
      cell: ({ row }) => {
        const { resolvedAt, resolvedBy, resolution } = row.original
        if (resolvedAt === null) return '—'
        return (
          <span className="block min-w-48 wrap-break-word whitespace-normal">
            {billingDate(resolvedAt, IST)} by{' '}
            {resolvedBy === null ? 'a deleted account' : <Pii>{resolvedBy.name}</Pii>}
            {resolution !== null && (
              <>
                : “<Pii>{resolution}</Pii>”
              </>
            )}
          </span>
        )
      },
    }),
    ...(canResolve
      ? [
          column.display({
            id: 'actions',
            header: 'Actions',
            meta: { label: 'Actions', actions: true },
            cell: ({ row }) =>
              row.original.resolvedAt === null ? (
                <ResolveAction tenant={tenant} charge={row.original} />
              ) : null,
          }),
        ]
      : []),
  ])

/**
 * The tenant's SEZ charges held for a hand-made tax invoice, newest first,
 * filtered by status in the URL under the `held` prefix. An admin marks an
 * open charge resolved with a note, after step-up. A 404 `tax_documents_disabled`
 * shows express's sentence in a note, as the Tax documents card does. Arriving on `#held-charges`
 * (the summary's link, a billing alert) puts focus on the heading.
 * @param props.tenant - The tenant's platform detail.
 * @param props.canResolve - Whether the signed-in role may mark a charge resolved.
 */
export function HeldChargesCard({
  tenant,
  canResolve,
}: {
  tenant: PlatformTenantDetail
  canResolve: boolean
}) {
  const columns = useMemo(() => columnsFor(tenant, canResolve), [tenant, canResolve])
  const list = useListSearch(taxHeldChargesList)
  const query = useListQuery(list, (request) => taxHeldChargesListOptions(tenant.id, request))
  const disabled = query.query.isError && codeFrom(query.query.error) === TAX_DOCUMENTS_DISABLED
  const heading = useRef<HTMLHeadingElement>(null)
  const hash = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    if (hash === HELD_HASH) heading.current?.focus()
  }, [hash])
  return (
    <Card id={HELD_HASH}>
      <CardHeader>
        <CardTitle>
          <h2 ref={heading} tabIndex={-1} className="outline-none">
            Held SEZ charges
          </h2>
        </CardTitle>
        <CardDescription>
          We don’t invoice charges for an SEZ (Special Economic Zone) unit automatically. Issue each
          tax invoice by hand, then mark the charge resolved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <Note tone="info">{staffMessageFrom(query.query.error)}</Note>
        ) : (
          <DataTable
            columns={columns}
            query={query}
            label="Held SEZ charges"
            getRowId={(row) => row.id}
            filters={FILTERS}
            errorMessage="We couldn’t load this tenant’s held charges. Select Try again."
            empty={<EmptyState size="compact" title="No held charges." />}
          />
        )}
      </CardContent>
    </Card>
  )
}
