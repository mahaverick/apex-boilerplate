import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useAuthStore } from '@/states/auth.store'
import { byContent } from '@/tests/fixtures/content'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail, PlatformTenantRow } from '@/types/api.types'
import { LIST_SEARCH_DEBOUNCE_MS } from '@/types/list.types'

/** A tenant row numbered `index`: named "Tenant NN" with `index` members, on Paid unless given. */
function row(
  index: number,
  lifecycleState: PlatformTenantRow['lifecycleState'] = 'active',
  billingState: PlatformTenantRow['billingState'] = 'active'
): PlatformTenantRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Tenant ${String(index).padStart(2, '0')}`,
    slug: `tenant-${index}`,
    lifecycleState,
    memberCount: index,
    createdAt: '2026-01-01T00:00:00.000Z',
    billingState,
    planKey: billingState === null ? null : billingState === 'free' ? 'free' : 'paid',
  }
}

/** Page one of the unfiltered list: rows 1–20, row 2 suspended and row 3 archived. */
const PAGE_ONE = Array.from({ length: 20 }, (_, i) =>
  row(i + 1, i === 1 ? 'suspended' : i === 2 ? 'archived' : 'active')
)

/** The detail `POST /platform/tenants` answers with, and the new tenant's page reads. */
const CREATED: PlatformTenantDetail = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  website: null,
  logo: null,
  lifecycleState: 'active',
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
  deletedAt: null,
  settings: { timezone: 'UTC', locale: 'en' },
  memberCount: 0,
  owners: [],
  pendingInvitationCount: 1,
  pendingOwnerInvitation: {
    id: '40000000-0000-4000-8000-000000000001',
    email: 'owner@acme.test',
    expiresAt: '2026-10-06T00:00:00.000Z',
  },
}

/** Two pages: rows 1–20 then 21–25, linked both ways. Records every request's query. */
function twoPages(seen: URLSearchParams[]) {
  server.use(
    http.get('/api/v1/platform/tenants', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'page-2') {
        return ok(
          listPage(
            [21, 22, 23, 24, 25].map((n) => row(n)),
            { prevCursor: 'page-1', hasPrev: true }
          ),
          'Tenants retrieved.'
        )
      }
      return ok(
        listPage(PAGE_ONE, { nextCursor: 'page-2', hasNext: true }, { count: 25, capped: false }),
        'Tenants retrieved.'
      )
    })
  )
}

/** A promise the test resolves by hand, to hold a response in flight. */
function deferred() {
  /** Resolves `promise`. */
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
    expect(within(first).getByRole('link', { name: 'Tenant 01' })).toHaveAttribute(
      'href',
      '/tenants/00000000-0000-4000-8000-000000000001'
    )
  })

  it('sorts by name by default and by creation date from the header', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    const table = await screen.findByRole('table', { name: 'Tenants' })
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
    await user.click(within(table).getByRole('button', { name: 'Created' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'created' }))
    await waitFor(() => expect(seen.at(-1)?.get('sort')).toBe('created'))
  })

  it('filters by state through a comma list', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    await user.click(screen.getByRole('button', { name: 'Filter by status, Tenants' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Tenants' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Suspended' }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Archived' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ state: 'archived,suspended' })
    )
    await waitFor(() => expect(seen.at(-1)?.get('state')).toBe('archived,suspended'))
  })

  it('shows each tenant’s plan badge', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok(
          listPage([
            row(1, 'active', 'trialing'),
            row(2, 'active', 'free'),
            row(3, 'active', 'active'),
            row(4, 'suspended', 'past_due'),
          ]),
          'Tenants retrieved.'
        )
      )
    )
    renderAppAt('/tenants')
    const table = await screen.findByRole('table', { name: 'Tenants' })
    expect(within(table).getByRole('columnheader', { name: 'Plan' })).toBeInTheDocument()
    const rows = within(table).getAllByRole('row').slice(1)
    const badges = rows.map((tableRow) => {
      const badge = within(tableRow).getByText(/^(Trial|Free|Paid|Payment failed)$/)
      return [badge.textContent, badge.dataset.tone]
    })
    expect(badges).toEqual([
      ['Trial', 'neutral'],
      ['Free', 'muted'],
      ['Paid', 'success'],
      ['Payment failed', 'warning'],
    ])
  })

  it('shows a dash for a tenant with no billing record', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok(listPage([row(1, 'active', null)]), 'Tenants retrieved.')
      )
    )
    renderAppAt('/tenants')
    const table = await screen.findByRole('table', { name: 'Tenants' })
    const tableRow = within(table).getAllByRole('row')[1]!
    expect(within(tableRow).getByText('—')).toHaveAttribute('aria-hidden', 'true')
    expect(within(tableRow).getByText('No billing')).toBeInTheDocument()
    expect(within(tableRow).queryByText(/^(Trial|Free|Paid|Payment failed)$/)).toBeNull()
  })

  it('filters by Payment failed with billingState=past_due', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    await user.click(screen.getByRole('button', { name: 'Filter by plan, Tenants' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by plan, Tenants' })
    expect(within(popup).getAllByRole('checkbox')).toHaveLength(4)
    for (const name of ['Trial', 'Free', 'Paid', 'Payment failed']) {
      expect(within(popup).getByRole('checkbox', { name })).toBeInTheDocument()
    }
    await user.click(within(popup).getByRole('checkbox', { name: 'Payment failed' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ billingState: 'past_due' }))
    await waitFor(() => expect(seen.at(-1)?.get('billingState')).toBe('past_due'))
    expect(seen.at(-1)?.get('state')).toBeNull()
  })

  it('sends no billingState for the default view and ignores a bogus one', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const router = renderAppAt('/tenants?billingState=bogus')
    await screen.findByText('Tenant 01')
    expect(seen.at(-1)?.has('billingState')).toBe(false)
    expect(router.state.location.search).toEqual({})
  })

  it('drops the cursor when a filter changes', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants?cursor=page-2')
    await screen.findByText('Tenant 21')

    await user.click(screen.getByRole('button', { name: 'Filter by status, Tenants' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Tenants' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Archived' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'archived' }))
    await waitFor(() => expect(seen.at(-1)?.get('state')).toBe('archived'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('pages forward and back through the API’s cursors, kept in the URL', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(seen.at(-1)?.get('direction')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Tenant 21')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ cursor: 'page-2' })
    expect(seen.at(-1)?.get('cursor')).toBe('page-2')
    expect(seen.at(-1)?.get('direction')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ cursor: 'page-1', direction: 'prev' })
    expect(seen.at(-1)?.get('direction')).toBe('prev')
  })

  it('opens on the page a shared URL names', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    renderAppAt('/tenants?cursor=page-2')
    expect(await screen.findByText('Tenant 21')).toBeInTheDocument()
    expect(seen[0]?.get('cursor')).toBe('page-2')
  })

  it('searches through ?search and starts again from the first page', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Tenant 21')

    await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'acme')

    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'acme' }))
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('acme'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
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
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'acme' }))
    await user.clear(box)
    await waitFor(() => expect(router.state.location.search).toEqual({}))

    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
    expect(screen.queryByText('Tenant 21')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('keeps the current rows, marked busy, with paging off while the next page loads', async () => {
    const pageTwo = deferred()
    server.use(
      http.get('/api/v1/platform/tenants', async ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') === 'page-2') {
          await pageTwo.promise
          return ok(listPage([row(21)], { prevCursor: 'page-1', hasPrev: true }), 'ok')
        }
        return ok(listPage(PAGE_ONE, { nextCursor: 'page-2', hasNext: true }), 'ok')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')
    await screen.findByText('Tenant 01')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Tenant 01')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Tenants' }).closest('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    pageTwo.release()
    expect(await screen.findByText('Tenant 21')).toBeInTheDocument()
  })

  it('keeps a way back to the first page when a later page fails', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'page-2'
          ? fail('Boom', 500)
          : ok(listPage(PAGE_ONE, { nextCursor: 'page-2', hasNext: true }), 'ok')
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/tenants?search=t')
    await screen.findByText('Tenant 01')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'First page' }))
    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ search: 't' })
  })

  it('offers no way back from a failed first page, and names the load failure', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => fail('Boom', 500)))
    renderAppAt('/tenants')
    await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText('We couldn’t load the tenants. Select Try again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'First page' })).not.toBeInTheDocument()
  })

  it('opens pre-filtered from ?search', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    renderAppAt('/tenants?search=Acme%20Corp')
    expect(await screen.findByRole('searchbox', { name: 'Search tenants' })).toHaveValue(
      'Acme Corp'
    )
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('Acme Corp'))
  })

  it('follows ?search when it changes under the page, as the palette does, without reverting it', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const router = renderAppAt('/tenants?search=acme')
    await screen.findByText('Tenant 01')

    await router.navigate({ to: '/tenants', search: { search: 'Beta' } })

    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Search tenants' })).toHaveValue('Beta')
    )
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('Beta'))
    // A revert would come from the search box's debounce firing with the old term, and nothing observable marks that it did not.
    await settle(LIST_SEARCH_DEBOUNCE_MS * 2, 'the debounce window a stale term would navigate in')
    expect(router.state.location.search).toEqual({ search: 'Beta' })
  })

  it('says nothing matches, rather than showing an empty table', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => ok(listPage([]), 'Tenants retrieved.')))
    renderAppAt('/tenants?search=zzz')
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('does not say the next term matches nothing while its page is still loading', async () => {
    const beta = deferred()
    server.use(
      http.get('/api/v1/platform/tenants', async ({ request }) => {
        if (new URL(request.url).searchParams.get('search') === 'zzzb') {
          await beta.promise
          return ok(listPage([row(7)]), 'Tenants retrieved.')
        }
        return ok(listPage([]), 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/tenants?search=zzz')
    await screen.findByText('Nothing matches these filters.')

    await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'b')
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'zzzb' }))

    await waitFor(() => expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull())
    expect(screen.queryByText('Nothing matches these filters.')).not.toBeInTheDocument()
    beta.release()
    expect(await screen.findByText('Tenant 07')).toBeInTheDocument()
  })

  it('offers the first page again when a later page comes back empty', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'gone'
          ? ok(listPage([]), 'Tenants retrieved.')
          : ok(listPage(PAGE_ONE), 'Tenants retrieved.')
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/tenants?state=archived&cursor=gone')
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'archived' }))
    expect(await screen.findByText('Tenant 01')).toBeInTheDocument()
  })

  it('says there are no tenants yet when nothing is searched', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => ok(listPage([]), 'Tenants retrieved.')))
    renderAppAt('/tenants')
    expect(await screen.findByText('No tenants yet.')).toBeInTheDocument()
  })

  it('offers a retry when the search fails, and the retry asks again', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : ok(listPage(PAGE_ONE), 'Tenants retrieved.')
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

  it('searches a numeric term instead of dropping it (?search=2026)', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('search'))
        return ok(listPage([]), 'ok')
      })
    )
    renderAppAt('/tenants?search=2026')
    await waitFor(() => expect(seen).toContain('2026'))
    expect(screen.getByRole('searchbox', { name: /search tenants/i })).toHaveValue('2026')
  })

  it('sends no state for the default view and ignores a bogus one', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const router = renderAppAt('/tenants?state=bogus')
    await screen.findByText('Tenant 01')
    expect(seen.at(-1)?.get('state')).toBeNull()
    expect(router.state.location.search).toEqual({})
  })

  it('searching keeps the state filter', async () => {
    const seen: URLSearchParams[] = []
    twoPages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/tenants?state=suspended')
    await screen.findByText('Tenant 01')
    await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'acme')
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'acme', state: 'suspended' })
    )
  })

  it('hides New tenant from a viewer', async () => {
    twoPages([])
    renderAppAt('/tenants')
    await screen.findByText('Tenant 01')
    expect(screen.queryByRole('button', { name: 'New tenant' })).not.toBeInTheDocument()
  })

  it('shows New tenant to a platform owner', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    twoPages([])
    renderAppAt('/tenants')
    expect(await screen.findByRole('button', { name: 'New tenant' })).toBeInTheDocument()
  })

  describe('New tenant', () => {
    beforeEach(() => signIn({ ...testUser, platformRole: 'admin' }))

    it('creates the tenant and says the owner invitation went out', async () => {
      twoPages([])
      let body: unknown
      server.use(
        http.get('/api/v1/platform/tenants/10000000-0000-4000-8000-000000000001', () =>
          ok(CREATED, 'Tenant retrieved.')
        ),
        http.post('/api/v1/platform/tenants', async ({ request }) => {
          body = await request.json()
          return ok(
            {
              tenant: {
                id: '10000000-0000-4000-8000-000000000001',
                name: 'Acme Corp',
                slug: 'acme',
                description: null,
                website: null,
                logo: null,
                lifecycleState: 'active',
                createdAt: '2026-09-29T00:00:00.000Z',
                updatedAt: '2026-09-29T00:00:00.000Z',
                deletedAt: null,
                settings: { timezone: 'UTC', locale: 'en' },
                memberCount: 0,
                owners: [],
                pendingInvitationCount: 1,
                pendingOwnerInvitation: {
                  id: '40000000-0000-4000-8000-000000000001',
                  email: 'owner@acme.test',
                  expiresAt: '2026-10-06T00:00:00.000Z',
                },
              },
              emailSent: true,
            },
            'Tenant created.',
            201
          )
        })
      )
      const user = userEvent.setup()
      const router = renderAppAt('/tenants')
      await screen.findByText('Tenant 01')

      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Acme Corp')
      await user.type(within(dialog).getByLabelText('Slug'), 'acme')
      await user.type(within(dialog).getByLabelText('Owner email'), 'Owner@Acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      expect(
        await screen.findByText(byContent(/Owner invitation sent to owner@acme.test/))
      ).toBeInTheDocument()
      expect(body).toEqual({ name: 'Acme Corp', slug: 'acme', ownerEmail: 'owner@acme.test' })
      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/tenants/10000000-0000-4000-8000-000000000001')
      )
    })

    it('puts a taken slug on the slug field', async () => {
      twoPages([])
      server.use(
        http.post('/api/v1/platform/tenants', () =>
          fail('That slug is already taken', 409, 'slug_taken')
        )
      )
      const user = userEvent.setup()
      renderAppAt('/tenants')
      await screen.findByText('Tenant 01')
      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Acme')
      await user.type(within(dialog).getByLabelText('Slug'), 'acme')
      await user.type(within(dialog).getByLabelText('Owner email'), 'o@acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      expect(await within(dialog).findByText('That slug is already taken')).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Slug')).toHaveAttribute('aria-invalid', 'true')
    })

    it('puts a deactivated owner account on the owner email field', async () => {
      twoPages([])
      server.use(
        http.post('/api/v1/platform/tenants', () =>
          fail('That account is deactivated', 409, 'invitee_deactivated')
        )
      )
      const user = userEvent.setup()
      renderAppAt('/tenants')
      await screen.findByText('Tenant 01')
      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Acme')
      await user.type(within(dialog).getByLabelText('Slug'), 'acme')
      await user.type(within(dialog).getByLabelText('Owner email'), 'o@acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      expect(await within(dialog).findByText('That account is deactivated')).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Owner email')).toHaveAttribute('aria-invalid', 'true')
      expect(within(dialog).getByLabelText('Slug')).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('puts any other 409 on the form', async () => {
      twoPages([])
      server.use(http.post('/api/v1/platform/tenants', () => fail('Conflict happened', 409)))
      const user = userEvent.setup()
      renderAppAt('/tenants')
      await screen.findByText('Tenant 01')
      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Acme')
      await user.type(within(dialog).getByLabelText('Slug'), 'acme')
      await user.type(within(dialog).getByLabelText('Owner email'), 'o@acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      expect(await within(dialog).findByText('Conflict happened')).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Slug')).not.toHaveAttribute('aria-invalid', 'true')
      expect(within(dialog).getByLabelText('Owner email')).not.toHaveAttribute(
        'aria-invalid',
        'true'
      )
    })

    it('refuses a reserved slug before asking the API', async () => {
      twoPages([])
      let posted = false
      server.use(
        http.post('/api/v1/platform/tenants', () => {
          posted = true
          return ok(null)
        })
      )
      const user = userEvent.setup()
      renderAppAt('/tenants')
      await screen.findByText('Tenant 01')
      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Platform')
      await user.type(within(dialog).getByLabelText('Slug'), 'platform')
      await user.type(within(dialog).getByLabelText('Owner email'), 'o@acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      expect(
        await within(dialog).findByText('This slug is reserved and cannot be used.')
      ).toBeInTheDocument()
      expect(posted).toBe(false)
    })

    it('warns, still closes, and opens the tenant, when the invitation email failed', async () => {
      twoPages([])
      server.use(
        http.get('/api/v1/platform/tenants/10000000-0000-4000-8000-000000000001', () =>
          ok({ ...CREATED, name: 'Acme', pendingOwnerInvitation: null }, 'Tenant retrieved.')
        ),
        http.post('/api/v1/platform/tenants', () =>
          ok(
            {
              tenant: {
                id: '10000000-0000-4000-8000-000000000001',
                name: 'Acme',
                slug: 'acme',
                description: null,
                website: null,
                logo: null,
                lifecycleState: 'active',
                createdAt: '2026-09-29T00:00:00.000Z',
                updatedAt: '2026-09-29T00:00:00.000Z',
                deletedAt: null,
                settings: { timezone: 'UTC', locale: 'en' },
                memberCount: 0,
                owners: [],
                pendingInvitationCount: 1,
                pendingOwnerInvitation: null,
              },
              emailSent: false,
            },
            'Tenant created.',
            201
          )
        )
      )
      const user = userEvent.setup()
      renderAppAt('/tenants')
      await screen.findByText('Tenant 01')
      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Acme')
      await user.type(within(dialog).getByLabelText('Slug'), 'acme')
      await user.type(within(dialog).getByLabelText('Owner email'), 'o@acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      expect(
        await screen.findByText(
          'Tenant created, but the owner invitation email wasn’t sent. Resend it from the tenant’s Actions menu.'
        )
      ).toBeInTheDocument()
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      // The page it lands on offers exactly that.
      await user.click(await screen.findByRole('button', { name: 'Actions' }))
      expect(
        await screen.findByRole('menuitem', { name: 'Resend owner invitation' })
      ).toBeInTheDocument()
    })

    it('focuses the new tenant’s heading after New tenant', async () => {
      twoPages([])
      server.use(
        http.get(`/api/v1/platform/tenants/${CREATED.id}`, () => ok(CREATED, 'Tenant retrieved.')),
        http.post('/api/v1/platform/tenants', () =>
          ok({ tenant: CREATED, emailSent: true }, 'Tenant created.', 201)
        )
      )
      const user = userEvent.setup()
      renderAppAt('/tenants')
      await screen.findByText('Tenant 01')
      await user.click(screen.getByRole('button', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Acme Corp')
      await user.type(within(dialog).getByLabelText('Slug'), 'acme')
      await user.type(within(dialog).getByLabelText('Owner email'), 'owner@acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

      const heading = await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      await waitFor(() => expect(heading).toHaveFocus())
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      expect(heading).toHaveFocus()
    })

    it('returns focus to New tenant when the dialog is closed without creating', async () => {
      twoPages([])
      const user = userEvent.setup()
      renderAppAt('/tenants')
      await screen.findByText('Tenant 01')
      const button = screen.getByRole('button', { name: 'New tenant' })
      await user.click(button)
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(button).toHaveFocus())
    })
  })
})
