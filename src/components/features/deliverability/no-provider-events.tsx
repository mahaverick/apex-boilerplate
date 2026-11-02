import { Note } from '@/components/shared/note'
import { EMAIL_TRACKING_DOCS_URL } from '@/constants/email.constants'

/**
 * Shown while no provider event has arrived in the window. A banner, not an
 * empty state: the chart still has sent, undelivered and suppressed emails to
 * show, and only the provider-dependent rates are unknown. A webhook may be
 * set up and still have sent nothing in the window, so it says what is
 * missing, not that no webhook exists.
 * @param props.period - The window's UTC days, as `rangeLabel` names them.
 */
export function NoProviderEvents({ period }: { period: string }) {
  return (
    <Note tone="passive">
      No email provider events in {period}. Delivery, bounce, complaint, open and click rates need
      events from the provider’s webhook.{' '}
      <a
        href={EMAIL_TRACKING_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline underline-offset-4"
      >
        How to configure one<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Note>
  )
}
