import { IconAlertCircle } from '@tabler/icons-react'
import { useState } from 'react'
import { ROLE_DENIED_ACTION } from '@/components/features/reason-dialog'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { Alert, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { MAINTENANCE_CONFLICT_UNREAD_TURN_OFF } from '@/constants/maintenance-mode.constants'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { conflictSentence } from '@/lib/maintenance-mode'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { toast } from '@/lib/toast'
import {
  isMaintenanceModeConflict,
  useChangeMaintenanceMode,
} from '@/queries/maintenance-mode.queries'
import type { PlatformMaintenanceModeView } from '@/types/api.types'

/**
 * Switching off: one confirmation, no reason or typed environment, through
 * step-up. A refusal shows inside the dialog, which stays open: a 409 says
 * what someone else saved meanwhile, and confirming again sends the version
 * just read; until then the version sent is the one the dialog opened on. A
 * 409 whose re-read failed says so and keeps that version.
 */
export function TurnOffDialog({
  view,
  open,
  onOpenChange,
}: {
  view: PlatformMaintenanceModeView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const change = useChangeMaintenanceMode()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The version the dialog opened on; only a 409's fresh read replaces it, never a poll in between.
  const [openedOn, setOpenedOn] = useState<number | null>(null)
  if (open && openedOn === null) setOpenedOn(view.version)
  if (!open && openedOn !== null) setOpenedOn(null)

  /** Switches maintenance off with the version the dialog opened on, and shows any refusal in the dialog. */
  const turnOff = async () => {
    setRefusal(null)
    setBusy(true)
    const expectedVersion = openedOn ?? view.version
    try {
      await stepUp.run(() => change.mutateAsync({ mode: 'off', expectedVersion }))
      setBusy(false)
      toast.success('Maintenance is off.')
      onOpenChange(false)
    } catch (error) {
      setBusy(false)
      if (isReauthRequired(error)) setRefusal(stepUpRefusal(error))
      else if (isMaintenanceModeConflict(error)) {
        // A failed re-read keeps the version: confirming again conflicts rather than overwriting an unseen change.
        if (error.fresh === null) setRefusal(MAINTENANCE_CONFLICT_UNREAD_TURN_OFF)
        else {
          setRefusal(conflictSentence(error.fresh))
          setOpenedOn(error.fresh.version)
        }
      } else if (statusFrom(error) === 404) setRefusal(ROLE_DENIED_ACTION)
      else setRefusal(messageFrom(error))
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // While the change runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        if (!next) setRefusal(null)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off maintenance?</AlertDialogTitle>
          <AlertDialogDescription>
            Customers get the whole app back at once, and paused queues resume. Every other platform
            owner and admin is told.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal !== null && (
          <Alert variant="destructive">
            <IconAlertCircle aria-hidden="true" />
            <AlertTitle>
              <Pii>{refusal}</Pii>
            </AlertTitle>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <BusyButton
            busy={busy}
            busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Working…'}
            type="button"
            onClick={() => void turnOff()}
          >
            Turn off
          </BusyButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
