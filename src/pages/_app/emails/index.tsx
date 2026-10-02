import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DateRangeFilter } from '@/components/features/emails/date-range-filter'
import { TenantFilterChip, UserFilterChip } from '@/components/features/emails/email-filter-chips'
import { EmailsTable } from '@/components/features/emails/emails-table'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
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
import { EMAIL_STATUS_BADGE, EMAIL_TEMPLATES } from '@/constants/email.constants'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { analyticsKey, track } from '@/observability/analytics'
import { emailsQueryOptions, type EmailSearchParams } from '@/queries/email.queries'
import { isRoleDenied, SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { emailsSearchSchema, type EmailsSearch } from '@/schemas/email.schemas'
import {
  EMAIL_MESSAGE_STATUSES,
  EMAIL_TEMPLATE_KEYS,
  type EmailMessageStatus,
  type EmailTemplateKey,
  type PageDirection,
} from '@/types/api.types'

function toParams(search: EmailsSearch): EmailSearchParams {
  return {
    q: search.q,
    status: search.status,
    template: search.template,
    userId: search.userId,
    tenantId: search.tenantId,
    from: search.from,
    to: search.to,
    cursor: search.cursor,
    direction: search.dir,
  }
}

/** This list, as `table_filtered` names it. */
const TABLE = analyticsKey('emails')

export const Route = createFileRoute('/_app/emails/')({
  validateSearch: emailsSearchSchema,
  loaderDeps: ({ search }) => toParams(search),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(emailsQueryOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Emails') }] }),
  staticData: { crumb: 'Emails' },
  component: EmailsPage,
})

/** The select value meaning "no filter". */
const ANY = 'any'

const STATUS_OPTIONS: readonly (readonly [string, string])[] = [
  [ANY, 'Any status'],
  ...EMAIL_MESSAGE_STATUSES.map((status) => [status, EMAIL_STATUS_BADGE[status].label] as const),
]

const TEMPLATE_OPTIONS: readonly (readonly [string, string])[] = [
  [ANY, 'Any template'],
  ...EMAIL_TEMPLATE_KEYS.map((key) => [key, EMAIL_TEMPLATES[key].label] as const),
]

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
      <SelectTrigger aria-label={label} className="w-44">
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
type FilterSearch = Omit<EmailsSearch, 'cursor' | 'dir'>

/** The filters of `search` with the page and every unset or blank one left out. */
function firstPageOf(search: EmailsSearch): FilterSearch {
  const { q, status, template, userId, tenantId, from, to } = search
  return {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(template ? { template } : {}),
    ...(userId ? { userId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }
}

/**
 * Every tracked email, newest first, filtered in the URL: recipient search,
 * status, template, creation dates, and a user or tenant (reached from their
 * pages, shown as removable chips). Pages are the API's keyset cursors in
 * `?cursor`/`?dir`; any filter change starts again from the first page.
 */
function EmailsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const q = search.q ?? ''
  const [draft, setDraft] = useState(q)
  const [followed, setFollowed] = useState(q)
  const term = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)
  const page = useQuery(emailsQueryOptions(toParams(search)))

  // A `?q` set under the page (Back, a link) fills the box; one this page navigated to is the debounced term, and the box may already hold newer keystrokes.
  if (q !== followed) {
    setFollowed(q)
    if (q !== draft.trim() && q !== term.trim()) setDraft(q)
  }

  /** New filters: every change starts from the first page, so the cursor goes. */
  function filter(next: Partial<FilterSearch>) {
    track('table_filtered', { table: TABLE })
    void navigate({ search: (prev) => firstPageOf({ ...prev, ...next }) })
  }

  useEffect(() => {
    const next = term.trim()
    if (term !== draft || next === q) return
    track('table_filtered', { table: TABLE })
    void navigate({
      search: (prev) => firstPageOf({ ...prev, q: next === '' ? undefined : next }),
      replace: true,
    })
  }, [term, draft, q, navigate])

  function goTo(cursor: string | null, dir: PageDirection) {
    if (cursor) void navigate({ search: (prev) => ({ ...prev, cursor, dir }) })
  }

  const firstPage = () => void navigate({ search: (prev) => firstPageOf(prev) })

  // The previous view's rows stay up while the next loads; its "nothing matches" would describe the wrong view.
  const settled =
    page.data !== undefined && !(page.isPlaceholderData && page.data.messages.length === 0)
  const rows = page.data?.messages ?? []

  const filtered =
    q !== '' ||
    search.status !== undefined ||
    search.template !== undefined ||
    search.userId !== undefined ||
    search.tenantId !== undefined ||
    search.from !== undefined ||
    search.to !== undefined

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="text-2xl font-semibold">Emails</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search emails"
          placeholder="Search by recipient"
          className="w-72"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <FilterSelect
          label="Filter by status"
          value={search.status ?? ANY}
          options={STATUS_OPTIONS}
          onChange={(value) =>
            filter({ status: value === ANY ? undefined : (value as EmailMessageStatus) })
          }
        />
        <FilterSelect
          label="Filter by template"
          value={search.template ?? ANY}
          options={TEMPLATE_OPTIONS}
          onChange={(value) =>
            filter({ template: value === ANY ? undefined : (value as EmailTemplateKey) })
          }
        />
        <DateRangeFilter
          value={{ from: search.from, to: search.to }}
          onChange={({ from, to }) => filter({ from, to })}
        />
      </div>
      {(search.userId !== undefined || search.tenantId !== undefined) && (
        <div className="flex flex-wrap items-center gap-2">
          {search.userId !== undefined && (
            <UserFilterChip
              userId={search.userId}
              knownName={rows.find((row) => row.user?.id === search.userId)?.user?.name}
              onRemove={() => filter({ userId: undefined })}
            />
          )}
          {search.tenantId !== undefined && (
            <TenantFilterChip
              tenantId={search.tenantId}
              knownName={rows.find((row) => row.tenant?.id === search.tenantId)?.tenant?.name}
              onRemove={() => filter({ tenantId: undefined })}
            />
          )}
        </div>
      )}
      {page.isError ? (
        isRoleDenied(page.error) ? (
          <RoleDenied />
        ) : (
          <div className="grid justify-items-start gap-2">
            <LoadError
              message="We could not load the emails."
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
        <Skeleton className="h-96 w-full" />
      ) : rows.length === 0 && search.cursor !== undefined ? (
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
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {filtered ? 'No emails match these filters.' : 'No emails yet.'}
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? 'Try fewer filters, or part of the address.'
                : 'Every email the app sends is listed here, with its delivery status.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div aria-busy={page.isPlaceholderData}>
            <EmailsTable rows={rows} />
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
