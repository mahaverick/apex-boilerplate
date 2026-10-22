import type { RouterHistory } from '@tanstack/react-router'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { navItemsFor } from '@/constants/navigation'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID, TENANT_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import {
  fail,
  ok,
  onboardingTenantRow,
  testOnboardingFunnel,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { OnboardingFunnel, OnboardingTenantRow } from '@/types/api.types'

/** Every tile's label, then its value, then its note, in page order. */
async function tiles(): Promise<[string, string, string][]> {
  const region = await screen.findByRole('region', { name: 'Onboarding figures' })
  /** The text of a card's `slot`, or empty when the card lacks it. */
  const text = (card: Element, slot: string) =>
    card.querySelector(`[data-slot="${slot}"]`)?.textContent ?? ''
  return [...region.querySelectorAll('[data-slot="card"]')].map((card) => [
    text(card, 'card-description'),
    text(card, 'card-title'),
    text(card, 'card-content'),
  ])
}

/**
 * Answers the onboarding funnel with `funnel` laid over the default.
 * @returns The `range` of each request, in order.
 */
function serveFunnel(funnel: Partial<OnboardingFunnel> = {}) {
  const ranges: string[] = []
  server.use(
    http.get('/api/v1/platform/onboarding/funnel', ({ request }) => {
      const range = new URL(request.url).searchParams.get('range') ?? ''
      ranges.push(range)
      return ok({ ...testOnboardingFunnel, ...funnel, range }, 'Onboarding funnel retrieved.')
    })
  )
  return ranges
}

/**
 * Answers the list with `rows` for every state, recording each request's params.
 * A `c2` cursor answers an emptied later page.
 */
function serveTenants(rows: OnboardingTenantRow[] = [], nextCursor: string | null = null) {
  const seen: Record<string, string>[] = []
  server.use(
    http.get('/api/v1/platform/onboarding/tenants', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(Object.fromEntries(params))
      if (params.get('cursor') === 'c2') {
        return ok(
          listPage([], { prevCursor: 'p1', hasPrev: true }),
          'Onboarding tenants retrieved.'
        )
      }
      return ok(
        listPage(rows, { nextCursor, hasNext: nextCursor !== null }),
        'Onboarding tenants retrieved.'
      )
    })
  )
  return seen
}

describe('/onboarding', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  describe('the funnel', () => {
    it('shows the five figures over the tenants that started in the window', async () => {
      renderAppAt('/onboarding')
      expect(await tiles()).toEqual([
        ['Started (30 days)', '40', 'Tenants whose onboarding began in the window'],
        ['Completed', '14', 'Every required step done'],
        ['Completion rate', '35.00%', '14 of 40 started tenants'],
        [
          'Stuck now',
          '6',
          'Started in this window, with no progress past the stuck limit (7 days by default).',
        ],
        ['Dismissed', '2', 'Hid the checklist unfinished'],
      ])
    })

    it('labels each bar in HTML, hides the bars, and gives screen readers the same figures', async () => {
      renderAppAt('/onboarding')
      const funnel = await screen.findByRole('figure', { name: 'Onboarding funnel' })
      const label = within(funnel).getByText('30 of 40 tenants (75.00%) · 4 by staff')
      expect(label.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(within(funnel).getByText('12 of 40 tenants (30.00%)')).toBeInTheDocument()
      expect(within(funnel).getAllByText('· optional')).toHaveLength(2)

      const table = within(funnel).getByRole('table')
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent)
      ).toEqual(['Step', 'Required', 'Completed', 'By staff', 'Share'])
      const row = within(table).getByRole('row', { name: /Configure your workspace/ })
      expect(
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent)
      ).toEqual(['Required', '30', '4', '75.00%'])
    })

    it('draws the staff share in its own colour at the end of the bar', async () => {
      renderAppAt('/onboarding')
      const funnel = await screen.findByRole('figure', { name: 'Onboarding funnel' })
      // The first step's bar is found by its markup because the list is hidden from assistive tech.
      const bar = funnel.querySelector('li .rounded-full')
      const [completed, staff] = [...(bar?.children ?? [])] as HTMLElement[]
      expect(completed?.style.width).toBe('65%')
      expect(completed?.style.background).toBe('var(--chart-1)')
      expect(staff?.style.width).toBe('10%')
      expect(staff?.style.background).toBe('var(--chart-2)')
    })

    it('opens on 30 days, and asks for 90 when the toggle is switched, keeping the tab', async () => {
      const ranges = serveFunnel()
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding?state=complete')
      await screen.findByRole('region', { name: 'Onboarding figures' })
      expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      await user.click(screen.getByRole('button', { name: '90 days' }))

      await waitFor(() => expect(ranges).toContain('90d'))
      expect(router.state.location.search).toEqual({ range: '90d', state: 'complete' })
      expect(await screen.findByText('Started (90 days)')).toBeInTheDocument()
    })

    it('falls back to 30 days and the stuck tab for values it does not offer', async () => {
      const router = renderAppAt('/onboarding?range=1y&state=lost')
      await screen.findByRole('region', { name: 'Onboarding figures' })
      expect(router.state.location.search).toEqual({})
    })

    it('says the window was empty rather than drawing empty bars', async () => {
      serveFunnel({
        totals: { started: 0, inProgress: 0, stuck: 0, complete: 0, dismissed: 0 },
        completionRate: null,
        steps: testOnboardingFunnel.steps.map((step) => ({
          ...step,
          completed: 0,
          staffCompleted: 0,
        })),
      })
      renderAppAt('/onboarding?range=7d')
      const funnel = await screen.findByRole('figure', { name: 'Onboarding funnel' })
      expect(
        within(funnel).getByText('No tenant started onboarding in the last 7 days')
      ).toBeInTheDocument()
      expect(within(funnel).queryByRole('table')).not.toBeInTheDocument()
      expect((await tiles())[2]).toEqual([
        'Completion rate',
        '—',
        'No tenant started in the window',
      ])
    })

    it('says tracking starts with new tenants, and shows nothing else, while none is tracked', async () => {
      serveFunnel({
        trackedTenants: 0,
        totals: { started: 0, inProgress: 0, stuck: 0, complete: 0, dismissed: 0 },
        completionRate: null,
      })
      renderAppAt('/onboarding')
      expect(
        await screen.findByText(
          'Onboarding is tracked for tenants created once the server runs release 1.4.0 (2 October 2026) or later.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Onboarding figures' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    })

    it('says the role cannot see this, and does not sign out, on a 404', async () => {
      server.use(http.get('/api/v1/platform/onboarding/funnel', () => fail('Not found', 404)))
      renderAppAt('/onboarding')
      expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })

    it('offers a retry when the figures fail to load', async () => {
      let calls = 0
      server.use(
        http.get('/api/v1/platform/onboarding/funnel', () => {
          calls += 1
          return calls <= 2
            ? fail('Boom', 500)
            : ok(testOnboardingFunnel, 'Onboarding funnel retrieved.')
        })
      )
      const user = userEvent.setup()
      renderAppAt('/onboarding')
      await user.click(await screen.findByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('region', { name: 'Onboarding figures' })).toBeInTheDocument()
    })
  })

  describe('when the funnel fails', () => {
    it('still lists the stuck tenants, whose query is independent', async () => {
      server.use(http.get('/api/v1/platform/onboarding/funnel', () => fail('Boom', 500)))
      serveTenants([onboardingTenantRow()])
      renderAppAt('/onboarding')
      expect(
        await screen.findByText('We couldn’t load the onboarding figures. Select Try again.')
      ).toBeInTheDocument()
      expect(await screen.findByRole('table', { name: 'Onboarding tenants' })).toBeInTheDocument()
    })
  })

  describe('the tenants by state', () => {
    it('opens on the stuck tab, longest stuck first, with days stuck', async () => {
      const seen = serveTenants([
        onboardingTenantRow(),
        onboardingTenantRow({
          id: TENANT_ID_2,
          name: 'Beta Ltd',
          slug: 'beta',
          owners: [],
          daysStuck: 8,
          nextStep: { key: 'configure_settings', title: 'Configure your workspace' },
          requiredDone: 0,
        }),
      ])
      renderAppAt('/onboarding')
      const table = await screen.findByRole('table', { name: 'Onboarding tenants' })
      expect(screen.getByRole('tab', { name: 'Stuck' })).toHaveAttribute('aria-selected', 'true')
      expect(seen[0]).toEqual({ state: 'stuck', total: '1' })
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent)
      ).toEqual([
        'Tenant',
        'Owners',
        'Started',
        'Last progress',
        'Days stuck',
        'Next required step',
        'Progress',
      ])
      const acme = within(table).getByRole('row', { name: /Acme Corp/ })
      expect(within(acme).getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
        'href',
        `/tenants/${TENANT_ID}/onboarding`
      )
      expect(within(acme).getByText('Cleo Doe')).toBeInTheDocument()
      expect(within(acme).getByText('9')).toBeInTheDocument()
      expect(within(acme).getByText('Invite a teammate')).toBeInTheDocument()
      expect(within(acme).getByText('1 of 2 steps')).toBeInTheDocument()
      const beta = within(table).getByRole('row', { name: /Beta Ltd/ })
      expect(within(beta).getByText('No active owner')).toBeInTheDocument()
      expect(within(beta).getByText('0 of 2 steps')).toBeInTheDocument()
    })

    it('keeps the tab in the URL, and an awaiting-owner row says so instead of a start date', async () => {
      const seen = serveTenants([
        onboardingTenantRow({
          state: 'awaiting_owner',
          owners: [],
          startedAt: null,
          lastProgressAt: null,
          daysStuck: null,
          requiredDone: 0,
        }),
      ])
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding?range=7d')
      await screen.findByRole('table', { name: 'Onboarding tenants' })

      await user.click(screen.getByRole('tab', { name: 'Awaiting owner' }))

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ range: '7d', state: 'awaiting_owner' })
      )
      await waitFor(() => expect(seen.at(-1)).toEqual({ state: 'awaiting_owner', total: '1' }))
      const table = await screen.findByRole('table', { name: 'Onboarding tenants' })
      expect(within(table).queryByRole('columnheader', { name: 'Days stuck' })).toBeNull()
      const row = within(table).getByRole('row', { name: /Acme Corp/ })
      expect(within(row).getByText('Awaiting owner')).toBeInTheDocument()
      expect(within(row).getByText('—')).toBeInTheDocument()
    })

    it('opens the tab the URL names', async () => {
      serveTenants([
        onboardingTenantRow({
          state: 'complete',
          daysStuck: null,
          completedAt: '2026-09-25T09:00:00.000Z',
          nextStep: null,
          requiredDone: 2,
        }),
      ])
      renderAppAt('/onboarding?state=complete')
      const table = await screen.findByRole('table', { name: 'Onboarding tenants' })
      expect(screen.getByRole('tab', { name: 'Complete' })).toHaveAttribute('aria-selected', 'true')
      expect(within(table).getByText('All required steps done')).toBeInTheDocument()
      expect(within(table).getByText('2 of 2 steps')).toBeInTheDocument()
    })

    it('pages with the API’s cursors, and a new tab starts from the first page', async () => {
      const seen = serveTenants([onboardingTenantRow()], 'n1')
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding')
      await screen.findByRole('table', { name: 'Onboarding tenants' })
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Next page' }))

      await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'n1' }))
      await waitFor(() => expect(seen.at(-1)).toEqual({ state: 'stuck', cursor: 'n1' }))

      await user.click(screen.getByRole('tab', { name: 'In progress' }))
      await waitFor(() => expect(router.state.location.search).toEqual({ state: 'in_progress' }))
    })

    it('orders the stuck tab by days stuck by default, and sends no sort', async () => {
      const seen = serveTenants([onboardingTenantRow()])
      renderAppAt('/onboarding')
      const table = await screen.findByRole('table', { name: 'Onboarding tenants' })
      expect(within(table).getByRole('columnheader', { name: 'Days stuck' })).toHaveAttribute(
        'aria-sort',
        'descending'
      )
      expect(seen.at(-1)).not.toHaveProperty('sort')
    })

    it('orders every other tab by when it started, and sends no sort', async () => {
      const seen = serveTenants([onboardingTenantRow({ state: 'complete', daysStuck: null })])
      renderAppAt('/onboarding?state=complete')
      const table = await screen.findByRole('table', { name: 'Onboarding tenants' })
      expect(within(table).getByRole('columnheader', { name: 'Started' })).toHaveAttribute(
        'aria-sort',
        'descending'
      )
      expect(seen.at(-1)).not.toHaveProperty('sort')
    })

    it('sorts any tab by tenant name through ?sort=name', async () => {
      const seen = serveTenants([onboardingTenantRow({ state: 'complete', daysStuck: null })])
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding?state=complete')
      const table = await screen.findByRole('table', { name: 'Onboarding tenants' })

      await user.click(within(table).getByRole('button', { name: 'Tenant' }))

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ state: 'complete', sort: 'name' })
      )
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ state: 'complete', sort: 'name' }))
    })

    it('searches the tenant name', async () => {
      const seen = serveTenants([onboardingTenantRow()])
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding?sort=name')
      await screen.findByRole('table', { name: 'Onboarding tenants' })
      const box = screen.getByRole('searchbox', { name: 'Search tenants' })
      expect(box).toHaveAttribute('placeholder', 'Search by tenant name')

      await user.type(box, 'acme')

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ search: 'acme', sort: 'name' })
      )
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ search: 'acme', sort: 'name' }))
    })

    it('keeps the search and the sort when the tab changes, and drops the cursor', async () => {
      const seen = serveTenants([onboardingTenantRow()], 'n1')
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding?cursor=n1&search=acme&sort=name')
      await screen.findByRole('table', { name: 'Onboarding tenants' })
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ cursor: 'n1', search: 'acme' }))

      await user.click(screen.getByRole('tab', { name: 'Complete' }))

      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          state: 'complete',
          search: 'acme',
          sort: 'name',
        })
      )
      await waitFor(() =>
        expect(seen.at(-1)).toMatchObject({ state: 'complete', search: 'acme', sort: 'name' })
      )
      expect(seen.at(-1)).not.toHaveProperty('cursor')
    })

    it('returns to the previous tab and its rows on Back, and to the next on Forward', async () => {
      server.use(
        http.get('/api/v1/platform/onboarding/tenants', ({ request }) => {
          const state = new URL(request.url).searchParams.get('state')
          return ok(
            listPage(
              state === 'complete'
                ? [onboardingTenantRow({ name: 'Gamma Inc', state: 'complete', daysStuck: null })]
                : [onboardingTenantRow()]
            ),
            'Onboarding tenants retrieved.'
          )
        })
      )
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding')
      const history = router.history as RouterHistory
      await screen.findByRole('link', { name: 'Acme Corp' })

      await user.click(screen.getByRole('tab', { name: 'Complete' }))
      await screen.findByRole('link', { name: 'Gamma Inc' })

      act(() => history.back())
      await screen.findByRole('link', { name: 'Acme Corp' })
      expect(screen.getByRole('tab', { name: 'Stuck' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('link', { name: 'Gamma Inc' })).not.toBeInTheDocument()

      act(() => history.forward())
      await screen.findByRole('link', { name: 'Gamma Inc' })
      expect(screen.getByRole('tab', { name: 'Complete' })).toHaveAttribute('aria-selected', 'true')
      expect(router.state.location.search).toEqual({ state: 'complete' })
    })

    it('shows the role refusal in the list, and keeps the funnel, when only the list is refused', async () => {
      server.use(http.get('/api/v1/platform/onboarding/tenants', () => fail('Not found', 404)))
      renderAppAt('/onboarding')
      const section = (await screen.findByRole('heading', { name: 'Tenants' })).closest('section')!
      expect(await within(section).findByRole('alert')).toHaveTextContent(
        'Your role can’t see this any more.'
      )
      expect(screen.getByRole('region', { name: 'Onboarding figures' })).toBeInTheDocument()
      expect(screen.getAllByRole('alert')).toHaveLength(1)
    })

    it('keeps the default range and tab out of the URL', async () => {
      serveTenants([onboardingTenantRow()])
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding')
      await screen.findByRole('table', { name: 'Onboarding tenants' })

      await user.type(screen.getByRole('searchbox', { name: 'Search tenants' }), 'acme')

      await waitFor(() => expect(router.state.location.search).toEqual({ search: 'acme' }))
    })

    it.each([
      ['stuck', 'No tenant is stuck.'],
      ['in_progress', 'No tenant is in progress.'],
      ['awaiting_owner', 'No tenant is waiting for its owner.'],
      ['complete', 'No tenant has finished yet.'],
      ['dismissed', 'No tenant has dismissed its checklist.'],
    ])('says so when no tenant is %s', async (state, text) => {
      renderAppAt(`/onboarding?state=${state}`)
      expect(await screen.findByText(text)).toBeInTheDocument()
    })

    it('offers the first page when a later page has emptied', async () => {
      serveTenants()
      const user = userEvent.setup()
      const router = renderAppAt('/onboarding?cursor=c2')
      expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'First page' }))
      await waitFor(() => expect(router.state.location.search).toEqual({}))
    })

    it('keeps the funnel up and offers a retry when only the list fails', async () => {
      let failing = true
      server.use(
        http.get('/api/v1/platform/onboarding/tenants', () => {
          return failing
            ? fail('Boom', 500)
            : ok(listPage([onboardingTenantRow()]), 'Onboarding tenants retrieved.')
        })
      )
      const user = userEvent.setup()
      renderAppAt('/onboarding')
      expect(
        await screen.findByText('We couldn’t load these tenants. Select Try again.')
      ).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Onboarding figures' })).toBeInTheDocument()
      failing = false
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('table', { name: 'Onboarding tenants' })).toBeInTheDocument()
    })
  })

  it('is the Growth group’s one item, for every staff role', () => {
    const growth = navItemsFor('viewer').filter((item) => item.group === 'Growth')
    expect(growth.map((item) => [item.label, item.to])).toEqual([['Onboarding', '/onboarding']])
  })

  it('names the page in the title', async () => {
    renderAppAt('/onboarding')
    await screen.findByRole('heading', { name: 'Onboarding', level: 1 })
    await waitFor(() => expect(document.title).toBe('Onboarding · Apex'))
  })

  it('shows the tenants by state while the funnel is still loading', async () => {
    server.use(
      http.get('/api/v1/platform/onboarding/funnel', () => new Promise<Response>(() => {}))
    )
    signIn()
    renderAppAt('/onboarding')
    expect(await screen.findByRole('tablist', { name: 'Onboarding states' })).toBeVisible()
  })

  it('holds the funnel’s KPI cards at the loaded cards’ height while it loads', async () => {
    server.use(
      http.get('/api/v1/platform/onboarding/funnel', () => new Promise<Response>(() => {}))
    )
    signIn()
    renderAppAt('/onboarding')
    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    const cards = document.querySelectorAll(
      '[data-slot="query-state"][aria-busy="true"] [data-slot="card"]'
    )
    expect(cards).toHaveLength(5)
    expect(cards[0]).toHaveProperty('style.minHeight', '11rem')
  })

  it('shows one refusal, and no tenants by state, when the funnel is refused for the role', async () => {
    server.use(http.get('/api/v1/platform/onboarding/funnel', () => fail('Not found', 404)))
    signIn()
    renderAppAt('/onboarding')
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role can’t see this any more.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByRole('tablist', { name: 'Onboarding states' })).not.toBeInTheDocument()
  })
})
