import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { useAuthStore } from '@/states/auth.store'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantRow } from '@/types/api.types'

function row(
  index: number,
  lifecycleState: PlatformTenantRow['lifecycleState'] = 'active'
): PlatformTenantRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Tenant ${String(index).padStart(2, '0')}`,
    slug: `tenant-${index}`,
    lifecycleState,
    memberCount: index,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Page one of the unfiltered list: rows 1–20, row 2 suspended and row 3 archived. */
const PAGE_ONE = Array.from({ length: 20 }, (_, i) =>
  row(i + 1, i === 1 ? 'suspended' : i === 2 ? 'archived' : 'active')
)

/** Two pages: rows 1–20 then 21–25. Records every request's query. */
function twoPages(seen: URLSearchParams[]) {
  server.use(
    http.get('/api/v1/platform/tenants', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'page-2') {
        return ok(
          { tenants: [21, 22, 23, 24, 25].map((n) => row(n)), nextCursor: null },
          'Tenants retrieved.'
        )
      }
      return ok({ tenants: PAGE_ONE, nextCursor: 'page-2' }, 'Tenants retrieved.')
    })
  )
}

/** A promise the test resolves by hand, to hold a response in flight. */
function deferred() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('/tenants', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('lists a page of tenants with a status badge per row', async () => {
    twoPages([])
    renderAppAt('/tenants')
    const table = await screen.findByRole('table', { name: 'Tenants' })
    expect(within(table).getAllByRole('row')).toHaveLength(21)
    expect(within(table).getByText('Suspended')).toBeInTheDocument()
    expect(within(table).getByText('Archived')).toBeInTheDocument()
    expect(within(table).getAllByText('Active')).toHaveLength(18)
    const first = within(table).getAllByRole('row')[1]!
    expect(within(first).getByText('tenant-1')).toBeInTheDocument()
    expect(within(first).getByText('Jan 1, 2026')).toBeInTheDocument()
  })

  it('pages forward with the cursor and back again', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Tenant 21')).toBeInTheDocument()
    expect(seen.at(-1)?.get('cursor')).toBe('page-2')
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('searches through ?q and starts again from the first page', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Tenant 21')

    await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'acme')

    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'acme' }))
    await waitFor(() => expect(seen.at(-1)?.get('q')).toBe('acme'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
    expect(await screen.findByText('Page 1')).toBeInTheDocument()
  })

  it('starts on page one again after searching and clearing the search', async () => {
    twoPages([])
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Tenant 21')
    const box = screen.getByRole('searchbox', { name: 'Search tenants' })

    await user.type(box, 'acme')
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'acme' }))
    await user.clear(box)
    await waitFor(() => expect(router.state.location.search).toEqual({}))

    expect(await screen.findByText('Page 1')).toBeInTheDocument()
    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
    expect(screen.queryByText('Tenant 21')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('keeps a keystroke typed while its own search navigation is still landing', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    const box = screen.getByRole('searchbox', { name: 'Search tenants' })
    // Typed in the gap between the debounce's navigate and the new `?q` reaching the page.
    const unsubscribe = router.subscribe('onBeforeNavigate', ({ toLocation }) => {
      if ((toLocation.search as { q?: string }).q !== 'acme') return
      unsubscribe()
      // The navigate is called from an effect; React must finish that commit before the keystroke.
      queueMicrotask(() => fireEvent.change(box, { target: { value: 'acmex' } }))
    })

    await user.type(box, 'acme')

    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'acmex' }))
    expect(box).toHaveValue('acmex')
    await waitFor(() => expect(seen.at(-1)?.get('q')).toBe('acmex'))
  })

  it('numbers the page whose rows are on screen while the next one loads', async () => {
    const pageTwo = deferred()
    server.use(
      http.get('/api/v1/platform/tenants', async ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') === 'page-2') {
          await pageTwo.promise
          return ok({ tenants: [row(21)], nextCursor: null }, 'Tenants retrieved.')
        }
        return ok({ tenants: PAGE_ONE, nextCursor: 'page-2' }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')
    await screen.findByText('Tenant 01')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(screen.getByText('Tenant 01')).toBeInTheDocument()

    pageTwo.release()
    expect(await screen.findByText('Tenant 21')).toBeInTheDocument()
    expect(screen.getByText('Page 2')).toBeInTheDocument()
  })

  it('keeps a way back to the first page when a later page fails', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'page-2'
          ? fail('Boom', 500)
          : ok({ tenants: PAGE_ONE, nextCursor: 'page-2' }, 'Tenants retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')
    await screen.findByText('Tenant 01')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
    expect(screen.getByText('Page 1')).toBeInTheDocument()
  })

  it('offers no way back from a failed first page', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => fail('Boom', 500)))
    renderAppAt('/tenants')
    await screen.findByRole('button', { name: 'Try again' })
    expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument()
  })

  it('drops ?q when the search is cleared', async () => {
    twoPages([])
    const user = userEvent.setup()
    const router = renderAppAt('/tenants?q=acme')
    await screen.findByText('Tenant 01')

    await user.clear(screen.getByRole('searchbox', { name: 'Search tenants' }))

    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('opens pre-filtered from ?q', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    renderAppAt('/tenants?q=Acme%20Corp')
    expect(await screen.findByRole('searchbox', { name: 'Search tenants' })).toHaveValue(
      'Acme Corp'
    )
    await waitFor(() => expect(seen.at(-1)?.get('q')).toBe('Acme Corp'))
  })

  it('follows ?q when it changes under the page, as the palette does, without reverting it', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const router = renderAppAt('/tenants?q=acme')
    await screen.findByText('Tenant 01')

    await router.navigate({ to: '/tenants', search: { q: 'Beta' } })

    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Search tenants' })).toHaveValue('Beta')
    )
    await waitFor(() => expect(seen.at(-1)?.get('q')).toBe('Beta'))
    // A revert would come from the search box's debounce firing with the old term; nothing observable marks that it did not.
    await settle(SEARCH_DEBOUNCE_MS * 2, 'the debounce window a stale term would navigate in')
    expect(router.state.location.search).toEqual({ q: 'Beta' })
  })

  it('never paints the old term’s next page under a new term', async () => {
    const pageTwo = deferred()
    server.use(
      http.get('/api/v1/platform/tenants', async ({ request }) => {
        const params = new URL(request.url).searchParams
        if (params.get('q') === 'acme') {
          return ok(
            { tenants: [{ ...row(9), name: 'Acme Corp', slug: 'acme' }], nextCursor: null },
            'Tenants retrieved.'
          )
        }
        if (params.get('cursor') === 'page-2') {
          await pageTwo.promise
          return ok({ tenants: [row(21)], nextCursor: null }, 'Tenants retrieved.')
        }
        return ok({ tenants: PAGE_ONE, nextCursor: 'page-2' }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')
    await screen.findByText('Tenant 01')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    // Page two is in flight: the old page stays up, but nothing can page from it.
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'acme')
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    pageTwo.release()

    await waitFor(() => expect(screen.getByText('Page 1')).toBeInTheDocument())
    expect(screen.queryByText('Tenant 21')).not.toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('says nothing matches, rather than showing an empty table', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [], nextCursor: null }, 'Tenants retrieved.')
      )
    )
    renderAppAt('/tenants?q=zzz')
    expect(await screen.findByText('No tenants match “zzz”.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('does not say the next term matches nothing while its page is still loading', async () => {
    const beta = deferred()
    server.use(
      http.get('/api/v1/platform/tenants', async ({ request }) => {
        if (new URL(request.url).searchParams.get('q') === 'zzzb') {
          await beta.promise
          return ok({ tenants: [row(7)], nextCursor: null }, 'Tenants retrieved.')
        }
        return ok({ tenants: [], nextCursor: null }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/tenants?q=zzz')
    await screen.findByText('No tenants match “zzz”.')

    await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'b')
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'zzzb' }))

    await waitFor(() => expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull())
    expect(screen.queryByText(/No tenants match/)).not.toBeInTheDocument()
    beta.release()
    expect(await screen.findByText('Tenant 07')).toBeInTheDocument()
  })

  it('says there are no tenants yet when nothing is searched', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [], nextCursor: null }, 'Tenants retrieved.')
      )
    )
    renderAppAt('/tenants')
    expect(await screen.findByText('No tenants yet.')).toBeInTheDocument()
  })

  it('offers a retry when the search fails, and the retry asks again', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return calls <= 2
          ? fail('Boom', 500)
          : ok({ tenants: PAGE_ONE, nextCursor: null }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
  })

  it('shows the role-denied state for a 404', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => fail('Not found', 404)))
    renderAppAt('/tenants')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
