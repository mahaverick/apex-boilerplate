import { ChartCard } from '@/components/features/overview/chart-card'
import { FUNNEL_COLORS, ONBOARDING_RANGE_LABELS } from '@/constants/onboarding.constants'
import { formatShare } from '@/lib/format'
import type { OnboardingFunnel, OnboardingFunnelStep } from '@/types/api.types'

/** "30 of 40 tenants (75.00%)": a step's completions over the tenants that started. */
function shareLabel(step: OnboardingFunnelStep, started: number): string {
  return `${step.completed.toLocaleString('en-US')} of ${started.toLocaleString('en-US')} tenants (${formatShare(step.completed, started)})`
}

/** A width for an inline style: the part's share of the whole, as a percentage. */
function width(part: number, whole: number): string {
  return `${Math.min(100, (part / whole) * 100)}%`
}

/**
 * One horizontal bar per registry step, over the tenants that started
 * onboarding in the window: the completed share, with the part staff marked
 * complete in its own colour at the bar's end. The labels are HTML, not
 * chart text; the bars are hidden from assistive tech, and the visually
 * hidden table carries the same figures.
 */
export function FunnelCard({ funnel }: { funnel: OnboardingFunnel }) {
  const { steps } = funnel
  const { started } = funnel.totals
  return (
    <ChartCard
      title="Onboarding funnel"
      empty={
        started === 0
          ? `No tenant started onboarding in the last ${ONBOARDING_RANGE_LABELS[funnel.range]}`
          : null
      }
    >
      <div aria-hidden className="grid gap-4">
        <ol className="grid gap-3">
          {steps.map((step) => (
            <li key={step.key} className="grid gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                <span className="font-medium">
                  {step.title}
                  {!step.required && (
                    <span className="font-normal text-muted-foreground"> · optional</span>
                  )}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {shareLabel(step, started)}
                  {step.staffCompleted > 0 &&
                    ` · ${step.staffCompleted.toLocaleString('en-US')} by staff`}
                </span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full"
                  style={{
                    width: width(step.completed - step.staffCompleted, started),
                    background: FUNNEL_COLORS.completed,
                  }}
                />
                <div
                  className="h-full"
                  style={{
                    width: width(step.staffCompleted, started),
                    background: FUNNEL_COLORS.staff,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: FUNNEL_COLORS.completed }} />
            Completed by the customer or automatically
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: FUNNEL_COLORS.staff }} />
            Marked complete by staff
          </span>
        </div>
      </div>
      {/* A table sizes to its columns, ignoring sr-only's 1px width, so the clipping box is a div. */}
      <div className="sr-only">
        <table>
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Required</th>
              <th scope="col">Completed</th>
              <th scope="col">By staff</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.key}>
                <th scope="row">{step.title}</th>
                <td>{step.required ? 'Required' : 'Optional'}</td>
                <td>{step.completed}</td>
                <td>{step.staffCompleted}</td>
                <td>{formatShare(step.completed, started)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  )
}
