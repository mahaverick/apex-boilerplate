import { IconCircleCheck, IconCircleDashed } from '@tabler/icons-react'
import type { ReactNode, RefCallback } from 'react'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { ONBOARDING_SOURCE_LABELS } from '@/constants/onboarding.constants'
import { ROLE_LABELS } from '@/constants/roles'
import { formatDateTime } from '@/lib/format'
import type { OnboardingStepDetail } from '@/types/api.types'

/** When and how a step was done: "Completed Sep 12, 2026, 9:00 AM · Detected automatically". */
function completionLine(step: OnboardingStepDetail): ReactNode {
  if (step.completedAt === null) return null
  const when = `Completed ${formatDateTime(step.completedAt) ?? 'at an unknown time'}`
  if (step.source !== 'staff') {
    return step.source === null ? when : `${when} · ${ONBOARDING_SOURCE_LABELS[step.source]}`
  }
  return (
    <>
      {when} · by staff:{' '}
      {step.completedBy === null ? 'a removed user' : <Pii>{step.completedBy.name}</Pii>}
      {step.reason ? (
        <>
          {' '}
          — <Pii>{step.reason}</Pii>
        </>
      ) : null}
    </>
  )
}

/** A member step's per-person status, behind a disclosure: "1 of 2 members". */
function MemberStatuses({ members }: { members: NonNullable<OnboardingStepDetail['members']> }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
        {members.completed} of {members.total} members
      </summary>
      <ItemGroup className="mt-2 gap-1 has-data-[size=xs]:gap-1">
        {members.entries.map((member) => (
          <Item key={member.user.id} size="xs" role="listitem" className="p-0">
            <ItemContent>
              <ItemTitle className="line-clamp-none font-normal">
                <span className="flex flex-wrap gap-x-2">
                  <Pii className="font-medium">{member.user.name}</Pii>
                  <span className="text-muted-foreground">({ROLE_LABELS[member.role]})</span>
                  <span>
                    {member.completedAt === null
                      ? 'Not yet'
                      : `Done ${formatDateTime(member.completedAt) ?? 'at an unknown time'}`}
                  </span>
                </span>
              </ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
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
          <Item
            key={step.key}
            variant="outline"
            size="sm"
            render={<li ref={target(step.key)} tabIndex={-1} />}
            className="flex-nowrap items-start"
          >
            <ItemMedia>
              {isDone ? (
                <IconCircleCheck aria-hidden="true" className="size-4 text-success" />
              ) : (
                <IconCircleDashed aria-hidden="true" className="size-4 text-muted-foreground" />
              )}
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="line-clamp-none">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span>{step.title}</span>
                  <span className="sr-only">{isDone ? ', done' : ', not done'}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {step.required ? 'Required' : 'Optional'}
                    {step.scope === 'member' && ' · each person'}
                  </span>
                </span>
              </ItemTitle>
              <ItemDescription className="line-clamp-none">{step.description}</ItemDescription>
              {line !== null && <p className="text-sm wrap-break-word">{line}</p>}
              {step.members !== null && <MemberStatuses members={step.members} />}
            </ItemContent>
            {canAct && step.canMarkComplete && (
              <ItemActions className="self-start">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Mark complete: ${step.title}`}
                  onClick={(event) => onMarkComplete(step, event.currentTarget)}
                >
                  Mark complete
                </Button>
              </ItemActions>
            )}
          </Item>
        )
      })}
    </ol>
  )
}
