import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/features/load-error'
import { OnboardingStateBadge } from '@/components/features/onboarding/onboarding-state-badge'
import { OnboardingStepList } from '@/components/features/onboarding/onboarding-step-list'
import { ReminderHistory } from '@/components/features/onboarding/reminder-history'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { RoleDenied } from '@/components/features/role-denied'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { AWAITING_OWNER_NOTE, NOT_TRACKED_NOTE } from '@/constants/onboarding.constants'
import { platformRoleAtLeast } from '@/constants/roles'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { statusFrom } from '@/lib/api-error'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  retryAfterFrom,
  tenantOnboardingQueryOptions,
  useCompleteOnboardingStep,
  useSendOnboardingReminder,
} from '@/queries/onboarding.queries'
import { useAuthStore } from '@/states/auth.store'
import type {
  OnboardingReminderAvailability,
  OnboardingStepDetail,
  TenantOnboardingDetail,
} from '@/types/api.types'

export const Route = createFileRoute('/_app/tenants/$tenantId/onboarding')({
  // Started, not awaited: the tab renders its skeleton while this runs.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(tenantOnboardingQueryOptions(params.tenantId))
  },
  head: () => ({ meta: [{ title: pageTitle('Tenant onboarding') }] }),
  staticData: { crumb: 'Onboarding' },
  component: TenantOnboardingTab,
})

/** A time in the reader's locale, or a fallback when there is none. */
function when(iso: string | null): string {
  return iso === null ? 'an unknown time' : (formatDateTime(iso) ?? 'an unknown time')
}

/** Why Send reminder is not offered, in the API's own terms (`blockedBy`). */
function reminderBlockedText(
  reminder: OnboardingReminderAvailability,
  lifecycleState: TenantOnboardingDetail['tenant']['lifecycleState']
): string {
  switch (reminder.blockedBy) {
    case 'tenant_state_conflict': {
      return `This tenant is ${lifecycleState}, so no reminder can be sent.`
    }
    case 'not_in_progress': {
      return 'Reminders go only to tenants still working through their steps.'
    }
    case 'no_owner': {
      return 'This tenant has no active owner to remind.'
    }
    case 'reminded_recently': {
      return `Reminder sent ${when(reminder.lastSentAt)}; the next one can go after ${when(reminder.nextAllowedAt)}.`
    }
    case null: {
      return ''
    }
  }
}

/**
 * One tenant's onboarding, from the platform read, so it shows in every
 * lifecycle state: its state, each step and how it was done, and the
 * reminders staff sent. A 404 is a role refusal; the layout handles an
 * unknown tenant.
 */
function TenantOnboardingTab() {
  const { tenantId } = Route.useParams()
  const detail = useQuery(tenantOnboardingQueryOptions(tenantId))
  if (detail.isError) {
    return statusFrom(detail.error) === 404 ? (
      <RoleDenied />
    ) : (
      <LoadError
        message="We could not load this tenant’s onboarding."
        onRetry={() => void detail.refetch()}
      />
    )
  }
  if (detail.data === undefined) return <Skeleton className="h-64 w-full" />
  return <TenantOnboarding detail={detail.data} />
}

/**
 * Mark complete and Send reminder show only when the API would take them
 * (`canMarkComplete`, `reminder.canSend`) and the reader is a platform
 * admin; otherwise a line says why. Both go through a reason dialog mounted
 * here, not beside its button, so a refusal that refreshes the detail and
 * takes the button away still leaves the dialog open with the API's reason.
 */
function TenantOnboarding({ detail }: { detail: TenantOnboardingDetail }) {
  const { tenant, state, reminder } = detail
  const isAdmin = platformRoleAtLeast(
    useAuthStore((s) => s.user?.platformRole),
    'admin'
  )
  const complete = useCompleteOnboardingStep(tenant.id, tenant.slug)
  const remind = useSendOnboardingReminder(tenant.id, tenant.slug)
  const focus = useFocusAfter<'heading' | 'reminders' | `step:${string}`>()
  const opener = useRef<HTMLElement | null>(null)
  const [marking, setMarking] = useState<OnboardingStepDetail | null>(null)
  const [isMarkOpen, setMarkOpen] = useState(false)
  const [reminding, setReminding] = useState<OnboardingReminderAvailability | null>(null)
  const [isRemindOpen, setRemindOpen] = useState(false)
  /**
   * Where a dialog sends focus as it closes: the landmark a success chose (a
   * write takes its button away: the step is done, the next reminder must
   * wait), else back to the button, else the heading if a refusal took it away.
   */
  const finalFocus = () => focus.finalFocus(opener.current, 'heading')

  const isFrozen = tenant.lifecycleState !== 'active'
  const isTracked = state !== 'not_tracked'
  const hasMarkable = detail.steps.some((step) => step.canMarkComplete)

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 ref={focus.target('heading')} tabIndex={-1} className="outline-none">
              Onboarding
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <OnboardingStateBadge state={state} />
            {isTracked && state !== 'awaiting_owner' && (
              <span>
                {detail.requiredDone} of {detail.requiredTotal} required steps done
              </span>
            )}
            {detail.startedAt !== null && (
              <span className="text-muted-foreground">
                Started {formatDate(detail.startedAt, 'medium') ?? 'on an unknown date'}
              </span>
            )}
            {detail.lastProgressAt !== null && (
              <span className="text-muted-foreground">
                Last progress {when(detail.lastProgressAt)}
              </span>
            )}
            {detail.daysStuck !== null && (
              <span className="text-muted-foreground">
                No progress for {detail.daysStuck} {detail.daysStuck === 1 ? 'day' : 'days'}
              </span>
            )}
          </div>
          {state === 'not_tracked' && <p className="text-sm">{NOT_TRACKED_NOTE}</p>}
          {state === 'awaiting_owner' && <p className="text-sm">{AWAITING_OWNER_NOTE}</p>}
          {state === 'dismissed' && (
            <p className="text-sm">
              {detail.dismissedBy?.name ?? 'An owner'} dismissed the getting-started checklist{' '}
              {when(detail.dismissedAt)}.
            </p>
          )}
          {isFrozen && (
            <p className="text-sm">
              This tenant is {tenant.lifecycleState}: its onboarding is read-only.
            </p>
          )}
          {isTracked && (
            <OnboardingStepList
              steps={detail.steps}
              canAct={isAdmin}
              target={(key) => focus.target(`step:${key}`)}
              onMarkComplete={(step, button) => {
                opener.current = button
                setMarking(step)
                setMarkOpen(true)
              }}
            />
          )}
          {isTracked && !isFrozen && !isAdmin && (hasMarkable || reminder.canSend) && (
            <p className="text-sm text-muted-foreground">
              Marking steps complete and sending reminders need a platform admin.
            </p>
          )}
        </CardContent>
      </Card>

      {isTracked && (
        <section aria-labelledby="onboarding-reminders">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2
                  id="onboarding-reminders"
                  ref={focus.target('reminders')}
                  tabIndex={-1}
                  className="outline-none"
                >
                  Reminders
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {reminder.canSend && isAdmin ? (
                <div className="grid justify-items-start gap-2">
                  <Button
                    variant="outline"
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      setReminding(reminder)
                      setRemindOpen(true)
                    }}
                  >
                    Send reminder
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Emails each active owner a link to the tenant in the customer app.
                  </p>
                </div>
              ) : reminder.blockedBy !== null && state !== 'awaiting_owner' ? (
                <p className="text-sm">{reminderBlockedText(reminder, tenant.lifecycleState)}</p>
              ) : null}
              <ReminderHistory reminders={detail.reminders} />
            </CardContent>
          </Card>
        </section>
      )}

      <ReasonDialog
        open={isMarkOpen}
        onOpenChange={setMarkOpen}
        finalFocus={finalFocus}
        title={`Mark “${marking?.title ?? ''}” complete?`}
        description="It counts as done for this tenant, shown as completed by staff with your reason. The customer sees it ticked on their checklist."
        confirmLabel="Mark complete"
        onConfirm={async (reason) => {
          if (marking === null) return
          await complete.mutateAsync({ stepKey: marking.key, reason })
          focus.focusAfter([`step:${marking.key}`, 'heading'], opener.current)
          toast.success(`Marked “${marking.title}” complete.`)
        }}
      />
      <ReasonDialog
        open={isRemindOpen}
        onOpenChange={setRemindOpen}
        finalFocus={finalFocus}
        title="Send an onboarding reminder?"
        description={`One email goes to each active owner (${reminding?.recipientCount ?? 0}) at ${reminding?.emailDomains.join(', ') || 'their address'}, linking to the tenant in the customer app. Another reminder can go 24 hours after this one.`}
        confirmLabel="Send reminder"
        refusalMessage={(error) => {
          const retryAfter = retryAfterFrom(error)
          return retryAfter === undefined
            ? undefined
            : `A reminder went out less than 24 hours ago. The next one can go after ${when(retryAfter)}.`
        }}
        onConfirm={async (reason) => {
          const result = await remind.mutateAsync(reason)
          focus.focusAfter(['reminders', 'heading'], opener.current)
          if (result.emailSent) {
            toast.success(
              `Reminder sent to ${result.recipientCount} ${result.recipientCount === 1 ? 'owner' : 'owners'}.`
            )
          } else {
            toast.warning(
              'The reminder was recorded, but its email could not be queued for every owner.'
            )
          }
        }}
      />
    </div>
  )
}
