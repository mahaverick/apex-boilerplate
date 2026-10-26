import { useForm } from '@tanstack/react-form'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  canActorGrantRole,
  platformRoleAtLeast,
  DEFAULT_MEMBER_ROLE,
  MEMBERSHIP_ROLES,
  ROLE_LABELS,
  type MembershipRole,
} from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom, fieldErrorsFrom } from '@/lib/api-error'
import { formatCount } from '@/lib/format'
import { planRefusalFrom, type PlanRefusal } from '@/lib/plan-refusal'
import { nounFor } from '@/lib/plural'
import { staffMessageFrom } from '@/lib/staff-message'
import { isPlatformTenant } from '@/lib/staff-team'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { toast } from '@/lib/toast'
import { billingAdminKeys, staffPlansQueryOptions } from '@/queries/billing-reads.queries'
import { platformTenantQueryOptions, tenantAdminKeys } from '@/queries/tenant-admin.queries'
import { useInviteMember } from '@/queries/tenant-writes.queries'
import { inviteMemberSchema, type InviteMemberInput } from '@/schemas/tenant.schemas'
import { useAuthStore } from '@/states/auth.store'
import { ALREADY_MEMBER, INVITATION_CONFLICT, type PlatformTenantRow } from '@/types/api.types'
import type { StaffTenantBilling } from '@/types/billing.types'
import type { ListPage } from '@/types/list.types'

/** A 409 `invitation_conflict`: another invite for this address just won the race. */
const RACED =
  'Someone else invited this address first. Their invitation is under Pending invitations.'

/**
 * The plan a tenant is on, from data already cached, never from its billing
 * read, which express audits as staff viewing the tenant's billing: the
 * billing view if the Billing tab cached it, else the tenant's row in a
 * cached Tenants list and that plan's name from the staff plans (a viewer
 * read with no per-tenant audit). Undefined when neither is cached.
 * @param queryClient - The app's query client.
 * @param tenantId - The tenant's id.
 */
async function cachedPlanName(
  queryClient: QueryClient,
  tenantId: string
): Promise<string | undefined> {
  const billing = queryClient.getQueryData<StaffTenantBilling>(billingAdminKeys.tenant(tenantId))
  if (billing !== undefined) return billing.plan.name
  const planKey = queryClient
    .getQueriesData<ListPage<PlatformTenantRow>>({ queryKey: tenantAdminKeys.all })
    .flatMap(([, page]) => (Array.isArray(page?.items) ? page.items : []))
    // Another list under the prefix may hold this tenant's row without a plan; only a row with one counts.
    .find((row) => row.id === tenantId && row.planKey != null)?.planKey
  if (planKey === undefined || planKey === null) return undefined
  const plans = await queryClient.fetchQuery(staffPlansQueryOptions()).catch(() => undefined)
  return plans?.plans.find((plan) => plan.key === planKey)?.name
}

/**
 * The staff wording for a tenant at its members limit. The API's own
 * sentence tells the customer to upgrade, which staff can't do for them;
 * the next step is a Members grant, which needs a platform manager, so
 * anyone below asks one. The tenant's name comes from its cached detail and
 * the plan from `cachedPlanName`; either missing leaves its words out.
 * @param queryClient - The app's query client.
 * @param tenantId - The tenant's id.
 * @param refusal - The 402's usage.
 * @param canGrant - Whether the reader may add a grant (platform manager and up).
 */
async function membersLimitSentence(
  queryClient: QueryClient,
  tenantId: string,
  refusal: Extract<PlanRefusal, { kind: 'limit' }>,
  canGrant: boolean
): Promise<string> {
  const tenant = queryClient.getQueryData(platformTenantQueryOptions(tenantId).queryKey)
  const plan = await cachedPlanName(queryClient, tenantId)
  const usage = `${tenant?.name ?? 'This tenant'} has ${formatCount(refusal.used)} of ${formatCount(refusal.limit)} ${nounFor(refusal.limit, 'members')}${plan === undefined ? '' : ` on ${plan}`}.`
  const next = canGrant
    ? 'Add a Members grant on its Billing tab to invite more.'
    : 'Ask a platform manager to add a Members grant on its Billing tab.'
  return `Not sent. ${usage} ${next}`
}

/**
 * Invite someone by email. Shown to owners and admins (`canManageTenant`); the
 * roles offered come from `canActorGrantRole`, so an admin cannot invite an
 * admin or owner.
 *
 * `already_member` goes on the email field alone, and `invitation_conflict`
 * at form level (the list refetches, so the winning invite shows below).
 * The role select clears its own server error, since Base UI's selection does
 * not bubble a change event to the form; `FormControl`'s id lands on the
 * visible trigger, so the label points at something a pointer can reach.
 *
 * Staff acting through platform access (`asStaff`) give the audited reason
 * the API requires in the reason dialog after the form validates. A refusal
 * about the address or the role (`already_member`, a field error) closes the
 * dialog and shows on that field, as it does for a member, with focus on it;
 * any other shows in the dialog, a racing invite with `RACED`.
 *
 * On an Apex tenant page (`tenantId`), a tenant at its members limit (402
 * `PLAN_LIMIT_REACHED`) closes the dialog and says so at form level in
 * staff words, with an "Open Billing" link that takes focus.
 */
export function InviteMemberForm({
  slug,
  myRole,
  asStaff = false,
  tenantId,
  submitLabel = 'Invite member',
}: {
  slug: string
  myRole: MembershipRole
  /** Acting through platform access: the send asks for a reason first. */
  asStaff?: boolean
  tenantId?: string
  /** The submit button's text: "Invite staff" on the Staff page. */
  submitLabel?: string
}) {
  const inviteMember = useInviteMember(slug, tenantId)
  const queryClient = useQueryClient()
  /** Set while the form shows a members-limit refusal, which carries the Billing link. */
  const [full, setFull] = useState(false)
  const billingLink = useRef<HTMLAnchorElement>(null)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const serverErrors = useServerErrors()
  const [toConfirm, setToConfirm] = useState<InviteMemberInput | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  /** Set when the reason dialog closed on a field refusal, so focus goes to that field; cleared each time it opens. */
  const refusedOnField = useRef(false)
  /** Set when the reason dialog closed on a members-limit refusal, so focus goes to the Billing link. */
  const refusedFull = useRef(false)
  /** Set when a member's own send met a members-limit refusal: no dialog closes, so the link takes focus once shown. */
  const focusBillingLink = useRef(false)
  const canGrant = platformRoleAtLeast(
    useAuthStore((state) => state.user?.platformRole),
    'manager'
  )

  useEffect(() => {
    if (!full || !focusBillingLink.current) return
    focusBillingLink.current = false
    billingLink.current?.focus()
  }, [full])

  /**
   * Shows a members-limit refusal at form level in staff words.
   * @returns Whether the refusal was one, on a customer tenant's page, which can link its Billing tab.
   */
  async function showFull(error: unknown): Promise<boolean> {
    const refusal = planRefusalFrom(error)
    // The platform tenant has no Billing tab to link; its refusal shows as the API's sentence.
    if (refusal?.kind !== 'limit' || tenantId === undefined || isPlatformTenant({ slug })) {
      return false
    }
    const sentence = await membersLimitSentence(queryClient, tenantId, refusal, canGrant)
    serverErrors.setFormErrors([sentence])
    setFull(true)
    return true
  }

  /**
   * Puts a refusal about the address or the role on its field: `already_member`
   * on Email, a validation 400 on whichever field it names.
   * @returns Whether the refusal was one of those.
   */
  function showOnField(error: unknown): boolean {
    if (codeFrom(error) === ALREADY_MEMBER) {
      serverErrors.setFieldError('email', [staffMessageFrom(error)])
      return true
    }
    const fields = fieldErrorsFrom(error)
    if (fields.email === undefined && fields.role === undefined) return false
    serverErrors.capture(error)
    return true
  }
  const grantable = MEMBERSHIP_ROLES.filter((role) => canActorGrantRole(myRole, role))

  /** The schema's input type, so `role` stays a MembershipRole rather than widening to `string`. */
  const defaultValues: z.input<typeof inviteMemberSchema> = {
    email: '',
    role: DEFAULT_MEMBER_ROLE,
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: inviteMemberSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      setFull(false)
      const input = inviteMemberSchema.parse(value)
      if (asStaff) {
        refusedOnField.current = false
        refusedFull.current = false
        setToConfirm(input)
        return
      }
      try {
        await stepUp.run(() => inviteMember.mutateAsync(input))
        toast.success(
          <>
            Invitation sent to <Pii>{input.email}</Pii>.
          </>
        )
        form.reset()
      } catch (error) {
        if (showOnField(error)) return
        if (codeFrom(error) === INVITATION_CONFLICT) {
          serverErrors.setFormErrors([RACED])
          return
        }
        if (isReauthRequired(error)) {
          serverErrors.setFormErrors([stepUpRefusal(error)])
          return
        }
        // Set before the refusal renders, so the effect that shows the link finds it.
        focusBillingLink.current = true
        if (await showFull(error)) return
        focusBillingLink.current = false
        serverErrors.capture(error)
      }
    },
  })

  return (
    <>
      <Form
        ref={formRef}
        form={form}
        serverErrors={serverErrors}
        className="sm:flex sm:items-start sm:gap-3"
      >
        <FormField form={form} name="email">
          {(field) => (
            <FormItem className="sm:flex-1">
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
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

        <FormField form={form} name="role">
          {(field) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select
                value={fieldValue(field.state.value)}
                onValueChange={(value: string | null) => {
                  if (value === null) return
                  field.handleChange(value)
                  serverErrors.clearField('role')
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue>
                      {(value: string) => ROLE_LABELS[value as MembershipRole] ?? value}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {grantable.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        <div className="grid gap-2 sm:pt-6">
          <FormError />
          {full && tenantId !== undefined && (
            <Link
              ref={billingLink}
              to={ROUTES.tenantBilling}
              params={{ tenantId }}
              className="text-sm underline underline-offset-4"
            >
              Open Billing
            </Link>
          )}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <BusyButton
                // The refused send is not pending while its step-up waits; the submit still is.
                busy={inviteMember.isPending || (waiting && isSubmitting)}
                busyLabel={waiting && isSubmitting ? STEP_UP_WAITING_LABEL : 'Sending…'}
                type="submit"
              >
                {submitLabel}
              </BusyButton>
            )}
          </form.Subscribe>
        </div>
      </Form>
      {asStaff && (
        <ReasonDialog
          open={toConfirm !== null}
          onOpenChange={(open) => {
            if (!open) setToConfirm(null)
          }}
          title="Send this invitation?"
          description={
            toConfirm === null ? (
              ''
            ) : (
              <>
                <Pii>{toConfirm.email}</Pii> will be invited to this customer tenant as{' '}
                {ROLE_LABELS[toConfirm.role]}.
              </>
            )
          }
          confirmLabel="Send invitation"
          refusalMessage={(error) => (codeFrom(error) === INVITATION_CONFLICT ? RACED : undefined)}
          finalFocus={() =>
            (refusedFull.current && billingLink.current) ||
            (refusedOnField.current &&
              formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')) ||
            true
          }
          onConfirm={async (reason) => {
            if (toConfirm === null) return
            try {
              await stepUp.run(() => inviteMember.mutateAsync({ ...toConfirm, reason }))
            } catch (error) {
              if (await showFull(error)) {
                refusedFull.current = true
                return
              }
              if (!showOnField(error)) throw error
              refusedOnField.current = true
              return
            }
            toast.success(
              <>
                Invitation sent to <Pii>{toConfirm.email}</Pii>.
              </>
            )
            form.reset()
          }}
        />
      )}
    </>
  )
}
