import { IconMail } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { EMAIL_FACETS } from '@/components/features/emails/email-filters'
import { EmailsTable } from '@/components/features/emails/emails-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { DetailTabPending } from '@/components/shared/pending-templates'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { emailsListOptions, tenantEmailsList } from '@/queries/email.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'

/** A tenant's Emails tab: the emails filed under it. */
export const Route = createFileRoute('/_app/tenants/$tenantId/emails')({
  validateSearch: tenantEmailsList.schema,
  loaderDeps: ({ search }) => listRequest(tenantEmailsList, listValues(tenantEmailsList, search)),
  // Started, not awaited: the tab renders its skeleton while this runs.
  loader: ({ context, params, deps }) => {
    void context.queryClient.prefetchQuery(emailsListOptions({ ...deps, tenant: params.tenantId }))
  },
  head: () => ({ meta: [{ title: pageTitle('Tenant emails') }] }),
  staticData: { crumb: 'Emails' },
  component: TenantEmailsTab,
  pendingComponent: DetailTabPending,
})

/**
 * The emails filed under this tenant, newest first, with status and template
 * filters and the recipient search, all in the URL. This is a platform read,
 * `/platform/emails?tenant=`, not one of the tenant's own routes, so a
 * suspended or archived tenant still lists its emails. The date range and
 * the user are the Emails list's; the link opens it scoped here.
 */
function TenantEmailsTab() {
  const { tenantId } = Route.useParams()
  const list = useListSearch(tenantEmailsList)
  const query = useListQuery(list, (request) => emailsListOptions({ ...request, tenant: tenantId }))

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Emails sent for this tenant, newest first.</p>
        <Link
          to={ROUTES.emails}
          search={{ tenant: tenantId }}
          className="text-sm underline underline-offset-4"
        >
          Filter these in Emails
        </Link>
      </div>
      <EmailsTable
        query={query}
        omit="tenant"
        errorMessage="We could not load this tenant’s emails."
        filters={EMAIL_FACETS}
        empty={
          <EmptyState
            icon={<IconMail aria-hidden="true" />}
            title="No emails for this tenant yet."
            description="Its invitations appear here once they are sent."
          />
        }
      />
    </div>
  )
}
