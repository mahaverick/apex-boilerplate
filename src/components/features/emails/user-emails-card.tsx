import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EmailStatusBadge } from '@/components/features/emails/email-status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { templateLabel } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import { emailsListOptions } from '@/queries/email.queries'

/** How many of a user's emails the card lists; the rest are one link away. */
export const USER_EMAILS_SHOWN = 10

/**
 * The newest emails sent for this account, as the History card lays out a
 * record's entries. Every staff role reads `/platform/emails`, so a viewer
 * sees it too. "View all" opens the Emails list filtered to the account.
 */
export function UserEmailsCard({ userId }: { userId: string }) {
  const emails = useQuery(
    emailsListOptions({ user: userId, limit: USER_EMAILS_SHOWN }, { total: false })
  )
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
              search={{ user: userId }}
              className="text-sm underline underline-offset-4"
            >
              View all emails
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          <QueryState
            query={emails}
            name="Emails"
            errorMessage="We couldn’t load this account’s emails. Select Try again."
            skeleton={<CardRowsSkeleton rows={3} rowHeight="2.25rem" />}
            isEmpty={(page) => page.items.length === 0}
            empty={<EmptyState size="compact" title="No emails sent to this account yet." />}
          >
            {(page) => (
              <ItemGroup className="gap-2 has-data-[size=xs]:gap-2">
                {page.items.map((email) => (
                  <Item key={email.id} size="xs" role="listitem" className="p-0">
                    <ItemContent>
                      <ItemTitle className="line-clamp-none font-normal">
                        <Link
                          to={ROUTES.email}
                          params={{ emailId: email.id }}
                          className="underline-offset-4 hover:underline"
                        >
                          {`${templateLabel(email.templateKey)} · ${formatDateTime(email.createdAt) ?? 'unknown date'}`}
                        </Link>
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <EmailStatusBadge status={email.status} />
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </section>
  )
}
