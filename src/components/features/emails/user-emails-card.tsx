import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EmailStatusBadge } from '@/components/features/emails/email-status-badge'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { templateLabel } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import { emailsQueryOptions } from '@/queries/email.queries'
import { isRoleDenied } from '@/queries/platform.queries'

/** How many of a user's emails the card lists; the rest are one link away. */
export const USER_EMAILS_SHOWN = 10

/**
 * The newest emails sent for this account, as the History card lays out a
 * record's entries. Every staff role reads `/platform/emails`, so a viewer
 * sees it too. "View all" opens the Emails list filtered to the account.
 */
export function UserEmailsCard({ userId }: { userId: string }) {
  const emails = useQuery(emailsQueryOptions({ userId, limit: USER_EMAILS_SHOWN }))
  const headingId = `emails-${userId}`
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId}>Emails</h2>
          </CardTitle>
          <CardAction>
            <Link
              to={ROUTES.emails}
              search={{ userId }}
              className="text-sm underline underline-offset-4"
            >
              View all emails
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          {emails.isError ? (
            isRoleDenied(emails.error) ? (
              <RoleDenied />
            ) : (
              <LoadError
                message="We could not load this account’s emails."
                onRetry={() => void emails.refetch()}
              />
            )
          ) : emails.data === undefined ? (
            <Skeleton className="h-24 w-full" />
          ) : emails.data.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails sent to this account yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {emails.data.messages.map((email) => (
                <li key={email.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={ROUTES.email}
                    params={{ emailId: email.id }}
                    className="underline-offset-4 hover:underline"
                  >
                    {`${templateLabel(email.templateKey)} · ${formatDateTime(email.createdAt) ?? 'unknown date'}`}
                  </Link>
                  <EmailStatusBadge status={email.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
