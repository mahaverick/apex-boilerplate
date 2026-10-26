import { useForm, useStore } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { PlanChangeConfirmDialog } from '@/components/features/billing/plan-change-confirm-dialog'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { BusyButton } from '@/components/shared/busy-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useChangedFields } from '@/hooks/use-changed-fields'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors, type ServerErrors } from '@/hooks/use-server-errors'
import { useStepUp } from '@/hooks/use-step-up'
import { codeFrom, fieldErrorsFrom, formErrorsFrom, statusFrom } from '@/lib/api-error'
import { refuseInForm } from '@/lib/billing-refusal'
import {
  detailsSentence,
  entitlementErrorFields,
  entitlementText,
  fieldsAfterConflict,
  planCountsLine,
  tenantsOnPlan,
} from '@/lib/plan-editor'
import { toast } from '@/lib/toast'
import { usePreviewPlanChange, useUpdatePlan } from '@/queries/billing-admin.queries'
import { billingAdminKeys } from '@/queries/billing-reads.queries'
import {
  planDetailsSchema,
  planEditForm,
  planEditSchema,
  planEntitlementChanges,
  type PlanEditForm,
} from '@/schemas/billing.schemas'
import { REASON_REQUIRED } from '@/types/api.types'
import {
  PLAN_VERSION_CONFLICT,
  type EntitlementCatalogEntry,
  type EntitlementValue,
  type PlanChangePreview,
  type StaffPlan,
  type StaffPlans,
} from '@/types/billing.types'

/** What an unchanged save says. */
const UNCHANGED = 'Change a field before saving.'

/** What a save says once another staff member's plan is loaded into the form. */
const CONFLICT =
  'Another staff member changed this plan. We loaded their values and kept what you typed. Review and save again.'

/** What a save says while another staff member's plan has not loaded. */
const CONFLICT_UNLOADED =
  'Another staff member changed this plan, and their values didn’t load. Select Try again, then save again.'

/**
 * One plan's card: its name, description, the tenants it serves and every
 * catalog entitlement. An admin edits it; below admin it reads as text, with
 * no controls at all.
 */
export function PlanEditorCard({
  plan,
  catalog,
  canEdit,
}: {
  plan: StaffPlan
  catalog: readonly EntitlementCatalogEntry[]
  canEdit: boolean
}) {
  const headingId = useId()
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle>
          <h2 id={headingId}>{plan.name}</h2>
        </CardTitle>
        <CardDescription>{planCountsLine(plan)}</CardDescription>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <PlanEditor plan={plan} catalog={catalog} />
        ) : (
          <PlanSummary plan={plan} catalog={catalog} />
        )}
      </CardContent>
    </Card>
  )
}

/** A plan as text, for staff below admin. */
function PlanSummary({
  plan,
  catalog,
}: {
  plan: StaffPlan
  catalog: readonly EntitlementCatalogEntry[]
}) {
  return (
    <div className="grid gap-4">
      {plan.description !== '' && <p className="text-sm">{plan.description}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {catalog.map((entry) => (
          <div key={entry.key} className="contents">
            <dt className="text-muted-foreground">{entry.label}</dt>
            <dd>{entitlementText(plan.entitlements[entry.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** The values a save sends besides the reason. */
interface PlanSaveBody {
  version: number
  name?: string
  description?: string
  entitlements?: Record<string, EntitlementValue>
}

/** Which confirmation is open, with the body it saves. */
type PlanConfirm =
  | { kind: 'details'; body: PlanSaveBody }
  | { kind: 'entitlements'; body: PlanSaveBody; preview: PlanChangePreview }

/** The plan's stored entitlements and version, which an edit diffs against and sends back. */
interface EntitlementBaseline {
  version: number
  entitlements: Record<string, EntitlementValue>
}

/**
 * The admin's editor. Only what changed is sent: the name and description
 * through `useChangedFields`, the entitlements through a diff of their own,
 * since the hook compares top-level fields only. Both baselines are the
 * stored plan until the first edit, then held, so a refetch neither moves
 * them nor sends another staff member's values back.
 *
 * A save with changed entitlements is previewed first. Any decrease opens
 * the lower-limits dialog, which names the tenants on the plan and needs a
 * second confirm; anything else opens one reason dialog. Then step-up, then
 * the PATCH with the version read. When another staff member saved first
 * (409 `PLAN_VERSION_CONFLICT`), the plans reload, each field this reader
 * left alone takes the saved value, each field they typed in keeps it, and
 * the baselines move to the saved plan, so the next save re-previews against
 * it. If the reload fails, the card says so and saves nothing until a later
 * Save finds the plans loaded.
 */
function PlanEditor({
  plan,
  catalog,
}: {
  plan: StaffPlan
  catalog: readonly EntitlementCatalogEntry[]
}) {
  const queryClient = useQueryClient()
  const preview = usePreviewPlanChange(plan.id)
  const update = useUpdatePlan(plan.id)
  const stepUp = useStepUp()
  const serverErrors = useServerErrors()
  const [confirm, setConfirm] = useState<PlanConfirm | null>(null)
  const details = useChangedFields(
    planDetailsSchema,
    { name: plan.name, description: plan.description },
    serverErrors,
    UNCHANGED
  )
  const [heldEntitlements, holdEntitlements] = useState<EntitlementBaseline | null>(null)
  const [awaitingReload, setAwaitingReload] = useState(false)
  const entitlementBaseline = heldEntitlements ?? {
    version: plan.version,
    entitlements: plan.entitlements,
  }
  /** Holds the entitlements baseline at the first edit, as `useChangedFields` holds its own. */
  const freeze = () => {
    holdEntitlements((current) => current ?? entitlementBaseline)
  }
  const loadedForm = useMemo(
    () =>
      planEditForm(
        { ...details.baseline, entitlements: entitlementBaseline.entitlements },
        catalog
      ),
    [details.baseline, entitlementBaseline.entitlements, catalog]
  )
  const entitlementChanges = planEntitlementChanges(catalog, entitlementBaseline.entitlements)

  const form = useForm({
    defaultValues: loadedForm,
    validators: { onSubmit: planEditSchema(details.changes, entitlementChanges) },
    listeners: {
      onChange: () => {
        details.listeners.onChange()
        freeze()
      },
      onBlur: () => {
        details.listeners.onBlur()
        freeze()
      },
      onSubmit: () => {
        details.listeners.onSubmit()
        freeze()
      },
    },
    onSubmit: async ({ value }) => {
      if (awaitingReload) {
        rebaseOnConflict()
        return
      }
      const changedDetails = details.changes.parse(value)
      const entitlements = entitlementChanges.parse(value)
      const hasEntitlements = Object.keys(entitlements).length > 0
      serverErrors.reset()
      if (!hasEntitlements && Object.keys(changedDetails).length === 0) {
        serverErrors.setFormErrors([UNCHANGED])
        return
      }
      const body: PlanSaveBody = {
        version: entitlementBaseline.version,
        ...changedDetails,
        ...(hasEntitlements && { entitlements }),
      }
      if (!hasEntitlements) {
        setConfirm({ kind: 'details', body })
        return
      }
      try {
        setConfirm({ kind: 'entitlements', body, preview: await preview.mutateAsync(entitlements) })
      } catch (error) {
        showRefusal(serverErrors, error, catalog)
      }
    },
  })

  /**
   * Moves the form onto the plan another staff member just saved, keeping
   * what this reader typed, once the plans have reloaded. Until then (the
   * reload failed, and the page shows its Try again), it says their values
   * didn't load, and each Save checks again instead of saving.
   */
  function rebaseOnConflict() {
    const state = queryClient.getQueryState<StaffPlans>(billingAdminKeys.plans)
    const fresh = state?.data?.plans.find((candidate) => candidate.id === plan.id)
    if (state?.status !== 'success' || fresh === undefined) {
      setAwaitingReload(true)
      serverErrors.setFormErrors([CONFLICT_UNLOADED])
      return
    }
    const freshForm = planEditForm(fresh, catalog)
    for (const [name, value] of fieldsAfterConflict(form.state.values, loadedForm, freshForm)) {
      form.setFieldValue(name as keyof PlanEditForm, value as never)
    }
    details.rebase({ name: fresh.name, description: fresh.description })
    holdEntitlements({ version: fresh.version, entitlements: fresh.entitlements })
    setAwaitingReload(false)
    serverErrors.setFormErrors([CONFLICT])
  }

  /**
   * Saves the confirmed body with its reason, behind step-up. A conflict or
   * a field the API refused shows on the card and closes the dialog; any
   * other refusal rejects, so the dialog shows it.
   */
  async function save(body: PlanSaveBody, reason: string) {
    try {
      const saved = await stepUp.run(() => update.mutateAsync({ ...body, reason }))
      toast.success(`${saved.name} saved.`)
      details.rebase(null)
      holdEntitlements(null)
      form.reset(planEditForm(saved, catalog))
    } catch (error) {
      if (codeFrom(error) === PLAN_VERSION_CONFLICT) {
        rebaseOnConflict()
        return
      }
      const fields = Object.keys(fieldErrorsFrom(error)).filter((name) => name !== 'reason')
      if (statusFrom(error) === 400 && codeFrom(error) !== REASON_REQUIRED && fields.length > 0) {
        showRefusal(serverErrors, error, catalog)
        return
      }
      throw error
    }
  }

  const noLimit = useStore(form.store, (state) => state.values.noLimit)
  const features = useStore(form.store, (state) => state.values.features)
  const lowers = confirm?.kind === 'entitlements' && hasDecrease(confirm.preview)

  return (
    <>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        <FormField form={form} name="name">
          {(field) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
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
        <FormField form={form} name="description">
          {(field) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormDescription>Shown on the pricing page.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        {catalog.map((entry) =>
          entry.kind === 'limit' ? (
            <div key={entry.key} className="grid gap-2">
              <FormField form={form} name={`limits.${entry.key}`}>
                {(field) => (
                  <FormItem>
                    <FormLabel>{entry.label}</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        autoComplete="off"
                        className="w-32"
                        disabled={noLimit[entry.key] === true}
                        value={fieldValue(field.state.value)}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </FormControl>
                    <FormDescription>{entry.description}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              </FormField>
              <FormField form={form} name={`noLimit.${entry.key}`}>
                {(field) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.state.value === true}
                      onCheckedChange={(checked: boolean) => {
                        field.handleChange(checked === true)
                        // Base UI's checkbox raises no native change on the form, so the limit's server error is cleared here.
                        serverErrors.clearField(`limits.${entry.key}`)
                      }}
                    />
                    No limit
                  </label>
                )}
              </FormField>
            </div>
          ) : (
            <FeatureSwitch
              key={entry.key}
              form={form}
              entry={entry}
              on={features[entry.key] === true}
              serverErrors={serverErrors}
            />
          )
        )}
        <FormError />
        <div>
          <BusyButton busy={preview.isPending} busyLabel="Checking…" type="submit">
            Save {plan.name}
          </BusyButton>
        </div>
      </Form>
      <ReasonDialog
        open={confirm !== null && !lowers}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={`Save ${plan.name}?`}
        description={
          confirm?.kind === 'entitlements'
            ? [
                `${tenantsOnPlan(confirm.preview, plan.name)}. The changes apply to them now.`,
                detailsSentence(confirm.body, plan.name),
              ]
                .filter((sentence) => sentence !== null)
                .join(' ')
            : (detailsSentence(confirm?.body ?? {}, plan.name) ?? '')
        }
        confirmLabel="Save"
        onConfirm={async (reason) => {
          if (confirm !== null) await save(confirm.body, reason)
        }}
      />
      {confirm?.kind === 'entitlements' && (
        <PlanChangeConfirmDialog
          open={lowers}
          onOpenChange={(open) => {
            if (!open) setConfirm(null)
          }}
          planName={plan.name}
          alsoChanged={detailsSentence(confirm.body, plan.name)}
          preview={confirm.preview}
          catalog={catalog}
          onConfirm={(reason) => save(confirm.body, reason)}
        />
      )}
    </>
  )
}

/** The plan editor's form, as `FeatureSwitch` reads it. */
type PlanForm = Parameters<typeof FormField>[0]['form']

/**
 * One feature's switch, labelled by the catalog's label. Base UI's switch
 * raises no native change on the form, so its change clears its own server
 * error.
 */
function FeatureSwitch({
  form,
  entry,
  on,
  serverErrors,
}: {
  form: PlanForm
  entry: EntitlementCatalogEntry
  on: boolean
  serverErrors: ServerErrors
}) {
  const labelId = useId()
  const name = `features.${entry.key}`
  return (
    <FormField form={form} name={name}>
      {(field) => (
        <FormItem>
          <div className="flex items-center gap-3">
            <FormLabel id={labelId}>{entry.label}</FormLabel>
            <FormControl>
              <Switch
                aria-labelledby={labelId}
                checked={field.state.value === true}
                onCheckedChange={(checked: boolean) => {
                  field.handleChange(checked)
                  serverErrors.clearField(name)
                }}
              />
            </FormControl>
            <span className="text-sm text-muted-foreground" aria-hidden="true">
              {on ? 'On' : 'Off'}
            </span>
          </div>
          <FormDescription>{entry.description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    </FormField>
  )
}

/**
 * Whether a preview lowers anything: a smaller limit, a limit where there
 * was none, or a feature turned off.
 * @param preview - The preview.
 */
function hasDecrease(preview: PlanChangePreview): boolean {
  return preview.changes.some((change) => change.direction === 'decrease')
}

/**
 * Shows a refused preview or save on the card, as `refuseInForm` does, with
 * express's entitlement messages moved onto their entries' fields: express
 * reports them all under `entitlements`.
 * @param serverErrors - The card's server errors.
 * @param error - The refusal.
 * @param catalog - The entitlements this product has.
 */
function showRefusal(
  serverErrors: ServerErrors,
  error: unknown,
  catalog: readonly EntitlementCatalogEntry[]
) {
  refuseInForm(serverErrors, error)
  const messages = fieldErrorsFrom(error).entitlements
  if (messages === undefined) return
  const { fields, unplaced } = entitlementErrorFields(messages, catalog)
  serverErrors.clearField('entitlements')
  for (const [name, fieldMessages] of Object.entries(fields)) {
    serverErrors.setFieldError(name, fieldMessages)
  }
  if (unplaced.length > 0) serverErrors.setFormErrors([...formErrorsFrom(error), ...unplaced])
}
