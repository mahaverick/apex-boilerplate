import { useState, type RefObject } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { Button } from '@/components/ui/button'
import { useStepUp } from '@/hooks/use-step-up'
import { toast } from '@/lib/toast'
import { useRevokeGrant } from '@/queries/billing-admin.queries'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { StaffTenantBilling } from '@/types/billing.types'

/** One grant, as the tenant's billing view carries it. */
type TenantGrant = StaffTenantBilling['grants'][number]

/**
 * One grant row's Revoke button and its dialog, for a platform manager or
 * above. The button shows only while the grant is active. Revoking runs
 * through step-up with an audited reason; a grant express can't find on this
 * tenant (`grant_not_found`) shows the API's sentence in the dialog, and the
 * view refetches. The dialog stays mounted with the row, so it still closes
 * once the revoked row loses its button, sending focus to `fallbackFocus`.
 */
export function RevokeGrantAction({
  tenant,
  grant,
  label,
  fallbackFocus,
}: {
  tenant: PlatformTenantDetail
  grant: TenantGrant
  /** The grant's catalog label, or its registry key when the catalog lacks it. */
  label: string
  /** Where focus goes once the button is gone. */
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const stepUp = useStepUp()
  const revoke = useRevokeGrant(tenant.id)
  const [open, setOpen] = useState(false)
  const active = grant.status === 'active'
  const isFeature = typeof grant.value === 'boolean'

  return (
    <>
      {active && (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Revoke the ${label} grant`}
          onClick={() => setOpen(true)}
        >
          Revoke
        </Button>
      )}
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        finalFocus={active ? undefined : fallbackFocus}
        title={`Revoke the ${label} grant for ${tenant.name}?`}
        description={
          isFeature
            ? `${tenant.name} loses the ${label} grant now. It keeps ${label} only if its plan or another active grant turns it on.`
            : `${tenant.name} loses the ${label} grant now. Its ${label} goes back to the plan’s value, or to another active grant’s.`
        }
        confirmLabel="Revoke grant"
        destructive
        onConfirm={async (reason) => {
          await stepUp.run(() => revoke.mutateAsync({ grantId: grant.id, reason }))
          toast.success(`${label} grant revoked for ${tenant.name}.`)
        }}
      />
    </>
  )
}
