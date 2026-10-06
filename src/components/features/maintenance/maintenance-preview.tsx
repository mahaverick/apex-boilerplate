import { Pii } from '@/components/shared/pii'
import type { MaintenanceMode } from '@/types/api.types'

/** What the customer app says beside the message: its full page's footer line, and its read-only toast. */
const FULL_PAGE_FOOTER = 'This page will refresh when we’re back.'
const READ_ONLY_TOAST = 'Changes are paused during maintenance.'

/**
 * A text-only mock-up of what customers will see with this message: the
 * customer app's full-screen page in `full`, its banner in `read_only`. The
 * message renders as text, line breaks kept, exactly as the customer app
 * renders it; an empty one shows a placeholder.
 */
export function MaintenancePreview({
  mode,
  message,
}: {
  mode: Exclude<MaintenanceMode, 'off'>
  message: string
}) {
  const text = message.trim()
  const body =
    text === '' ? (
      <span className="text-muted-foreground italic">Your message appears here.</span>
    ) : (
      <Pii className="whitespace-pre-line">{text}</Pii>
    )
  return (
    <section aria-label="Customer preview" className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        {mode === 'full'
          ? 'Customers see this page instead of the app:'
          : 'Customers see this banner on every page:'}
      </p>
      {mode === 'full' ? (
        <div className="grid justify-items-center gap-2 rounded-md border bg-muted/40 p-4 text-center text-sm">
          <p className="wrap-break-word">{body}</p>
          <p className="text-xs text-muted-foreground">{FULL_PAGE_FOOTER}</p>
        </div>
      ) : (
        <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
          <p className="wrap-break-word">{body}</p>
          <p className="text-xs text-muted-foreground">
            Their changes are refused with “{READ_ONLY_TOAST}”
          </p>
        </div>
      )}
    </section>
  )
}
