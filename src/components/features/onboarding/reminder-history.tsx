import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import type { OnboardingReminderView } from '@/types/api.types'

/** "1 owner at example.com", from the reminder's own counts. */
function recipients(reminder: OnboardingReminderView): ReactNode {
  const who = `${reminder.recipientCount} ${reminder.recipientCount === 1 ? 'owner' : 'owners'}`
  return reminder.emailDomains.length > 0 ? (
    <>
      {who} at <Pii>{reminder.emailDomains.join(', ')}</Pii>
    </>
  ) : (
    who
  )
}

/**
 * Every reminder staff sent this tenant, newest first: when, by whom, why,
 * to which owners' domains, and a link to each email it queued on the
 * Emails pages, where its delivery can be followed.
 */
export function ReminderHistory({ reminders }: { reminders: OnboardingReminderView[] }) {
  if (reminders.length === 0) {
    return <EmptyState size="compact" title="No reminder sent yet." />
  }
  return (
    <ItemGroup aria-label="Reminders sent" className="gap-3 has-data-[size=sm]:gap-3">
      {reminders.map((reminder) => (
        <Item key={reminder.id} size="sm" role="listitem" className="p-0">
          <ItemContent className="min-w-0">
            <ItemTitle className="line-clamp-none font-normal">
              <span className="font-medium">
                {formatDateTime(reminder.sentAt) ?? 'At an unknown time'}
              </span>{' '}
              · {reminder.sentBy === null ? 'A removed user' : <Pii>{reminder.sentBy.name}</Pii>} ·
              to {recipients(reminder)}
            </ItemTitle>
            <ItemDescription className="line-clamp-none wrap-break-word">
              “<Pii>{reminder.reason}</Pii>”
            </ItemDescription>
            {reminder.messageIds.length > 0 && (
              <div className="flex flex-wrap gap-x-3">
                {reminder.messageIds.map((messageId, index) => (
                  <Link
                    key={messageId}
                    to={ROUTES.email}
                    params={{ emailId: messageId }}
                    className="underline underline-offset-4"
                  >
                    {reminder.messageIds.length === 1
                      ? 'View the email'
                      : `View email ${index + 1} of ${reminder.messageIds.length}`}
                  </Link>
                ))}
              </div>
            )}
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}
