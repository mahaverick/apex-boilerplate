import { Link } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import type { BillingAlert } from '@/types/billing.types'

/** The card on the Billing tab that fixes each tax alert. */
const TAX_ALERT_HASHES: Partial<Record<BillingAlert['kind'], string>> = {
  tax_held_sez: 'held-charges',
  tax_issue_failed: 'tax-documents',
  tax_invoice_late: 'tax-documents',
  tax_credit_note_late: 'tax-documents',
}

/**
 * The alert's tenant as a link to its Billing tab (to the card that fixes a
 * tax alert, by `kind`), or "No tenant" when the
 * alert names none or the tenant is archived or gone (express sends null).
 */
export function AlertTenant({
  tenant,
  kind,
}: {
  tenant: BillingAlert['tenant']
  kind: BillingAlert['kind']
}) {
  if (tenant === null) return <span className="text-muted-foreground">No tenant</span>
  return (
    <Link
      to={ROUTES.tenantBilling}
      params={{ tenantId: tenant.id }}
      hash={TAX_ALERT_HASHES[kind]}
      className="underline-offset-4 hover:underline"
    >
      {tenant.name}
    </Link>
  )
}
