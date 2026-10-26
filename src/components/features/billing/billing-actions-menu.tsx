import { IconChevronDown } from '@tabler/icons-react'
import { useMemo, useState, type RefObject } from 'react'
import { AddGrantDialog } from '@/components/features/billing/add-grant-dialog'
import { CancelBillingDialog } from '@/components/features/billing/cancel-billing-dialog'
import { ExtendTrialDialog } from '@/components/features/billing/extend-trial-dialog'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { usePaletteCommands } from '@/components/shared/command-palette/palette-registry'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useStepUp } from '@/hooks/use-step-up'
import { billingActionsFor, providerName } from '@/lib/billing-actions'
import { focusFallbackOnRemoval } from '@/lib/focus-fallback'
import { toast } from '@/lib/toast'
import { analyticsKey } from '@/observability/telemetry'
import { useResyncBilling } from '@/queries/billing-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { EntitlementCatalogEntry, StaffTenantBilling } from '@/types/billing.types'

/** Which billing action's dialog is open, if any. */
type Open = 'resync' | 'extend' | 'grant' | 'cancel' | null

/** Each action's menu label and the fixed key the palette sends for it, in menu order. */
const PALETTE_ACTIONS = [
  { open: 'resync', label: 'Resync billing', action: analyticsKey('page_action_resync_billing') },
  { open: 'extend', label: 'Extend trial', action: analyticsKey('page_action_extend_trial') },
  { open: 'grant', label: 'Add grant', action: analyticsKey('page_action_add_grant') },
  {
    open: 'cancel',
    label: 'Cancel subscription',
    action: analyticsKey('page_action_cancel_billing'),
  },
] as const

/**
 * The Billing card's actions menu ("Billing actions"), with the palette's
 * page actions for the same items. Each item shows only for a role and a
 * state express accepts (`billingActionsFor`); no menu renders when none
 * applies. The dialogs stay mounted, so one whose write removed its own
 * item (a cancel that ends the last subscription) still closes. Every write
 * runs through step-up and carries a reason. A dialog
 * opened from the palette returns focus to `fallbackFocus`, since the
 * palette's close already moved it.
 */
export function BillingActionsMenu({
  tenant,
  billing,
  catalog,
  fallbackFocus,
}: {
  tenant: PlatformTenantDetail
  billing: StaffTenantBilling
  catalog: readonly EntitlementCatalogEntry[]
  /** Where focus goes when the trigger is gone or the dialog came from the palette. */
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const role = useAuthStore((s) => s.user?.platformRole)
  const stepUp = useStepUp()
  const resync = useResyncBilling(tenant.id)
  const [open, setOpen] = useState<Open>(null)
  /** Whether the open dialog came from the palette, whose close has already moved focus. */
  const [fromPalette, setFromPalette] = useState(false)
  const keepFocusOnPage = useMemo(() => focusFallbackOnRemoval(fallbackFocus), [fallbackFocus])
  const can = billingActionsFor(role, tenant, billing, catalog)
  const hasActions = can.resync || can.extend || can.grant || can.cancel

  usePaletteCommands(
    'billing-actions',
    PALETTE_ACTIONS.filter((entry) => can[entry.open]).map((entry): PaletteCommand => ({
      id: entry.open,
      label: entry.label,
      action: entry.action,
      timing: 'afterClose',
      run: () => {
        setFromPalette(true)
        setOpen(entry.open)
      },
    }))
  )

  /** Opens an action's dialog from the menu, whose trigger takes focus back on close. */
  const openFromMenu = (which: Exclude<Open, null>) => {
    setFromPalette(false)
    setOpen(which)
  }
  /** The open state for one of the action dialogs. */
  const dialogProps = (which: Exclude<Open, null>) => ({
    open: open === which,
    onOpenChange: (next: boolean) => setOpen(next ? which : null),
    finalFocus: hasActions && !fromPalette ? undefined : fallbackFocus,
  })
  const provider = providerName(billing)

  return (
    <>
      {hasActions && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button ref={keepFocusOnPage} variant="outline" aria-label="Billing actions" />}
          >
            Actions
            <IconChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {can.resync && (
              <DropdownMenuItem onClick={() => openFromMenu('resync')}>
                Resync billing
              </DropdownMenuItem>
            )}
            {can.extend && (
              <DropdownMenuItem onClick={() => openFromMenu('extend')}>
                Extend trial
              </DropdownMenuItem>
            )}
            {can.grant && (
              <DropdownMenuItem onClick={() => openFromMenu('grant')}>Add grant</DropdownMenuItem>
            )}
            {can.cancel && (
              <DropdownMenuItem variant="destructive" onClick={() => openFromMenu('cancel')}>
                Cancel subscription
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ReasonDialog
        {...dialogProps('resync')}
        title={`Resync billing for ${tenant.name}?`}
        description={`We read this tenant’s subscriptions from ${provider} and update the plan and dates. Nothing is charged.`}
        confirmLabel="Resync"
        onConfirm={async (reason) => {
          await stepUp.run(() => resync.mutateAsync({ reason }))
          toast.success(`Billing for ${tenant.name} matches ${provider}.`)
        }}
      />
      <ExtendTrialDialog tenant={tenant} billing={billing} {...dialogProps('extend')} />
      <AddGrantDialog tenant={tenant} catalog={catalog} {...dialogProps('grant')} />
      <CancelBillingDialog tenant={tenant} billing={billing} {...dialogProps('cancel')} />
    </>
  )
}
