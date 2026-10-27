import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { Pii } from '@/components/shared/pii'
import { QueryState } from '@/components/shared/query-state'
import { FormFieldsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { billingDate } from '@/constants/billing-labels'
import { useChangedFields } from '@/hooks/use-changed-fields'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useStepUp } from '@/hooks/use-step-up'
import { codeFrom, fieldErrorsFrom, statusFrom } from '@/lib/api-error'
import { refuseInForm } from '@/lib/billing-refusal'
import { countOf } from '@/lib/plural'
import { toast } from '@/lib/toast'
import { useUpdateBillingSettings } from '@/queries/billing-admin.queries'
import { billingAdminKeys, billingSettingsQueryOptions } from '@/queries/billing-reads.queries'
import {
  billingSettingsForm,
  billingSettingsFormSchema,
  type BillingSettingsForm,
} from '@/schemas/billing.schemas'
import { REASON_REQUIRED } from '@/types/api.types'
import { PLAN_VERSION_CONFLICT, type BillingSettings } from '@/types/billing.types'

/** What an unchanged save says: express's refine, word for word. */
const UNCHANGED = 'Change at least one setting: trials, the trial length or the grace period.'

/** What a save says once another staff member's settings are loaded into the form. */
const CONFLICT =
  'Another staff member changed the billing settings. We loaded their values and kept what you typed. Review and save again.'

/** What a save says while another staff member's settings have not loaded. */
const CONFLICT_UNLOADED =
  'Another staff member changed the billing settings, and their values didn’t load. Select Try again, then save again.'

/** The grace field's label, which the read-only view shares. */
const GRACE_LABEL = 'Days to keep Paid after the last failed payment'

/**
 * A field's value as the API reads it: the days parsed to a whole number,
 * or undefined when they don't parse. `useChangedFields` diffs the text, so
 * a typed `014` differs from a stored `14`; comparing parsed values doesn't.
 * @param name - The field.
 * @param value - Its value as the form holds it.
 */
function parsedField(name: keyof BillingSettingsForm, value: unknown): unknown {
  const result = billingSettingsFormSchema.shape[name].safeParse(value)
  return result.success ? result.data : undefined
}

/**
 * The save dialog's description, from what the save changes: the trial
 * rules apply to new trials, and the grace to every past-due tenant now.
 * @param body - The changed settings.
 */
function saveDescription(body: SettingsBody): string {
  const trials =
    body.trialEnabled !== undefined || body.trialDays !== undefined
      ? 'New trials use these rules. Trials already running keep their end dates.'
      : null
  const grace =
    body.pastDueGraceDays === undefined
      ? null
      : 'The new grace applies now to every tenant with a failed payment.'
  return [trials, grace].filter((line) => line !== null).join(' ')
}

/** The settings' version and values a save diffs against and sends back. */
type SettingsBody = Partial<
  Pick<BillingSettings, 'trialEnabled' | 'trialDays' | 'pastDueGraceDays'>
> & {
  version: number
}

/**
 * The platform's trial and grace rules, on the Plans page. Every staff role
 * reads them (express's `GET /platform/billing-settings` is a viewer route);
 * only an admin and up edits them, since the PATCH is admin. Below admin the
 * card is text, with no controls at all.
 */
export function BillingSettingsCard({ canEdit }: { canEdit: boolean }) {
  const headingId = useId()
  const settings = useQuery(billingSettingsQueryOptions())
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle>
          <h2 id={headingId}>Trials and grace</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState
          query={settings}
          name="Trials and grace"
          errorMessage="We couldn’t load the billing settings. Select Try again."
          skeleton={<FormFieldsSkeleton fields={3} action={canEdit} />}
        >
          {(data) => (
            <>
              {canEdit ? <SettingsEditor settings={data} /> : <SettingsSummary settings={data} />}
              <LastChanged settings={data} />
            </>
          )}
        </QueryState>
      </CardContent>
    </Card>
  )
}

/** The settings as text, for staff below admin. */
function SettingsSummary({ settings }: { settings: BillingSettings }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Paid trial for new tenants</dt>
      <dd>{settings.trialEnabled ? 'On' : 'Off'}</dd>
      <dt className="text-muted-foreground">Trial length</dt>
      <dd>{countOf(settings.trialDays, 'days')}</dd>
      <dt className="text-muted-foreground">{GRACE_LABEL}</dt>
      <dd>{countOf(settings.pastDueGraceDays, 'days')}</dd>
    </dl>
  )
}

/**
 * Who changed the settings last, and when, the date written as the prices
 * table beside it writes one ("20 October 2026", in the reader's zone, since
 * no one tenant owns the settings). Express sends no editor before the first
 * staff edit (version 1), or once the editor's account is gone. A date that
 * doesn't parse is left out rather than guessed.
 */
function LastChanged({ settings }: { settings: BillingSettings }) {
  const on = Number.isNaN(Date.parse(settings.updatedAt))
    ? ''
    : ` on ${billingDate(settings.updatedAt, undefined)}`
  return (
    <p className="text-xs text-muted-foreground">
      {settings.updatedBy !== null ? (
        <>
          Last changed by <Pii>{settings.updatedBy.name}</Pii>
          {on}.
        </>
      ) : settings.version === 1 ? (
        'Never changed.'
      ) : (
        `Last changed${on}.`
      )}
    </p>
  )
}

/**
 * The admin's editor. Only what changed is sent, through `useChangedFields`,
 * with the version read when the form was first touched, so a refetch
 * neither moves the baseline nor sends another staff member's values back.
 * Save opens one reason dialog, then step-up, then the PATCH.
 *
 * When another staff member saved first (409 `PLAN_VERSION_CONFLICT`), the
 * settings reload, each field this reader left alone takes the saved value,
 * each field they typed in keeps it, and the baseline and version move to
 * the saved settings. If the reload fails, the card says so and saves
 * nothing until a later Save finds the settings loaded.
 */
function SettingsEditor({ settings }: { settings: BillingSettings }) {
  const queryClient = useQueryClient()
  const update = useUpdateBillingSettings()
  const stepUp = useStepUp()
  const serverErrors = useServerErrors()
  const trialLabelId = useId()
  const changes = useChangedFields(
    billingSettingsFormSchema,
    billingSettingsForm(settings),
    serverErrors,
    UNCHANGED
  )
  const [heldVersion, holdVersion] = useState<number | null>(null)
  const version = heldVersion ?? settings.version
  const [pending, setPending] = useState<SettingsBody | null>(null)
  const [awaitingReload, setAwaitingReload] = useState(false)
  /** Holds the version at the first edit, as `useChangedFields` holds its baseline. */
  const freeze = () => {
    holdVersion((current) => current ?? settings.version)
  }

  const form = useForm({
    defaultValues: changes.baseline,
    validators: { onSubmit: changes.changes },
    listeners: {
      onChange: () => {
        changes.listeners.onChange()
        freeze()
      },
      onBlur: () => {
        changes.listeners.onBlur()
        freeze()
      },
      onSubmit: () => {
        changes.listeners.onSubmit()
        freeze()
      },
    },
    onSubmit: ({ value }) => {
      if (awaitingReload) {
        loadTheirs()
        return
      }
      const changedText = changes.changedBody(value)
      if (changedText === null) return
      // Only a field whose number differs from the stored one is a change: a typed 014 is the stored 14.
      const changed = Object.fromEntries(
        Object.entries(changedText).filter(
          ([name, parsed]) =>
            !Object.is(
              parsed,
              parsedField(
                name as keyof BillingSettingsForm,
                changes.baseline[name as keyof BillingSettingsForm]
              )
            )
        )
      ) as typeof changedText
      serverErrors.reset()
      if (Object.keys(changed).length === 0) {
        serverErrors.setFormErrors([UNCHANGED])
        return
      }
      setPending({ version, ...changed })
    },
  })

  /**
   * Moves the form onto the settings another staff member saved, keeping
   * what this reader typed, once those settings have loaded; until then,
   * says they didn't load.
   */
  function loadTheirs() {
    const state = queryClient.getQueryState<BillingSettings>(billingAdminKeys.settings)
    const fresh = state?.data
    if (state?.status !== 'success' || fresh === undefined) {
      setAwaitingReload(true)
      serverErrors.setFormErrors([CONFLICT_UNLOADED])
      return
    }
    const loaded = changes.baseline
    const freshForm = billingSettingsForm(fresh)
    for (const name of Object.keys(freshForm) as Array<keyof BillingSettingsForm>) {
      const now = form.state.values[name]
      const leftAlone = Object.is(parsedField(name, now), parsedField(name, loaded[name]))
      if (leftAlone && !Object.is(now, freshForm[name])) form.setFieldValue(name, freshForm[name])
    }
    changes.rebase(freshForm)
    holdVersion(fresh.version)
    setAwaitingReload(false)
    serverErrors.setFormErrors([CONFLICT])
  }

  /**
   * Saves the confirmed body with its reason, behind step-up. A conflict or
   * a field the API refused shows on the card and closes the dialog; any
   * other refusal rejects, so the dialog shows it.
   */
  async function save(body: SettingsBody, reason: string) {
    try {
      const saved = await stepUp.run(() => update.mutateAsync({ ...body, reason }))
      toast.success('Billing settings saved.')
      changes.rebase(null)
      holdVersion(null)
      form.reset(billingSettingsForm(saved))
    } catch (error) {
      if (codeFrom(error) === PLAN_VERSION_CONFLICT) {
        loadTheirs()
        return
      }
      const fields = Object.keys(fieldErrorsFrom(error)).filter((name) => name !== 'reason')
      if (statusFrom(error) === 400 && codeFrom(error) !== REASON_REQUIRED && fields.length > 0) {
        refuseInForm(serverErrors, error)
        return
      }
      throw error
    }
  }

  return (
    <>
      <Form form={form} serverErrors={serverErrors} className="mb-4 grid gap-4">
        <FormField form={form} name="trialEnabled">
          {(field) => (
            <FormItem>
              <div className="flex items-center gap-3">
                <FormLabel id={trialLabelId}>Give new tenants a Paid trial</FormLabel>
                <FormControl>
                  <Switch
                    aria-labelledby={trialLabelId}
                    checked={field.state.value === true}
                    onCheckedChange={(checked: boolean) => {
                      field.handleChange(checked)
                      // Base UI's switch raises no native change on the form, so its server error is cleared here.
                      serverErrors.clearField('trialEnabled')
                    }}
                  />
                </FormControl>
                <span className="text-sm text-muted-foreground" aria-hidden="true">
                  {field.state.value === true ? 'On' : 'Off'}
                </span>
              </div>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormField form={form} name="trialDays">
          {(field) => (
            <FormItem>
              <FormLabel>Trial length (days)</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-32"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormField form={form} name="pastDueGraceDays">
          {(field) => (
            <FormItem>
              <FormLabel>{GRACE_LABEL}</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-32"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormError />
        <div>
          <Button type="submit">Save billing settings</Button>
        </div>
      </Form>
      <ReasonDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title="Save billing settings?"
        description={pending === null ? '' : saveDescription(pending)}
        confirmLabel="Save"
        onConfirm={async (reason) => {
          if (pending !== null) await save(pending, reason)
        }}
      />
    </>
  )
}
