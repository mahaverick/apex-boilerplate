import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { z } from 'zod'
import { EmailsTable } from '@/components/features/emails/emails-table'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { emailsQueryOptions } from '@/queries/email.queries'
import { isRoleDenied } from '@/queries/platform.queries'
import { PAGE_DIRECTIONS, type PageDirection } from '@/types/api.types'

export const Route = createFileRoute('/_app/tenants/$tenantId/emails')({
  validateSearch: z.object({
    cursor: z.string().optional().catch(undefined),
    dir: z.enum(PAGE_DIRECTIONS).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ cursor: search.cursor, direction: search.dir }),
  // Started, not awaited: the tab renders its skeleton while this runs.
  loader: ({ context, params, deps }) => {
    void context.queryClient.prefetchQuery(
      emailsQueryOptions({ tenantId: params.tenantId, ...deps })
    )
  },
  head: () => ({ meta: [{ title: pageTitle('Tenant emails') }] }),
  staticData: { crumb: 'Emails' },
  component: TenantEmailsTab,
})

/**
 * The emails filed under this tenant (today, its invitations), newest first
 * and paged in the URL. This is a platform
 * read, `/platform/emails?tenantId=`, not one of the tenant's own routes, so a
 * suspended or archived tenant still lists its emails. Filtering by status,
 * template or date is the Emails list's job; the link opens it scoped here.
 */
function TenantEmailsTab() {
  const { tenantId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = useQuery(
    emailsQueryOptions({ tenantId, cursor: search.cursor, direction: search.dir })
  )

  function goTo(cursor: string | null, dir: PageDirection) {
    if (cursor) void navigate({ search: { cursor, dir } })
  }
  const firstPage = () => void navigate({ search: {} })

  const settled =
    page.data !== undefined && !(page.isPlaceholderData && page.data.messages.length === 0)

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Emails sent for this tenant, newest first.</p>
        <Link
          to={ROUTES.emails}
          search={{ tenantId }}
          className="text-sm underline underline-offset-4"
        >
          Filter these in Emails
        </Link>
      </div>
      {page.isError ? (
        isRoleDenied(page.error) ? (
          <RoleDenied />
        ) : (
          <div className="grid justify-items-start gap-2">
            <LoadError
              message="We could not load this tenant’s emails."
              onRetry={() => void page.refetch()}
            />
            {search.cursor !== undefined && (
              <Button variant="ghost" size="sm" onClick={firstPage}>
                <ChevronLeft aria-hidden />
                First page
              </Button>
            )}
          </div>
        )
      ) : !settled || page.data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : page.data.messages.length === 0 && search.cursor !== undefined ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing on this page.</EmptyTitle>
            <EmptyDescription>The list changed since this page was opened.</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" size="sm" onClick={firstPage}>
            <ChevronLeft aria-hidden />
            First page
          </Button>
        </Empty>
      ) : page.data.messages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No emails for this tenant yet.</EmptyTitle>
            <EmptyDescription>Its invitations appear here once they are sent.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div aria-busy={page.isPlaceholderData}>
            <EmailsTable rows={page.data.messages} omit="tenant" />
          </div>
          <nav aria-label="Pagination" className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={page.data.prevCursor === null || page.isPlaceholderData}
              onClick={() => goTo(page.data?.prevCursor ?? null, 'prev')}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={page.data.nextCursor === null || page.isPlaceholderData}
              onClick={() => goTo(page.data?.nextCursor ?? null, 'next')}
            >
              <ChevronRight aria-hidden />
            </Button>
          </nav>
        </>
      )}
    </div>
  )
}
