import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
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
  MAINTENANCE_MODE_LABELS,
} from '@/constants/maintenance-mode.constants'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useStepUp } from '@/hooks/use-step-up'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { conflictSentence, isSwitchOn } from '@/lib/maintenance-mode'
import { isReauthRequired } from '@/lib/step-up'
import {
  isMaintenanceModeConflict,
  maintenanceModeKeys,
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
 * not a switch-on starts with the reason now saved in the Reason field.
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
        <DialogHeader>
          <DialogTitle>{titleFor(props.view.mode, props.modes)}</DialogTitle>
          <DialogDescription>
            Every other platform owner and admin is told when maintenance is switched on or off.
          </DialogDescription>
        </DialogHeader>
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
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const change = useChangeMaintenanceMode()
  const serverErrors = useServerErrors()
  const [conflict, setConflict] = useState<string | null>(null)
  // What this form was opened on; only a 409's fresh read replaces it, never a poll in between.
  const [base, setBase] = useState({ mode: view.mode, version: view.version })
  const schema = useMemo(
    () => maintenanceModeFormSchema(view.mode, view.environment),
    [view.mode, view.environment]
  )
  const defaultValues: MaintenanceModeFormValues = {
    mode: modes[0] ?? 'read_only',
    message: view.message ?? '',
    // A change that is not a switch-on keeps the saved reason unless the owner edits it.
    reason: isSwitchOn(view.mode, modes[0] ?? 'read_only') ? '' : (view.reason ?? ''),
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
        ...(parsed.reason === '' ? {} : { reason: parsed.reason }),
        ...(switchOn ? { confirm: parsed.confirmation.trim() } : {}),
      }
      onBusyChange(true)
      try {
        const next = await stepUp.run(() => change.mutateAsync(body))
        onBusyChange(false)
        toast.success(
          next.mode === base.mode
            ? 'Customer message saved.'
            : `Maintenance is now ${MAINTENANCE_MODE_LABELS[next.mode].toLowerCase()}.`
        )
        onOpenChange(false)
      } catch (error) {
        onBusyChange(false)
        if (isReauthRequired(error)) {
          serverErrors.setFormErrors([STEP_UP_DISMISSED])
          return
        }
        if (isMaintenanceModeConflict(error)) {
          const fresh =
            queryClient.getQueryData<PlatformMaintenanceModeView>(maintenanceModeKeys.view) ?? view
          // Its own alert, not FormError: the sentence names a person, so it renders inside Pii.
          setConflict(conflictSentence(fresh))
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
      <form.Subscribe selector={(state) => isSwitchOn(view.mode, state.values.mode)}>
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
                      : 'For staff only. Recorded in the audit log with your name. It starts as the reason now saved.'}
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
        <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => [state.isSubmitting, state.values.mode] as const}>
          {([isSubmitting, mode]) => (
            <Button
              type="submit"
              variant={isSwitchOn(view.mode, mode) ? 'destructive' : 'default'}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Working…' : submitLabel(view.mode, mode)}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </Form>
  )
}

/** The submit button's words for a change from `from` to `to`. */
function submitLabel(from: PlatformMaintenanceModeView['mode'], to: OnMode): string {
  if (from === to) return 'Save message'
  return `Switch to ${MAINTENANCE_MODE_LABELS[to].toLowerCase()}`
}
