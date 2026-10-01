import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { EmailPreviewPanel } from '@/components/features/emails/email-preview'
import { EmailStatusBadge } from '@/components/features/emails/email-status-badge'
import { EmailTimeline } from '@/components/features/emails/email-timeline'
import { ResendEmailButton } from '@/components/features/emails/resend-email-button'
import { LoadError } from '@/components/features/load-error'
import { buttonVariants } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pageTitle } from '@/constants/app'
import { SUPPRESSION_REASON_LABELS, templateLabel } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { statusFrom } from '@/lib/api-error'
import { formatDate, formatDateTime } from '@/lib/format'
import { emailQueryOptions } from '@/queries/email.queries'
import {
  EMAIL_DETAIL_TABS,
  emailDetailSearchSchema,
  type EmailDetailTab,
} from '@/schemas/email.schemas'
import type { EmailFailureOrigin, EmailMessageDetail } from '@/types/api.types'

export const Route = createFileRoute('/_app/emails/$emailId')({
  validateSearch: emailDetailSearchSchema,
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(emailQueryOptions(params.emailId))
  },
  head: () => ({ meta: [{ title: pageTitle('Email') }] }),
  staticData: { crumb: EmailCrumb, crumbParent: { label: 'Emails', to: ROUTES.emails } },
  component: EmailDetailPage,
})

/** The recipient in the trail, once the message has loaded. */
function EmailCrumb({ params }: { params: Record<string, string> }) {
  const { data } = useQuery(emailQueryOptions(params.emailId ?? ''))
  return data?.recipient ?? 'Email'
}

const SENDER_LABELS = { transactional: 'Transactional sender', general: 'General sender' } as const

/** Who set a message `failed`, as the header says it. */
const FAILURE_LABELS: Record<EmailFailureOrigin, string> = {
  send: 'Every send attempt failed.',
  provider: 'The provider reported that it could not deliver this email.',
  enqueue: 'The email could not be queued, so it was never sent.',
}

const TAB_LABELS: Record<EmailDetailTab, string> = { timeline: 'Timeline', preview: 'Preview' }

function isDetailTab(value: unknown): value is EmailDetailTab {
  return (EMAIL_DETAIL_TABS as readonly unknown[]).includes(value)
}

function EmailDetailPage() {
  const { emailId } = Route.useParams()
  const detail = useQuery(emailQueryOptions(emailId))

  if (detail.isError) {
    return statusFrom(detail.error) === 404 ? (
      <Empty>
        <EmptyHeader>
          <h1 className="text-lg font-semibold">Email not found</h1>
          <EmptyDescription>
            It doesn’t exist, has passed its retention period, or your access changed. Reload if
            your role was just updated.
          </EmptyDescription>
        </EmptyHeader>
        <Link to={ROUTES.emails} className={buttonVariants({ variant: 'outline' })}>
          Back to emails
        </Link>
      </Empty>
    ) : (
      <LoadError message="We could not load this email." onRetry={() => void detail.refetch()} />
    )
  }
  if (detail.data === undefined) {
    return (
      <div className="grid gap-4">
        <h1 className="sr-only">Email</h1>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return <EmailDetail message={detail.data} />
}

/**
 * One message: who it went to and how it stands, a banner when its address
 * is suppressed, and the timeline and preview as tabs kept in `?tab`.
 */
function EmailDetail({ message }: { message: EmailMessageDetail }) {
  const { tab = 'timeline' } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <div className="grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold break-all">{message.recipient}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="text-foreground">{templateLabel(message.templateKey)}</span>
            <EmailStatusBadge status={message.status} />
            <span>{SENDER_LABELS[message.senderClass]}</span>
            <span>Created {formatDateTime(message.createdAt) ?? 'at an unknown time'}</span>
          </div>
          <p className="flex flex-wrap gap-x-4 text-sm">
            {message.user !== null && (
              <span>
                User{' '}
                <Link
                  to={ROUTES.user}
                  params={{ userId: message.user.id }}
                  className="underline underline-offset-4"
                >
                  {message.user.name}
                </Link>
              </span>
            )}
            {message.tenant !== null && (
              <span>
                Tenant{' '}
                <Link
                  to={ROUTES.tenant}
                  params={{ tenantId: message.tenant.id }}
                  className="underline underline-offset-4"
                >
                  {message.tenant.name}
                </Link>
              </span>
            )}
          </p>
          {message.status === 'failed' && message.failureOrigin !== null && (
            <p className="text-sm text-destructive">{FAILURE_LABELS[message.failureOrigin]}</p>
          )}
        </div>
        <ResendEmailButton message={message} />
      </div>

      {message.suppression !== null && (
        <p role="status" className="rounded-md border p-3 text-sm">
          This address is suppressed ({SUPPRESSION_REASON_LABELS[message.suppression.reason]}, since{' '}
          {formatDate(message.suppression.createdAt, 'medium') ?? 'an unknown date'}): no email is
          sent to it until the suppression is lifted.{' '}
          <Link
            to={ROUTES.suppressions}
            search={{ q: message.recipient }}
            className="underline underline-offset-4"
          >
            View suppression
          </Link>
        </p>
      )}

      <Tabs
        value={tab}
        onValueChange={(next: unknown) => {
          if (!isDetailTab(next)) return
          void navigate({ search: next === 'timeline' ? {} : { tab: next }, replace: true })
        }}
      >
        <TabsList aria-label="Email sections">
          {EMAIL_DETAIL_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {TAB_LABELS[value]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="timeline" className="pt-2">
          <EmailTimeline detail={message} />
        </TabsContent>
        <TabsContent value="preview" className="pt-2">
          <EmailPreviewPanel emailId={message.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
