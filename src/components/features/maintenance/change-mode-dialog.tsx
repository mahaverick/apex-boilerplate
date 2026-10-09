import { useForm } from '@tanstack/react-form'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { MaintenancePreview } from '@/components/features/maintenance/maintenance-preview'
import { ROLE_DENIED_ACTION, STEP_UP_DISMISSED } from '@/components/features/reason-dialog'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  CONFIRMATION_MISMATCH,
  MAINTENANCE_CONFLICT_UNREAD,
  MAINTENANCE_MODE_LABELS,
  NOTHING_CHANGED,
} from '@/constants/maintenance-mode.constants'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useStepUp } from '@/hooks/use-step-up'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { conflictSentence, isSwitchOn } from '@/lib/maintenance-mode'
import { isReauthRequired } from '@/lib/step-up'
import {
  isMaintenanceModeConflict,
  useChangeMaintenanceMode,
} from '@/queries/maintenance-mode.queries'
import {
  maintenanceModeFormSchema,
  type MaintenanceModeFormValues,
} from '@/schemas/maintenance-mode.schemas'
import type { ChangeMaintenanceModeBody, PlatformMaintenanceModeView } from '@/types/api.types'

/** A mode the dialog can set; switching off is `TurnOffDialog`'s. */
export type OnMode = 'read_only' | 'full'

const MODE_HINTS: Record<OnMode, string> = {
  read_only: 'Customers can read but not change anything. Jobs keep running.',
  full: 'Customers see a maintenance page and cannot sign in. Every queue pauses.',
}

export interface ChangeModeDialogProps {
  /** The state the change starts from. */
  view: PlatformMaintenanceModeView
  /** The modes offered; with more than one, the dialog asks which. */
  modes: readonly OnMode[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The dialog's title for a change from `from` to the offered modes. */
function titleFor(from: PlatformMaintenanceModeView['mode'], modes: readonly OnMode[]): string {
  if (from === 'off') return 'Turn on maintenance'
  const [only] = modes
  if (modes.length > 1 || only === undefined) return 'Change maintenance mode'
  if (only === from) return 'Edit the customer message'
  return only === 'full' ? 'Escalate to full maintenance' : 'Switch to read-only maintenance'
}

/**
 * Sets maintenance to `read_only` or `full`, or edits the message of the mode
 * that is on. The message has a live preview of what customers will see.
 * Switching on or escalating also needs a reason and the API's environment
 * typed exactly, compared against the platform GET's `environment`; other
 * changes take an optional reason. The change runs through step-up. A 409
 * shows what someone else saved meanwhile and keeps the dialog open, and the
 * next submit sends the version just read. Until then a submit sends the
 * version the dialog opened on, so a poll that lands meanwhile makes it a
 * conflict instead of silently overwriting what was read. A change that is
 * not a switch-on starts with the reason now saved in the Reason field;
 * emptying it clears the stored reason (`reason: null`), and a 409 moves an
 * untouched pre-filled reason to the one just read. A save express answers
 * with the version unchanged stored nothing, and the toast says so. The mode
 * the form is validated against, and whether a submit is a switch-on, both
 * come from the mode the dialog opened on, replaced only when a 409 reads a
 * newer one; a poll in between changes neither. A 409 whose re-read failed
 * says so and keeps the version, so the next submit conflicts again.
 */
export function ChangeModeDialog(props: ChangeModeDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        // While the change runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        props.onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {props.open && <ChangeModeForm {...props} busy={busy} onBusyChange={setBusy} />}
      </DialogContent>
    </Dialog>
  )
}

function ChangeModeForm({
  view,
  modes,
  onOpenChange,
  busy,
  onBusyChange,
}: ChangeModeDialogProps & { busy: boolean; onBusyChange: (busy: boolean) => void }) {
  const stepUp = useStepUp()
  const change = useChangeMaintenanceMode()
  const serverErrors = useServerErrors()
  const [conflict, setConflict] = useState<string | null>(null)
  // What this form was opened on; only a 409's fresh read replaces it, never a poll in between.
  const [base, setBase] = useState({ mode: view.mode, version: view.version })
  const schema = useMemo(
    () => maintenanceModeFormSchema(base.mode, view.environment),
    [base.mode, view.environment]
  )
  // Set when the dialog opens and re-read only by a 409, so a poll in between does not move it.
  const [prefilledReason, setPrefilledReason] = useState(() =>
    isSwitchOn(view.mode, modes[0] ?? 'read_only') ? '' : (view.reason ?? '')
  )
  const defaultValues: MaintenanceModeFormValues = {
    mode: modes[0] ?? 'read_only',
    message: view.message ?? '',
    // A change that is not a switch-on starts from the saved reason; emptying it sends `reason: null`, which clears it.
    reason: prefilledReason,
    confirmation: '',
  }
  const form = useForm({
    defaultValues,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      setConflict(null)
      const parsed = schema.parse(value)
      const switchOn = isSwitchOn(base.mode, parsed.mode)
      const body: ChangeMaintenanceModeBody = {
        mode: parsed.mode,
        message: parsed.message,
        expectedVersion: base.version,
        ...reasonField(parsed.reason, prefilledReason),
        ...(switchOn ? { confirm: parsed.confirmation.trim() } : {}),
      }
      onBusyChange(true)
      try {
        const next = await stepUp.run(() => change.mutateAsync(body))
        onBusyChange(false)
        // express answers a change that stores nothing with the current state, its version unchanged.
        if (next.version === base.version) toast.warning(NOTHING_CHANGED)
        else {
          toast.success(
            next.mode === base.mode
              ? 'Customer message saved.'
              : `Maintenance is now ${MAINTENANCE_MODE_LABELS[next.mode].toLowerCase()}.`
          )
        }
        onOpenChange(false)
      } catch (error) {
        onBusyChange(false)
        if (isReauthRequired(error)) {
          serverErrors.setFormErrors([STEP_UP_DISMISSED])
          return
        }
        if (isMaintenanceModeConflict(error)) {
          // A failed re-read keeps `base`: a resubmit conflicts again rather than overwriting a change nobody has seen.
          if (error.fresh === null) {
            setConflict(MAINTENANCE_CONFLICT_UNREAD)
            return
          }
          const fresh = error.fresh
          // Its own alert, not FormError: the sentence names a person, so it renders inside Pii.
          setConflict(conflictSentence(fresh))
          // An untouched pre-filled reason follows the fresh state: the other owner's reason, or empty once the edit became a switch-on (its field is required and the "starts as the reason now saved" hint is gone).
          const freshPrefill = isSwitchOn(fresh.mode, form.state.values.mode)
            ? ''
            : (fresh.reason ?? '')
          if (form.state.values.reason === prefilledReason) {
            form.setFieldValue('reason', freshPrefill)
          }
          setPrefilledReason(freshPrefill)
          setBase({ mode: fresh.mode, version: fresh.version })
          return
        }
        if (codeFrom(error) === CONFIRMATION_MISMATCH) {
          serverErrors.setFieldError('confirmation', [messageFrom(error)])
          return
        }
        if (statusFrom(error) === 404) {
          serverErrors.setFormErrors([ROLE_DENIED_ACTION])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titleFor(base.mode, modes)}</DialogTitle>
        <DialogDescription>
          Every other platform owner and admin is told when maintenance is switched on or off.
        </DialogDescription>
      </DialogHeader>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        {modes.length > 1 && (
          <form.Field name="mode">
            {(field) => (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Mode</legend>
                {modes.map((mode) => (
                  <label key={mode} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="mode"
                      value={mode}
                      checked={field.state.value === mode}
                      onChange={() => field.handleChange(mode)}
                      className="mt-0.5 accent-primary"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{MAINTENANCE_MODE_LABELS[mode]}</span>
                      <span className="text-muted-foreground">{MODE_HINTS[mode]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </form.Field>
        )}
        {modes.length === 1 && modes[0] !== undefined && (
          <p className="text-sm text-muted-foreground">{MODE_HINTS[modes[0]]}</p>
        )}
        <FormField form={form} name="message">
          {(field) => (
            <FormItem>
              <FormLabel>Message for customers</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormDescription>Plain text, shown to every customer.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <form.Subscribe selector={(state) => [state.values.mode, state.values.message] as const}>
          {([mode, message]) => <MaintenancePreview mode={mode} message={message} />}
        </form.Subscribe>
        <form.Subscribe selector={(state) => isSwitchOn(base.mode, state.values.mode)}>
          {(switchOn) => (
            <>
              <FormField form={form} name="reason">
                {(field) => (
                  <FormItem>
                    <FormLabel>{switchOn ? 'Reason' : 'Reason (optional)'}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        value={fieldValue(field.state.value)}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {switchOn
                        ? 'For staff only. Recorded in the audit log with your name.'
                        : 'For staff only. Recorded in the audit log with your name. It starts as the reason now saved. Empty it to clear that reason.'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              </FormField>
              {switchOn && (
                <FormField form={form} name="confirmation">
                  {(field) => (
                    <FormItem>
                      <FormLabel>
                        Type <code className="font-mono">{view.environment}</code> to confirm
                      </FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="off"
                          value={fieldValue(field.state.value)}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                </FormField>
              )}
            </>
          )}
        </form.Subscribe>
        {conflict !== null && (
          <p role="alert" className="text-sm text-destructive">
            <Pii>{conflict}</Pii>
          </p>
        )}
        <FormError />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <form.Subscribe selector={(state) => [state.isSubmitting, state.values.mode] as const}>
            {([isSubmitting, mode]) => (
              <Button
                type="submit"
                variant={isSwitchOn(base.mode, mode) ? 'destructive' : 'default'}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Working…' : submitLabel(base.mode, mode)}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </Form>
    </>
  )
}

/**
 * The body's `reason`: what the field holds, `null` when the owner emptied a
 * pre-filled reason (express clears the stored one), or nothing when there
 * was none to empty.
 * @param reason - The parsed field, trimmed.
 * @param prefilled - The reason the field started from.
 * @returns The fields to spread into the body.
 */
function reasonField(reason: string, prefilled: string): Pick<ChangeMaintenanceModeBody, 'reason'> {
  if (reason !== '') return { reason }
  return prefilled === '' ? {} : { reason: null }
}

/** The submit button's words for a change from `from` to `to`. */
function submitLabel(from: PlatformMaintenanceModeView['mode'], to: OnMode): string {
  if (from === to) return 'Save message'
  return `Switch to ${MAINTENANCE_MODE_LABELS[to].toLowerCase()}`
}
