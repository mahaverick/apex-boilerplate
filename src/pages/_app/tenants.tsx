import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { TenantsTable } from '@/components/features/tenants/tenants-table'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  isRoleDenied,
  platformTenantsQueryOptions,
  SEARCH_DEBOUNCE_MS,
} from '@/queries/platform.queries'

export const Route = createFileRoute('/_app/tenants')({
  validateSearch: z.object({ q: z.string().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(platformTenantsQueryOptions(deps.q, undefined))
  },
  head: () => ({ meta: [{ title: pageTitle('Tenants') }] }),
  staticData: { crumb: 'Tenants' },
  component: TenantsPage,
})

/** The first page's cursor stack: no cursor at all. */
const FIRST_PAGE: readonly (string | undefined)[] = [undefined]

/**
 * Every customer tenant, searched by name or slug. The term lives in `?q`;
 * pages are keyset cursors, and since the API only hands out a next cursor,
 * Previous pops a stack of the cursors already used. The stack belongs to
 * the term it was built under, and every change of term starts a new one on
 * page one.
 */
function TenantsPage() {
  const { q = '' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [draft, setDraft] = useState(q)
  const [followed, setFollowed] = useState(q)
  const term = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)
  const [paging, setPaging] = useState({ q, cursors: FIRST_PAGE })

  // Any new `?q` starts again from page one; one set under the page (the palette, Back) also fills the box, and the debounced term waits to catch up rather than navigating back.
  if (q !== followed) {
    setFollowed(q)
    setPaging({ q, cursors: FIRST_PAGE })
    if (q !== draft.trim()) setDraft(q)
  }

  const cursors = paging.q === q ? paging.cursors : FIRST_PAGE
  const page = useQuery({
    ...platformTenantsQueryOptions(q, cursors.at(-1)),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    const next = term.trim()
    if (term !== draft || next === q) return
    void navigate({ search: next === '' ? {} : { q: next }, replace: true })
  }, [term, draft, q, navigate])

  // The previous term's rows stay up while the next term loads; its "nothing matches" would name the wrong term.
  const settled =
    page.data !== undefined && !(page.isPlaceholderData && page.data.tenants.length === 0)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <Input
          type="search"
          aria-label="Search tenants"
          placeholder="Search by name or slug"
          className="w-72"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      {page.isError ? (
        isRoleDenied(page.error) ? (
          <RoleDenied />
        ) : (
          <LoadError message="We could not load the tenants." onRetry={() => void page.refetch()} />
        )
      ) : !settled || page.data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : page.data.tenants.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{q ? `No tenants match “${q}”.` : 'No tenants yet.'}</EmptyTitle>
            <EmptyDescription>
              {q
                ? 'Try part of the name or the slug.'
                : 'Tenants appear here once customers create them.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div aria-busy={page.isPlaceholderData}>
            <TenantsTable rows={page.data.tenants} />
          </div>
          <nav aria-label="Pagination" className="flex items-center justify-end gap-2">
            <span className="text-sm text-muted-foreground">Page {cursors.length}</span>
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={cursors.length === 1 || page.isPlaceholderData}
              onClick={() => setPaging({ q, cursors: cursors.slice(0, -1) })}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={page.data.nextCursor === null || page.isPlaceholderData}
              onClick={() => {
                const next = page.data?.nextCursor
                if (next) setPaging({ q, cursors: [...cursors, next] })
              }}
            >
              <ChevronRight aria-hidden />
            </Button>
          </nav>
        </>
      )}
    </div>
  )
}
