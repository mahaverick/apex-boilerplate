import { useState } from 'react'
import { toast } from 'sonner'
import { ROLE_DENIED_ACTION, STEP_UP_DISMISSED } from '@/components/features/reason-dialog'
import { Pii } from '@/components/shared/pii'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { MAINTENANCE_CONFLICT_UNREAD } from '@/constants/maintenance-mode.constants'
import { useStepUp } from '@/hooks/use-step-up'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { conflictSentence } from '@/lib/maintenance-mode'
import { isReauthRequired } from '@/lib/step-up'
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
  const change = useChangeMaintenanceMode()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The version the dialog opened on; only a 409's fresh read replaces it, never a poll in between.
  const [openedOn, setOpenedOn] = useState<number | null>(null)
  if (open && openedOn === null) setOpenedOn(view.version)
  if (!open && openedOn !== null) setOpenedOn(null)

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
      if (isReauthRequired(error)) setRefusal(STEP_UP_DISMISSED)
      else if (isMaintenanceModeConflict(error)) {
        // A failed re-read keeps the version: confirming again conflicts rather than overwriting an unseen change.
        if (error.fresh === null) setRefusal(MAINTENANCE_CONFLICT_UNREAD)
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
          <p role="alert" className="text-sm text-destructive">
            <Pii>{refusal}</Pii>
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button type="button" disabled={busy} onClick={() => void turnOff()}>
            {busy ? 'Working…' : 'Turn off'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
