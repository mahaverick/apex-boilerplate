import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { CreateUserDialog } from '@/components/features/users/create-user-dialog'
import { UsersTable } from '@/components/features/users/users-table'
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
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { isRoleDenied, SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { platformUsersQueryOptions, type UserSearchParams } from '@/queries/user-admin.queries'
import { searchText } from '@/schemas/search.schemas'
import { useAuthStore } from '@/states/auth.store'
import {
  PAGE_DIRECTIONS,
  USER_STATUS_FILTERS,
  type PageDirection,
  type UserStatusFilter,
} from '@/types/api.types'

const usersSearchSchema = z.object({
  q: searchText,
  status: z.enum(USER_STATUS_FILTERS).optional().catch(undefined),
  // The router JSON-parses search values, so `?verified=true` is already a boolean here.
  verified: z.boolean().optional().catch(undefined),
  staff: z.boolean().optional().catch(undefined),
  cursor: z.string().optional().catch(undefined),
  dir: z.enum(PAGE_DIRECTIONS).optional().catch(undefined),
})

type UsersSearch = z.infer<typeof usersSearchSchema>

function toParams(search: UsersSearch): UserSearchParams {
  return {
    q: search.q,
    status: search.status,
    verified: search.verified,
    staff: search.staff,
    cursor: search.cursor,
    direction: search.dir,
  }
}

export const Route = createFileRoute('/_app/users/')({
  validateSearch: usersSearchSchema,
  loaderDeps: ({ search }) => toParams(search),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(platformUsersQueryOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Users') }] }),
  staticData: { crumb: 'Users' },
  component: UsersPage,
})

/** The select value meaning "no filter". */
const ANY = 'any'

/** A filter's options, the URL value each maps to, and its label. */
const STATUS_OPTIONS = [
  [ANY, 'Any status'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['deleted', 'Deleted'],
] as const
const VERIFIED_OPTIONS = [
  [ANY, 'Verified or not'],
  ['true', 'Verified'],
  ['false', 'Unverified'],
] as const
const STAFF_OPTIONS = [
  [ANY, 'Staff or not'],
  ['true', 'Staff'],
  ['false', 'Not staff'],
] as const

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (value: string) => void
}) {
  const labelOf = (current: string) =>
    options.find(([option]) => option === current)?.[1] ?? options[0]![1]
  return (
    <Select value={value} onValueChange={(next: string | null) => onChange(next ?? ANY)}>
      <SelectTrigger aria-label={label} className="w-40">
        <SelectValue>{(current: string) => labelOf(current)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([option, text]) => (
          <SelectItem key={option} value={option}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The search without its page: a cursor belongs to the list it was cut from. */
type FilterSearch = Omit<UsersSearch, 'cursor' | 'dir'>

/**
 * The filters of `search` with the page and every unset or blank one left out,
 * so the URL carries only what narrows the list.
 */
function firstPageOf(search: UsersSearch): FilterSearch {
  const { q, status, verified, staff } = search
  return {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(verified === undefined ? {} : { verified }),
    ...(staff === undefined ? {} : { staff }),
  }
}

const asBoolean = (value: string) => (value === ANY ? undefined : value === 'true')
const fromBoolean = (value: boolean | undefined) => (value === undefined ? ANY : String(value))

/**
 * Every user, filtered in the URL. Pages are the API's keyset cursors, both
 * directions, carried in `?cursor`/`?dir` so a page can be linked; any change
 * of search or filter drops them and starts again from the first page.
 */
function UsersPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const role = useAuthStore((state) => state.user?.platformRole)
  const q = search.q ?? ''
  const [draft, setDraft] = useState(q)
  const [followed, setFollowed] = useState(q)
  const term = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)
  const page = useQuery(platformUsersQueryOptions(toParams(search)))

  // A `?q` set under the page (Back, a link) fills the box; one this page navigated to is the debounced term, and the box may already hold newer keystrokes.
  if (q !== followed) {
    setFollowed(q)
    if (q !== draft.trim() && q !== term.trim()) setDraft(q)
  }

  /** New filters: every change starts from the first page, so the cursor goes. */
  function filter(next: Partial<FilterSearch>) {
    void navigate({ search: (prev) => firstPageOf({ ...prev, ...next }) })
  }

  useEffect(() => {
    const next = term.trim()
    if (term !== draft || next === q) return
    void navigate({
      search: (prev) => firstPageOf({ ...prev, q: next === '' ? undefined : next }),
      replace: true,
    })
  }, [term, draft, q, navigate])

  function goTo(cursor: string | null, dir: PageDirection) {
    if (cursor) void navigate({ search: (prev) => ({ ...prev, cursor, dir }) })
  }

  const firstPage = () => filter({})

  // The previous view's rows stay up while the next loads; its "nothing matches" would describe the wrong view.
  const settled =
    page.data !== undefined && !(page.isPlaceholderData && page.data.users.length === 0)

  const filtered =
    q !== '' ||
    search.status !== undefined ||
    search.verified !== undefined ||
    search.staff !== undefined

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Users</h1>
        {platformRoleAtLeast(role, 'admin') && <CreateUserDialog />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search users"
          placeholder="Search by email or name"
          className="w-72"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <FilterSelect
          label="Filter by status"
          value={search.status ?? ANY}
          options={STATUS_OPTIONS}
          onChange={(value) =>
            filter({ status: value === ANY ? undefined : (value as UserStatusFilter) })
          }
        />
        <FilterSelect
          label="Filter by verification"
          value={fromBoolean(search.verified)}
          options={VERIFIED_OPTIONS}
          onChange={(value) => filter({ verified: asBoolean(value) })}
        />
        <FilterSelect
          label="Filter by staff"
          value={fromBoolean(search.staff)}
          options={STAFF_OPTIONS}
          onChange={(value) => filter({ staff: asBoolean(value) })}
        />
      </div>
      {page.isError ? (
        isRoleDenied(page.error) ? (
          <RoleDenied />
        ) : (
          <div className="grid justify-items-start gap-2">
            <LoadError message="We could not load the users." onRetry={() => void page.refetch()} />
            {search.cursor !== undefined && (
              <Button variant="ghost" size="sm" onClick={firstPage}>
                <ChevronLeft aria-hidden />
                First page
              </Button>
            )}
          </div>
        )
      ) : !settled || page.data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : page.data.users.length === 0 && search.cursor !== undefined ? (
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
      ) : page.data.users.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{filtered ? 'No users match these filters.' : 'No users yet.'}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? 'Try fewer filters, or part of the email.'
                : 'Users appear here once they sign up or staff create them.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div aria-busy={page.isPlaceholderData}>
            <UsersTable rows={page.data.users} />
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
