import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { CreateTenantDialog } from '@/components/features/tenants/create-tenant-dialog'
import { TenantsTable } from '@/components/features/tenants/tenants-table'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { isRoleDenied, SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { platformTenantsQueryOptions } from '@/queries/tenant-admin.queries'
import { searchText } from '@/schemas/search.schemas'
import { useAuthStore } from '@/states/auth.store'
import { PAGE_DIRECTIONS, TENANT_STATE_FILTERS, type TenantStateFilter } from '@/types/api.types'

const searchSchema = z.object({
  q: searchText,
  state: z.enum(TENANT_STATE_FILTERS).optional().catch(undefined),
  cursor: z.string().optional().catch(undefined),
  dir: z.enum(PAGE_DIRECTIONS).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/tenants/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    q: search.q ?? '',
    state: search.state,
    cursor: search.cursor,
    dir: search.dir,
  }),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(platformTenantsQueryOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Tenants') }] }),
  staticData: { crumb: 'Tenants' },
  component: TenantsPage,
})

/** The select's value for "no ?state": the API's default. */
const DEFAULT_STATE = 'default'

const STATE_OPTIONS: { value: TenantStateFilter | typeof DEFAULT_STATE; label: string }[] = [
  { value: DEFAULT_STATE, label: 'Active and suspended' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

/**
 * Every customer tenant. Everything that picks the rows is in the URL (`?q`,
 * `?state`, and the page as `?cursor` + `?dir`), so a view can be shared and
 * Back walks through pages. The API hands out both a next and a previous
 * cursor, so there is no client-side history of pages. Changing the term or
 * the filter drops the cursor: a cursor belongs to the list it was cut from.
 */
function TenantsPage() {
  const { q = '', state, cursor, dir } = Route.useSearch()
  const navigate = Route.useNavigate()
  const canCreate = platformRoleAtLeast(
    useAuthStore((s) => s.user?.platformRole),
    'admin'
  )
  const [draft, setDraft] = useState(q)
  const [followed, setFollowed] = useState(q)
  const term = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)

  // A `?q` set under the page (the palette, Back) fills the box; one this page navigated to is the debounced term, and the box may already hold newer keystrokes.
  if (q !== followed) {
    setFollowed(q)
    if (q !== draft.trim() && q !== term.trim()) setDraft(q)
  }

  const page = useQuery({
    ...platformTenantsQueryOptions({ q, state, cursor, dir }),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    const next = term.trim()
    if (term !== draft || next === q) return
    void navigate({
      search: { ...(next === '' ? {} : { q: next }), ...(state ? { state } : {}) },
      replace: true,
    })
  }, [term, draft, q, state, navigate])

  const pageTo = (target: string, direction: 'next' | 'prev') =>
    void navigate({ search: (prev) => ({ ...prev, cursor: target, dir: direction }) })
  const firstPage = () =>
    void navigate({
      search: (prev) => ({
        ...(prev.q ? { q: prev.q } : {}),
        ...(prev.state ? { state: prev.state } : {}),
      }),
    })
  const setState = (value: string | null) => {
    if (value === null) return
    void navigate({
      search: (prev) => ({
        ...(prev.q ? { q: prev.q } : {}),
        ...(value === DEFAULT_STATE ? {} : { state: value as TenantStateFilter }),
      }),
    })
  }

  // The previous view's rows stay up while the next loads; its "nothing matches" would describe the wrong view.
  const settled =
    page.data !== undefined && !(page.isPlaceholderData && page.data.tenants.length === 0)
  const filtered = q !== '' || state !== undefined

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label="Search tenants"
            placeholder="Search by name or slug"
            className="w-72"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Select value={state ?? DEFAULT_STATE} onValueChange={setState}>
            <SelectTrigger aria-label="Status" className="w-48">
              <SelectValue>
                {(value: string) =>
                  STATE_OPTIONS.find((option) => option.value === value)?.label ?? value
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canCreate && (
            <CreateTenantDialog
              onCreated={(tenant) =>
                void navigate({ to: ROUTES.tenant, params: { tenantId: tenant.id } })
              }
            />
          )}
        </div>
      </div>
      {page.isError ? (
        isRoleDenied(page.error) ? (
          <RoleDenied />
        ) : (
          <div className="grid justify-items-start gap-2">
            <LoadError
              message="We could not load the tenants."
              onRetry={() => void page.refetch()}
            />
            {cursor !== undefined && (
              <Button variant="ghost" size="sm" onClick={firstPage}>
                <ChevronLeft aria-hidden />
                First page
              </Button>
            )}
          </div>
        )
      ) : !settled || page.data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : page.data.tenants.length === 0 ? (
        cursor !== undefined ? (
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
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {q
                  ? `No tenants match “${q}”.`
                  : filtered
                    ? 'No tenants in this state.'
                    : 'No tenants yet.'}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? 'Try part of the name or the slug, or another status.'
                  : 'Tenants appear here once customers or staff create them.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <>
          <div aria-busy={page.isPlaceholderData}>
            <TenantsTable rows={page.data.tenants} />
          </div>
          <nav aria-label="Pagination" className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={page.data.prevCursor === null || page.isPlaceholderData}
              onClick={() => {
                const target = page.data?.prevCursor
                if (target) pageTo(target, 'prev')
              }}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={page.data.nextCursor === null || page.isPlaceholderData}
              onClick={() => {
                const target = page.data?.nextCursor
                if (target) pageTo(target, 'next')
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
