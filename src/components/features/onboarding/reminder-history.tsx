import { Link } from '@tanstack/react-router'
import { Pii } from '@/components/shared/pii'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import type { OnboardingReminderView } from '@/types/api.types'

/** "1 owner at example.com", from the reminder's own counts. */
function recipients(reminder: OnboardingReminderView): string {
  const who = `${reminder.recipientCount} ${reminder.recipientCount === 1 ? 'owner' : 'owners'}`
  return reminder.emailDomains.length > 0 ? `${who} at ${reminder.emailDomains.join(', ')}` : who
}

/**
 * Every reminder staff sent this tenant, newest first: when, by whom, why,
 * to which owners' domains, and a link to each email it queued on the
 * Emails pages, where its delivery can be followed.
 */
export function ReminderHistory({ reminders }: { reminders: OnboardingReminderView[] }) {
  if (reminders.length === 0) {
    return <p className="text-sm text-muted-foreground">No reminder sent yet.</p>
  }
  return (
    <ul aria-label="Reminders sent" className="grid gap-3">
      {reminders.map((reminder) => (
        <li key={reminder.id} className="grid gap-1 text-sm">
          <Pii as="p">
            <span className="font-medium">
              {formatDateTime(reminder.sentAt) ?? 'At an unknown time'}
            </span>{' '}
            · {reminder.sentBy?.name ?? 'A removed user'} · to {recipients(reminder)}
          </Pii>
          <Pii as="p" className="wrap-break-word text-muted-foreground">
            “{reminder.reason}”
          </Pii>
          {reminder.messageIds.length > 0 && (
            <p className="flex flex-wrap gap-x-3">
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
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
