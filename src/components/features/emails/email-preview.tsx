import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { Skeleton } from '@/components/ui/skeleton'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { emailPreviewQueryOptions } from '@/queries/email.queries'
import { TEMPLATE_UNAVAILABLE, type EmailSenderClass } from '@/types/api.types'

/**
 * The message re-rendered from its template: subject, HTML and text. The
 * HTML renders in an iframe with an empty `sandbox`, so nothing in it runs
 * scripts, submits forms or navigates this page, and it inherits the app's
 * CSP. The frame is a fixed 640px tall and scrolls on its own; its background
 * is white in both themes, as a mail client shows it. Token links are masked,
 * and the note saying so shows only for transactional (token) mail.
 */
export function EmailPreviewPanel({
  emailId,
  senderClass,
}: {
  emailId: string
  senderClass: EmailSenderClass
}) {
  const preview = useQuery(emailPreviewQueryOptions(emailId))

  if (preview.isError) {
    if (statusFrom(preview.error) === 409 && codeFrom(preview.error) === TEMPLATE_UNAVAILABLE) {
      return (
        <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
          This email’s template is no longer part of the app, so it can’t be previewed.
        </p>
      )
    }
    if (statusFrom(preview.error) === 404) return <RoleDenied />
    return (
      <LoadError message="We could not load the preview." onRetry={() => void preview.refetch()} />
    )
  }
  if (preview.data === undefined) return <Skeleton className="h-160 w-full" />

  const { subject, html, text, partial } = preview.data
  return (
    <div className="grid gap-4">
      {senderClass === 'transactional' && (
        <p className="text-sm text-muted-foreground">
          Links are masked: the real ones carried a one-time token, which is never stored.
        </p>
      )}
      {partial && (
        <p role="status" className="rounded-md border p-3 text-sm">
          Some of this email’s details were not stored, so placeholders stand in for them.
        </p>
      )}
      <section aria-labelledby="preview-subject" className="grid gap-1">
        <h2 id="preview-subject" className="text-sm font-medium">
          Subject
        </h2>
        <p className="text-sm wrap-break-word">{subject}</p>
      </section>
      <section aria-labelledby="preview-html" className="grid gap-1">
        <h2 id="preview-html" className="text-sm font-medium">
          HTML
        </h2>
        <iframe
          sandbox=""
          srcDoc={html}
          title="Email preview"
          className="h-160 w-full rounded-md border bg-white"
        />
      </section>
      <section aria-labelledby="preview-text" className="grid gap-1">
        <h2 id="preview-text" className="text-sm font-medium">
          Text
        </h2>
        <pre className="max-h-96 overflow-auto rounded-md border p-3 text-sm whitespace-pre-wrap">
          {text}
        </pre>
      </section>
    </div>
  )
}
