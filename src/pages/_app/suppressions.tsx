import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { RoleDenied } from '@/components/features/role-denied'
import { SuppressionsTable } from '@/components/features/suppressions/suppressions-table'
import { Pii } from '@/components/shared/pii'
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
import { useFocusAfter } from '@/hooks/use-focus-after'
import { analyticsKey, track } from '@/observability/analytics'
import {
  emailSuppressionsQueryOptions,
  useLiftSuppression,
  type SuppressionSearchParams,
} from '@/queries/email.queries'
import { isRoleDenied, SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { searchText } from '@/schemas/search.schemas'
import { useAuthStore } from '@/states/auth.store'
import {
  PAGE_DIRECTIONS,
  SUPPRESSION_STATE_FILTERS,
  type EmailSuppression,
  type PageDirection,
  type SuppressionStateFilter,
} from '@/types/api.types'

const suppressionsSearchSchema = z.object({
  q: searchText,
  state: z.enum(SUPPRESSION_STATE_FILTERS).optional().catch(undefined),
  cursor: z.string().optional().catch(undefined),
  dir: z.enum(PAGE_DIRECTIONS).optional().catch(undefined),
})

type SuppressionsSearch = z.infer<typeof suppressionsSearchSchema>

function toParams(search: SuppressionsSearch): SuppressionSearchParams {
  return { q: search.q, state: search.state, cursor: search.cursor, direction: search.dir }
}

/** This list, as `table_filtered` names it. */
const TABLE = analyticsKey('suppressions')

export const Route = createFileRoute('/_app/suppressions')({
  validateSearch: suppressionsSearchSchema,
  loaderDeps: ({ search }) => toParams(search),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(emailSuppressionsQueryOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Suppressions') }] }),
  staticData: { crumb: 'Suppressions' },
  component: SuppressionsPage,
})

/** The state filter's options and labels; `active` is the API's default, so the URL leaves it out. */
const STATE_OPTIONS = [
  ['active', 'Active'],
  ['lifted', 'Lifted'],
  ['all', 'Active and lifted'],
] as const satisfies readonly (readonly [SuppressionStateFilter, string])[]

/** What an empty first page says, per state, when no search narrows it. */
const EMPTY_BY_STATE = {
  active: {
    title: 'No suppressed addresses.',
    description: 'An address is suppressed after a hard bounce or a spam complaint.',
  },
  lifted: { title: 'No lifted suppressions.', description: 'Lifted suppressions are kept here.' },
  all: {
    title: 'No suppressions yet.',
    description: 'An address is suppressed after a hard bounce or a spam complaint.',
  },
} as const satisfies Record<SuppressionStateFilter, { title: string; description: string }>

/** The search without its page: a cursor belongs to the list it was cut from. */
type FilterSearch = Omit<SuppressionsSearch, 'cursor' | 'dir'>

/** The filters of `search`, blank and default ones left out, so the URL carries only what narrows the list. */
function firstPageOf(search: SuppressionsSearch): FilterSearch {
  const { q, state } = search
  return {
    ...(q ? { q } : {}),
    ...(state && state !== 'active' ? { state } : {}),
  }
}

/**
 * Addresses that no email is sent to: each hard bounce or spam complaint
 * suppresses its address until staff lift it. Filtered and paged in the URL,
 * as on the Users page. Admins lift a suppression with a reason; the API's
 * own refusal (already lifted, a role that changed) shows in the dialog.
 */
function SuppressionsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const role = useAuthStore((state) => state.user?.platformRole)
  const canLift = platformRoleAtLeast(role, 'admin')
  const focus = useFocusAfter<'heading' | `suppression:${string}`>()
  const opener = useRef<HTMLElement | null>(null)
  const q = search.q ?? ''
  const [draft, setDraft] = useState(q)
  const [followed, setFollowed] = useState(q)
  const term = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)
  const page = useQuery(emailSuppressionsQueryOptions(toParams(search)))
  const lift = useLiftSuppression()
  const [lifting, setLifting] = useState<EmailSuppression | null>(null)
  const openLift = useCallback((row: EmailSuppression, button: HTMLButtonElement) => {
    opener.current = button
    setLifting(row)
  }, [])

  // A `?q` set under the page (Back, a link) fills the box; one this page navigated to is the debounced term, and the box may already hold newer keystrokes.
  if (q !== followed) {
    setFollowed(q)
    if (q !== draft.trim() && q !== term.trim()) setDraft(q)
  }

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
  const state = search.state ?? 'active'
  const settled =
    page.data !== undefined && !(page.isPlaceholderData && page.data.suppressions.length === 0)

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1
        ref={focus.target('heading')}
        tabIndex={-1}
        className="text-2xl font-semibold outline-none"
      >
        Suppressions
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search suppressions"
          placeholder="Search by address"
          className="w-72"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Select
          value={state}
          onValueChange={(next: string | null) =>
            filter({ state: (next ?? 'active') as SuppressionStateFilter })
          }
        >
          <SelectTrigger aria-label="Filter by state" className="w-44">
            <SelectValue>
              {(current: string) =>
                STATE_OPTIONS.find(([option]) => option === current)?.[1] ?? 'Active'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATE_OPTIONS.map(([option, text]) => (
              <SelectItem key={option} value={option}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {page.isError ? (
        isRoleDenied(page.error) ? (
          <RoleDenied />
        ) : (
          <div className="grid justify-items-start gap-2">
            <LoadError
              message="We could not load the suppressions."
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
      ) : page.data.suppressions.length === 0 && search.cursor !== undefined ? (
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
      ) : page.data.suppressions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {q === '' ? EMPTY_BY_STATE[state].title : 'No suppressions match this search.'}
            </EmptyTitle>
            <EmptyDescription>
              {q === '' ? EMPTY_BY_STATE[state].description : 'Try part of the address.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div aria-busy={page.isPlaceholderData}>
            <SuppressionsTable
              rows={page.data.suppressions}
              onLift={canLift ? openLift : undefined}
              target={(id) => focus.target(`suppression:${id}`)}
            />
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
      <ReasonDialog
        open={lifting !== null}
        onOpenChange={(open) => {
          if (!open) setLifting(null)
        }}
        title="Lift this suppression?"
        description={`Emails to ${lifting?.address ?? 'this address'} are sent again. Another hard bounce or complaint suppresses it again.`}
        confirmLabel="Lift suppression"
        finalFocus={() => focus.finalFocus(opener.current, 'heading')}
        onConfirm={async (reason) => {
          if (lifting === null) return
          await lift.mutateAsync({ id: lifting.id, reason })
          focus.focusAfter([`suppression:${lifting.id}`, 'heading'], opener.current)
          toast.success(<Pii>{`Suppression lifted for ${lifting.address}.`}</Pii>)
        }}
      />
    </div>
  )
}
