import { IconMail } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { DateRangeFilter } from '@/components/features/emails/date-range-filter'
import { emailFilters } from '@/components/features/emails/email-filters'
import { EmailsTable } from '@/components/features/emails/emails-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { pageTitle } from '@/constants/app'
import { emailsList, emailsListOptions, emailsSearchSchema } from '@/queries/email.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'

/** The Emails page: every tracked email, with everything that picks the rows in the URL. */
export const Route = createFileRoute('/_app/emails/')({
  validateSearch: emailsSearchSchema,
  loaderDeps: ({ search }) => listRequest(emailsList, listValues(emailsList, search)),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(emailsListOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Emails') }] }),
  staticData: { crumb: 'Emails' },
  component: EmailsPage,
})

/**
 * Every tracked email, newest first, filtered in the URL: recipient search,
 * status, template, creation dates, and a user or tenant (reached from their
 * pages, shown as removable chips). Pages are the API's keyset cursors in
 * `?cursor`/`?direction`; any filter change starts again from the first page.
 * The table owns the loading, error and empty states.
 */
function EmailsPage() {
  const list = useListSearch(emailsList)
  const query = useListQuery(list, emailsListOptions)

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="text-2xl font-semibold">Emails</h1>
      <EmailsTable
        query={query}
        errorMessage="We could not load the emails."
        filters={emailFilters(query.items)}
        empty={
          <EmptyState
            icon={<IconMail aria-hidden="true" />}
            title="No emails yet."
            description="Every email the app sends is listed here, with its delivery status."
          />
        }
        toolbar={
          <DateRangeFilter
            value={{ from: list.values.filters.from?.[0], to: list.values.filters.to?.[0] }}
            onChange={(range) =>
              list.setFilters({
                from: range.from === undefined ? [] : [range.from],
                to: range.to === undefined ? [] : [range.to],
              })
            }
          />
        }
      />
    </div>
  )
}
