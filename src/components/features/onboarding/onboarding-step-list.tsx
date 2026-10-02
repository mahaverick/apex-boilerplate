import { CircleCheck, CircleDashed } from 'lucide-react'
import type { RefCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ONBOARDING_SOURCE_LABELS } from '@/constants/onboarding.constants'
import { ROLE_LABELS } from '@/constants/roles'
import { formatDateTime } from '@/lib/format'
import type { OnboardingStepDetail } from '@/types/api.types'

/** When and how a step was done: "Completed Sep 12, 2026, 9:00 AM · Detected automatically". */
function completionLine(step: OnboardingStepDetail): string | null {
  if (step.completedAt === null) return null
  const when = `Completed ${formatDateTime(step.completedAt) ?? 'at an unknown time'}`
  if (step.source !== 'staff') {
    return step.source === null ? when : `${when} · ${ONBOARDING_SOURCE_LABELS[step.source]}`
  }
  const who = step.completedBy?.name ?? 'a removed user'
  return `${when} · by staff: ${who}${step.reason ? ` — ${step.reason}` : ''}`
}

/** A member step's per-person status, behind a disclosure: "1 of 2 members". */
function MemberStatuses({ members }: { members: NonNullable<OnboardingStepDetail['members']> }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
        {members.completed} of {members.total} members
      </summary>
      <ul className="mt-2 grid gap-1">
        {members.entries.map((member) => (
          <li key={member.user.id} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{member.user.name}</span>
            <span className="text-muted-foreground">({ROLE_LABELS[member.role]})</span>
            <span>
              {member.completedAt === null
                ? 'Not yet'
                : `Done ${formatDateTime(member.completedAt) ?? 'at an unknown time'}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * The registry's steps in order, each done or pending, required or optional,
 * with how it was completed. A member step counts for the tenant once any
 * active owner has done it, and lists every member's own status.
 * Mark complete shows only where the API would take it and the reader is an
 * admin (`canAct`); it hands its own button to `onMarkComplete`, so focus can
 * return there. Each row is a focus landmark: once Mark complete replaces its
 * button, focus lands on the row.
 */
export function OnboardingStepList({
  steps,
  canAct,
  target,
  onMarkComplete,
}: {
  steps: OnboardingStepDetail[]
  canAct: boolean
  /** The ref callback that registers a step's row as a focus landmark (`useFocusAfter`), keyed by step. */
  target: (stepKey: string) => RefCallback<HTMLElement>
  onMarkComplete: (step: OnboardingStepDetail, opener: HTMLButtonElement) => void
}) {
  return (
    <ol aria-label="Onboarding steps" className="grid gap-3">
      {steps.map((step) => {
        const isDone = step.completedAt !== null
        const line = completionLine(step)
        return (
          <li
            key={step.key}
            ref={target(step.key)}
            tabIndex={-1}
            className="flex gap-3 rounded-md border p-3 outline-none"
          >
            {isDone ? (
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{step.title}</span>
                <span className="sr-only">{isDone ? ', done' : ', not done'}</span>
                <span className="text-xs text-muted-foreground">
                  {step.required ? 'Required' : 'Optional'}
                  {step.scope === 'member' && ' · each person'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{step.description}</p>
              {line !== null && <p className="text-sm wrap-break-word">{line}</p>}
              {step.members !== null && <MemberStatuses members={step.members} />}
            </div>
            {canAct && step.canMarkComplete && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 self-start"
                aria-label={`Mark complete: ${step.title}`}
                onClick={(event) => onMarkComplete(step, event.currentTarget)}
              >
                Mark complete
              </Button>
            )}
          </li>
        )
      })}
    </ol>
  )
}
