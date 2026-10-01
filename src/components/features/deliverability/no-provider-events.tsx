import { EMAIL_TRACKING_DOCS_URL } from '@/constants/email.constants'

/**
 * Shown while no provider event has arrived in the window. A banner, not an
 * empty state: the chart still has sent, undelivered and suppressed emails to
 * show, and only the provider-dependent rates are unknown.
 */
export function NoProviderEvents() {
  return (
    <div role="note" className="rounded-md border p-3 text-sm text-muted-foreground">
      No provider events yet — delivery, bounce and complaint data appear once a provider webhook is
      configured.{' '}
      <a
        href={EMAIL_TRACKING_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline underline-offset-4"
      >
        How to configure one<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  )
}
