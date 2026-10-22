import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/lib/toast'
import { queryClient } from '@/router'
import {
  flagRow,
  flagRows,
  flagsEvaluation,
  flagsMeta,
  flagUrl,
  TRAITS,
  unregisteredRows,
} from '@/tests/fixtures/flags'
import { TENANT_ID, TENANT_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type {
  FlagReason,
  FlagRow,
  FlagsMetaResponse,
  PlatformUserDetail,
  PlatformUserRow,
  UnregisteredRow,
} from '@/types/api.types'

const CLEO_ROW: PlatformUserRow = {
  id: USER_ID_2,
  email: 'cleo@example.com',
  firstName: 'Cleo',
  lastName: 'Doe',
  active: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: null,
  membershipCount: 1,
}

const CLEO: PlatformUserDetail = {
  ...CLEO_ROW,
  authProviders: ['email'],
  memberships: [
    {
      tenantId: TENANT_ID,
      tenantName: 'Acme Corp',
      tenantSlug: 'acme',
      lifecycleState: 'active',
      role: 'editor',
      joinedAt: '2026-02-01T00:00:00.000Z',
    },
  ],
  pendingInvitations: [],
}

/** What `serve` answers the three flags reads with; each defaults to the reference fixtures. */
interface Served {
  registry?: () => Response
  unregistered?: () => Response
  meta?: () => Response
}

/** The registry rows as a list answer. */
function registryAnswer(rows: FlagRow[] = flagRows()) {
  return ok(listPage(rows), 'Flags retrieved.')
}

/** The unregistered rows as a list answer. */
function unregisteredAnswer(rows: UnregisteredRow[] = unregisteredRows()) {
  return ok(listPage(rows), 'Unregistered flags retrieved.')
}

/** The meta read as an answer. */
function metaAnswer(overrides: Partial<FlagsMetaResponse> = {}) {
  return ok(flagsMeta(overrides), 'Flags meta retrieved.')
}

/** Answers the three flags reads, the directory search and Cleo's detail; records each request's query string. */
function serve({ registry, unregistered, meta }: Served = {}) {
  const evaluated: string[] = []
  const searched: string[] = []
  const searchedTotals: (string | null)[] = []
  const registryReads: string[] = []
  const panelReads: string[] = []
  const unregisteredReads: string[] = []
  server.use(
    http.get('/api/v1/platform/flags', ({ request }) => {
      const { search } = new URL(request.url)
      // The evaluate panel's registry read is apart from the page's list; a test overrides it by its own handler.
      if (search === '?limit=100') {
        panelReads.push(search)
        return registryAnswer()
      }
      registryReads.push(search)
      return (registry ?? registryAnswer)()
    }),
    http.get('/api/v1/platform/flags/unregistered', ({ request }) => {
      unregisteredReads.push(new URL(request.url).search)
      return (unregistered ?? unregisteredAnswer)()
    }),
    http.get('/api/v1/platform/flags/meta', () => (meta ?? metaAnswer)()),
    http.get('/api/v1/platform/flags/evaluate', ({ request }) => {
      evaluated.push(new URL(request.url).search)
      return ok(flagsEvaluation(), 'Flags evaluated.')
    }),
    http.get('/api/v1/platform/users', ({ request }) => {
      const params = new URL(request.url).searchParams
      searched.push(params.get('search') ?? '')
      searchedTotals.push(params.get('total'))
      return ok(listPage([CLEO_ROW]), 'Users retrieved.')
    }),
    http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(CLEO, 'User retrieved.'))
  )
  return { evaluated, searched, searchedTotals, registryReads, panelReads, unregisteredReads }
}

/** The data rows of a table, header row left out. */
function rowsOf(name: string) {
  return within(screen.getByRole('table', { name })).getAllByRole('row').slice(1)
}

describe('/settings/platform/flags', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // A relative time read once at render froze at "just now" while the page stayed open.
  it('moves its relative times on as the clock ticks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.parse(flagsMeta().snapshot.fetchedAt!))
    serve()
    renderAppAt('/settings/platform/flags')

    expect(await screen.findByText('just now')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
  })

  it('lists every registered flag with its declaration, live state and PostHog link', async () => {
    serve()
    renderAppAt('/settings/platform/flags')
    expect(await screen.findByRole('heading', { name: 'Feature flags', level: 1 })).toBeVisible()
    await screen.findByRole('table', { name: 'Registered flags' })
    const [beta, experiment, unsupported] = rowsOf('Registered flags')

    const betaRow = within(beta!)
    expect(betaRow.getByText('example_beta_page')).toBeInTheDocument()
    expect(betaRow.getByText('Boolean')).toBeInTheDocument()
    expect(betaRow.getByText('Tenant')).toBeInTheDocument()
    expect(betaRow.getByText('Customer app')).toBeInTheDocument()
    expect(betaRow.getByText('Active')).toHaveAttribute('data-tone', 'success')
    expect(betaRow.getByText('1 condition, up to 50%')).toBeInTheDocument()
    expect(betaRow.getByRole('link', { name: /Open in PostHog/ })).toHaveAttribute(
      'href',
      flagUrl(101)
    )

    const experimentRow = within(experiment!)
    expect(experimentRow.getByText('Experiment')).toBeInTheDocument()
    expect(experimentRow.getByText('control, bold')).toBeInTheDocument()
    expect(experimentRow.getByText('Inactive')).toHaveAttribute('data-tone', 'muted')

    const unsupportedRow = within(unsupported!)
    expect(unsupportedRow.getByText('Server only')).toBeInTheDocument()
    expect(unsupportedRow.getByText('Unsupported')).toHaveAttribute('data-tone', 'warning')
    expect(unsupportedRow.getByText('cohort')).toBeInTheDocument()
    expect(unsupportedRow.getByText('2 conditions, up to 100%')).toBeInTheDocument()
  })

  it('names a field express does not evaluate as the construct an unsupported flag uses', async () => {
    serve({
      registry: () =>
        registryAnswer([flagRow({ state: 'unsupported', unsupportedReason: 'unknown_field' })]),
    })
    renderAppAt('/settings/platform/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    const [row] = rowsOf('Registered flags')
    expect(within(row!).getByText('Unsupported')).toHaveAttribute('data-tone', 'warning')
    expect(within(row!).getByText('unknown_field')).toBeInTheDocument()
  })

  it('names a missing flag, and leaves the link out when the API has none', async () => {
    serve({
      registry: () =>
        registryAnswer([
          flagRow({ state: 'missing', conditions: 0, maxRollout: null, posthogUrl: null }),
        ]),
    })
    renderAppAt('/settings/platform/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    const [missing] = rowsOf('Registered flags')
    expect(within(missing!).getByText('Missing in PostHog')).toHaveAttribute('data-tone', 'warning')
    expect(within(missing!).getByText('No conditions')).toBeInTheDocument()
    expect(within(missing!).queryByRole('link')).not.toBeInTheDocument()
  })

  it('lists PostHog’s unregistered flags with their links', async () => {
    serve()
    renderAppAt('/settings/platform/flags')
    await screen.findByRole('table', { name: 'Unregistered flags' })
    const [legacy] = rowsOf('Unregistered flags')
    expect(within(legacy!).getByText('legacy_marketing_banner')).toBeInTheDocument()
    expect(within(legacy!).getByText('Active')).toHaveAttribute('data-tone', 'success')
    expect(within(legacy!).getByRole('link', { name: /Open in PostHog/ })).toHaveAttribute(
      'href',
      flagUrl(104)
    )
  })

  it('says when every PostHog flag is registered', async () => {
    serve({ unregistered: () => unregisteredAnswer([]) })
    renderAppAt('/settings/platform/flags')
    expect(await screen.findByText('None.')).toBeInTheDocument()
    expect(screen.getByText('Every PostHog flag is registered.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Unregistered flags' })).not.toBeInTheDocument()
  })

  it('says when flags are not set up, and still lists the registry', async () => {
    serve({
      registry: () => registryAnswer([flagRow({ state: 'missing', posthogUrl: null })]),
      unregistered: () => unregisteredAnswer([]),
      meta: () => metaAnswer({ snapshot: { enabled: false, fetchedAt: null, stale: false } }),
    })
    renderAppAt('/settings/platform/flags')
    expect(
      await screen.findByText(
        'Feature flags are not set up for this environment, so every flag serves its fallback.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Registered flags' })).toBeInTheDocument()
    expect(screen.queryByText(/Flag definitions last changed/)).not.toBeInTheDocument()
  })

  it('warns when the snapshot is stale, and says when the definitions last changed', async () => {
    serve({
      meta: () =>
        metaAnswer({
          snapshot: { enabled: true, fetchedAt: '2026-10-05T09:00:00.000Z', stale: true },
        }),
    })
    renderAppAt('/settings/platform/flags')
    expect(
      await screen.findByText(
        'The server hasn’t reached PostHog for over 10 minutes, so flags use the last snapshot.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/Flag definitions last changed/).querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-10-05T09:00:00.000Z'
    )
  })

  it('shows a neutral badge with the raw value for a state this app does not know', async () => {
    serve({
      registry: () => registryAnswer([flagRow({ state: 'archived' as FlagRow['state'] })]),
    })
    renderAppAt('/settings/platform/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    const [row] = rowsOf('Registered flags')
    expect(within(row!).getByText('archived')).toHaveAttribute('data-tone', 'neutral')
  })

  it('lists each trait with where it lives and examples, and copies its name', async () => {
    serve()
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/settings/platform/flags')
    const traits = await screen.findByRole('region', { name: 'Traits reference' })
    for (const trait of TRAITS) expect(within(traits).getByText(trait.name)).toBeInTheDocument()
    expect(within(traits).getByText('Tenant group property')).toBeInTheDocument()
    expect(within(traits).getAllByText('Person property')).toHaveLength(4)
    await user.click(within(traits).getByRole('button', { name: 'Copy tenant_role' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Copied tenant_role'))
    await expect(navigator.clipboard.readText()).resolves.toBe('tenant_role')
  })

  it('says when a copy fails', async () => {
    serve()
    const error = vi.spyOn(toast, 'error')
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    renderAppAt('/settings/platform/flags')
    const traits = await screen.findByRole('region', { name: 'Traits reference' })
    await user.click(within(traits).getByRole('button', { name: 'Copy app_env' }))
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('We couldn’t copy app_env. Select it and copy it by hand.')
    )
  })

  it('offers a viewer no evaluation, and never asks for one', async () => {
    const { evaluated } = serve()
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    await screen.findByRole('table', { name: 'Registered flags' })
    const evaluate = screen.getByRole('region', { name: 'Evaluate' })
    expect(within(evaluate).getByText('Admins can evaluate flags for a user.')).toBeInTheDocument()
    expect(within(evaluate).queryByRole('searchbox')).not.toBeInTheDocument()
    expect(within(evaluate).queryByRole('button')).not.toBeInTheDocument()
    expect(evaluated).toEqual([])
  })

  it('offers an admin the evaluation, without the viewer note', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    renderAppAt('/settings/platform/flags')
    const evaluate = await screen.findByRole('region', { name: 'Evaluate' })
    expect(
      within(evaluate).queryByText('Admins can evaluate flags for a user.')
    ).not.toBeInTheDocument()
    expect(within(evaluate).getByRole('searchbox', { name: 'Find a user' })).toBeInTheDocument()
  })

  it('shows one retryable error when the page cannot load, retrying the meta read', async () => {
    let calls = 0
    serve({
      meta: () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : metaAnswer()
      },
    })
    const user = userEvent.setup()
    renderAppAt('/settings/platform/flags')
    expect(
      await screen.findByText(
        'We couldn’t load the flags, so their states are unknown. Select Try again.'
      )
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Registered flags' })).toBeInTheDocument()
  })

  it('says the role cannot see this on a 404, without signing out', async () => {
    serve({ meta: () => fail('Not found', 404) })
    renderAppAt('/settings/platform/flags')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows one role refusal for the page when every read answers 404', async () => {
    serve({
      registry: () => fail('Not found', 404),
      unregistered: () => fail('Not found', 404),
      meta: () => fail('Not found', 404),
    })
    renderAppAt('/settings/platform/flags')
    await screen.findByText(/Your role can’t see this any more/)
    expect(screen.getAllByText(/Your role can’t see this any more/)).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Registered flags' })).not.toBeInTheDocument()
  })

  it('shows a list’s own error, with Try again, while the other list and the page stay', async () => {
    let calls = 0
    serve({
      registry: () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : registryAnswer()
      },
    })
    const user = userEvent.setup()
    renderAppAt('/settings/platform/flags')
    const registered = await screen.findByRole('region', { name: 'Registered flags' })
    expect(
      await within(registered).findByText(
        'We couldn’t load the flags, so their states are unknown. Select Try again.'
      )
    ).toBeInTheDocument()
    const unregistered = screen.getByRole('region', { name: 'In PostHog, not registered' })
    expect(
      await within(unregistered).findByRole('table', { name: 'Unregistered flags' })
    ).toBeVisible()
    await user.click(within(registered).getByRole('button', { name: 'Try again' }))
    expect(await within(registered).findByRole('table', { name: 'Registered flags' })).toBeVisible()
  })
})

describe('/settings/platform/flags lists', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('offers no sort control on the Flag header, or in the phone Sort menu', async () => {
    serve()
    renderAppAt('/settings/platform/flags')
    for (const name of ['Registered flags', 'Unregistered flags']) {
      const table = await screen.findByRole('table', { name })
      const header = within(table).getByRole('columnheader', { name: 'Flag' })
      expect(within(header).queryByRole('button')).not.toBeInTheDocument()
      expect(header).not.toHaveAttribute('aria-sort')
    }
  })

  it('offers no Sort menu on a phone', async () => {
    window.innerWidth = 390
    try {
      serve()
      renderAppAt('/settings/platform/flags')
      await screen.findByRole('region', { name: 'Registered flags' })
      await screen.findByText('example_beta_page')
      expect(screen.queryByRole('button', { name: /^Sort by/ })).not.toBeInTheDocument()
    } finally {
      window.innerWidth = 1024
    }
  })

  it('lines the registry cells up at the top beside a wrapped description', async () => {
    serve()
    renderAppAt('/settings/platform/flags')
    const table = await screen.findByRole('table', { name: 'Registered flags' })
    const [beta] = within(table).getAllByRole('row').slice(1)
    for (const cell of within(beta!).getAllByRole('cell')) expect(cell).toHaveClass('align-top')
  })

  it('shows one role refusal when the role is refused after the page loaded', async () => {
    serve()
    renderAppAt('/settings/platform/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    await screen.findByRole('table', { name: 'Unregistered flags' })
    server.use(
      http.get('/api/v1/platform/flags', () => fail('Not found', 404)),
      http.get('/api/v1/platform/flags/unregistered', () => fail('Not found', 404)),
      http.get('/api/v1/platform/flags/meta', () => fail('Not found', 404))
    )
    await act(() => queryClient.invalidateQueries({ queryKey: ['platform', 'flags'] }))
    await screen.findByText(/Your role can’t see this any more/)
    expect(screen.getAllByText(/Your role can’t see this any more/)).toHaveLength(1)
  })

  it('shows one role refusal when only a list is refused after a search', async () => {
    serve()
    const user = userEvent.setup()
    renderAppAt('/settings/platform/flags')
    const registered = await screen.findByRole('region', { name: 'Registered flags' })
    await screen.findByRole('table', { name: 'Unregistered flags' })
    server.use(
      http.get('/api/v1/platform/flags', () => fail('Not found', 404)),
      http.get('/api/v1/platform/flags/unregistered', () => fail('Not found', 404))
    )
    await user.type(within(registered).getByRole('searchbox', { name: 'Search flags' }), 'beta')
    await screen.findByText(/Your role can’t see this any more/)
    expect(screen.getAllByText(/Your role can’t see this any more/)).toHaveLength(1)
    // The refusal replaces the page's sections, not just the refused list.
    expect(screen.queryByRole('table', { name: 'Unregistered flags' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Traits reference' })).not.toBeInTheDocument()
  })

  it('asks for the default view of both lists with no list params', async () => {
    const { registryReads, unregisteredReads } = serve()
    const router = renderAppAt('/settings/platform/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    await screen.findByRole('table', { name: 'Unregistered flags' })
    expect(registryReads).toEqual(['?total=1'])
    expect(unregisteredReads).toEqual(['?total=1'])
    expect(router.state.location.search).toEqual({})
  })

  it('searches the registry and the unregistered list apart', async () => {
    const { registryReads, unregisteredReads } = serve()
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/flags')
    const registered = await screen.findByRole('region', { name: 'Registered flags' })
    await user.type(within(registered).getByRole('searchbox', { name: 'Search flags' }), 'beta')
    const unregistered = screen.getByRole('region', { name: 'In PostHog, not registered' })
    await user.type(
      within(unregistered).getByRole('searchbox', { name: 'Search unregistered flags' }),
      'old'
    )

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'beta', unregisteredSearch: 'old' })
    )
    await waitFor(() => expect(registryReads.at(-1)).toBe('?search=beta&total=1'))
    await waitFor(() => expect(unregisteredReads.at(-1)).toBe('?search=old&total=1'))
    expect(registryReads.some((read) => read.includes('old'))).toBe(false)
    expect(unregisteredReads.some((read) => read.includes('beta'))).toBe(false)
  })

  it('filters the registry by kind', async () => {
    const { registryReads, unregisteredReads } = serve()
    renderAppAt('/settings/platform/flags?kind=multivariate')
    await screen.findByRole('table', { name: 'Registered flags' })
    expect(registryReads).toEqual(['?kind=multivariate&total=1'])
    expect(unregisteredReads).toEqual(['?total=1'])
  })

  it('filters the registry by state through the State facet', async () => {
    const { registryReads } = serve()
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/flags')
    const registered = await screen.findByRole('region', { name: 'Registered flags' })
    await user.click(
      within(registered).getByRole('button', { name: 'Filter by state, Registered flags' })
    )
    const popup = await screen.findByRole('dialog', { name: 'Filter by state, Registered flags' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Unsupported' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'unsupported' }))
    await waitFor(() => expect(registryReads.at(-1)).toBe('?state=unsupported&total=1'))
  })

  it('keeps both lists’ params when a user is picked for evaluation', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/flags?search=beta&unregisteredSearch=old')
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.type(within(panel).getByRole('searchbox', { name: 'Find a user' }), 'cleo')
    await user.click(await within(panel).findByRole('button', { name: /Cleo Doe/ }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        search: 'beta',
        unregisteredSearch: 'old',
        userId: USER_ID_2,
      })
    )
  })

  it('clears the picked user with Change user, keeping the lists’ params', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    const user = userEvent.setup()
    const router = renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}&search=beta`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.click(await within(panel).findByRole('button', { name: 'Change user' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'beta' }))
    expect(within(panel).getByRole('searchbox', { name: 'Find a user' })).toBeInTheDocument()
  })

  it('keeps the default app out of the URL when a list writes', async () => {
    serve()
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/flags')
    const registered = await screen.findByRole('region', { name: 'Registered flags' })
    await user.type(within(registered).getByRole('searchbox', { name: 'Search flags' }), 'beta')
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'beta' }))
    expect(router.state.location.searchStr).not.toContain('app')
  })

  it('reads the evaluate panel’s registry apart from the page’s lists', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    const { registryReads, panelReads } = serve()
    renderAppAt('/settings/platform/flags?search=beta')
    await screen.findByRole('searchbox', { name: 'Find a user' })
    await waitFor(() => expect(panelReads).toEqual(['?limit=100']))
    expect(registryReads).toEqual(['?search=beta&total=1'])
  })
})

describe('/settings/platform/flags evaluate', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('shows the user picker while the evaluate panel’s registry read is held', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    server.use(
      http.get('/api/v1/platform/flags', ({ request }) =>
        new URL(request.url).search === '?limit=100'
          ? new Promise<Response>(() => {})
          : registryAnswer()
      )
    )
    renderAppAt('/settings/platform/flags')
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    expect(panel.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(within(panel).getByRole('searchbox', { name: 'Find a user' })).toBeInTheDocument()
  })

  it('holds the evaluation table, not the picked user, while the registry loads', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    server.use(
      http.get('/api/v1/platform/flags', ({ request }) =>
        new URL(request.url).search === '?limit=100'
          ? new Promise<Response>(() => {})
          : registryAnswer()
      )
    )
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    expect(await within(panel).findByRole('button', { name: 'Change user' })).toBeVisible()
    await waitFor(() =>
      expect(panel.querySelectorAll('[data-slot="table-rows-skeleton"]')).toHaveLength(1)
    )
    expect(within(panel).queryByRole('table', { name: 'Evaluation' })).not.toBeInTheDocument()
  })

  it('shows the Evaluate section’s own error with Try again when the registry fails', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    let calls = 0
    serve()
    server.use(
      http.get('/api/v1/platform/flags', ({ request }) => {
        if (new URL(request.url).search !== '?limit=100') return registryAnswer()
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : registryAnswer()
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    expect(
      await within(panel).findByText(
        'We couldn’t load the flags, so their states are unknown. Select Try again.'
      )
    ).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Change user' })).toBeVisible()
    await user.click(within(panel).getByRole('button', { name: 'Try again' }))
    expect(await within(panel).findByRole('table', { name: 'Evaluation' })).toBeInTheDocument()
  })

  it('says when the evaluation’s registry holds only the first hundred flags', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    server.use(
      http.get('/api/v1/platform/flags', ({ request }) =>
        new URL(request.url).search === '?limit=100'
          ? ok(
              listPage(flagRows(), { hasNext: true, nextCursor: 'more', limit: 100 }),
              'Flags retrieved.'
            )
          : registryAnswer()
      )
    )
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    expect(await within(panel).findByText('Showing the first 100 flags.')).toBeInTheDocument()
  })

  it('does not say it when the registry fits one read', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await within(panel).findByRole('table', { name: 'Evaluation' })
    expect(within(panel).queryByText('Showing the first 100 flags.')).not.toBeInTheDocument()
  })

  it('finds a user through the directory and evaluates every flag for the customer app', async () => {
    const { evaluated, searched, searchedTotals } = serve()
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/flags')
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.type(within(panel).getByRole('searchbox', { name: 'Find a user' }), 'cleo')
    await user.click(await within(panel).findByRole('button', { name: /Cleo Doe/ }))

    await waitFor(() => expect(router.state.location.search).toEqual({ userId: USER_ID_2 }))
    expect(searched.at(-1)).toBe('cleo')
    // The picker shows no count, so it asks for none.
    expect(searchedTotals.at(-1)).toBeNull()
    const table = await within(panel).findByRole('table', { name: 'Evaluation' })
    expect(evaluated).toEqual([`?userId=${USER_ID_2}&app=react`])
    expect(within(panel).getByText('Evaluating for')).toBeInTheDocument()

    const [beta, experiment, unsupported] = within(table).getAllByRole('row').slice(1)
    expect(within(beta!).getByText('Condition matched')).toHaveAttribute('data-tone', 'success')
    expect(within(beta!).getByText('Condition 1')).toBeInTheDocument()
    expect(within(beta!).getByText('Yes')).toBeInTheDocument()
    expect(within(experiment!).getByText('Holdout')).toBeInTheDocument()
    expect(
      within(experiment!).getByText('Sees control, recorded as holdout-3605')
    ).toBeInTheDocument()
    expect(within(unsupported!).getByText('Fallback: unsupported')).toBeInTheDocument()
    expect(within(unsupported!).getByText('No')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Sent to Customer app' })).toBeVisible()

    expect(within(panel).getByText('tenant_created_days')).toBeInTheDocument()
    expect(within(panel).getByText('120')).toBeInTheDocument()
  })

  it('sends a tenant chosen from the user’s own, and drops it for Apex', async () => {
    const { evaluated } = serve()
    const user = userEvent.setup()
    const router = renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await within(panel).findByRole('table', { name: 'Evaluation' })

    await user.click(within(panel).getByRole('combobox', { name: 'Tenant' }))
    await user.click(await screen.findByRole('option', { name: 'Acme Corp' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        userId: USER_ID_2,
        tenantId: TENANT_ID,
      })
    )
    await waitFor(() =>
      expect(evaluated.at(-1)).toBe(`?userId=${USER_ID_2}&tenantId=${TENANT_ID}&app=react`)
    )

    await user.click(within(panel).getByRole('button', { name: 'Apex' }))
    await waitFor(() => expect(evaluated.at(-1)).toBe(`?userId=${USER_ID_2}&app=apex`))
    expect(within(panel).getByRole('combobox', { name: 'Tenant' })).toBeDisabled()
    expect(
      within(panel).getByText('Apex is evaluated with no tenant, as staff use it.')
    ).toBeInTheDocument()
    expect(
      await within(panel).findByRole('columnheader', { name: 'Sent to Apex' })
    ).toBeInTheDocument()
  })

  it('ignores a tenant in the URL that is not one of the user’s', async () => {
    const { evaluated } = serve()
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}&tenantId=${TENANT_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await within(panel).findByRole('table', { name: 'Evaluation' })
    expect(evaluated).toEqual([`?userId=${USER_ID_2}&app=react`])
  })

  it('shows a neutral badge with the raw value for a reason this app does not know', async () => {
    serve()
    server.use(
      http.get('/api/v1/platform/flags/evaluate', () =>
        ok(
          flagsEvaluation({
            flags: [{ key: 'example_beta_page', value: true, reason: 'brand_new' as FlagReason }],
          }),
          'Flags evaluated.'
        )
      )
    )
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    const table = await within(panel).findByRole('table', { name: 'Evaluation' })
    expect(within(table).getByText('brand_new')).toHaveAttribute('data-tone', 'neutral')
  })

  it('goes back to the picker when Change user is pressed', async () => {
    serve()
    const user = userEvent.setup()
    const router = renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}&app=apex`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.click(await within(panel).findByRole('button', { name: 'Change user' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ app: 'apex' }))
    expect(within(panel).getByRole('searchbox', { name: 'Find a user' })).toBeInTheDocument()
  })

  it('says when no user matches the search', async () => {
    serve()
    server.use(http.get('/api/v1/platform/users', () => ok(listPage([]), 'Users retrieved.')))
    const user = userEvent.setup()
    renderAppAt('/settings/platform/flags')
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.type(within(panel).getByRole('searchbox', { name: 'Find a user' }), 'nobody')
    expect(await within(panel).findByText('No users match.')).toBeInTheDocument()
  })

  it('shows neither the old matches nor "No users match." while a new term loads', async () => {
    serve()
    /** Resolves `held`. */
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/v1/platform/users', async ({ request }) => {
        if (new URL(request.url).searchParams.get('search') === 'cleox') {
          await held
          return ok(listPage([]), 'Users retrieved.')
        }
        return ok(listPage([CLEO_ROW]), 'Users retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/platform/flags')
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    const box = within(panel).getByRole('searchbox', { name: 'Find a user' })
    await user.type(box, 'cleo')
    await within(panel).findByRole('button', { name: /Cleo Doe/ })

    try {
      await user.type(box, 'x')
      await waitFor(() =>
        expect(within(panel).queryByRole('button', { name: /Cleo Doe/ })).not.toBeInTheDocument()
      )
      expect(within(panel).queryByText('No users match.')).not.toBeInTheDocument()
    } finally {
      release()
    }
    expect(await within(panel).findByText('No users match.')).toBeInTheDocument()
  })

  it('says when the user no longer exists, and evaluates nothing', async () => {
    const { evaluated } = serve()
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)))
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    expect(await screen.findByText('That user doesn’t exist any more.')).toBeInTheDocument()
    expect(evaluated).toEqual([])
  })

  it('holds the looked-up user’s two rows while the lookup runs', async () => {
    serve()
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => new Promise<Response>(() => {}))
    )
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await waitFor(() => expect(panel.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2))
  })

  it('shows one retryable error when the evaluation fails, without retrying it', async () => {
    serve()
    let calls = 0
    server.use(
      http.get('/api/v1/platform/flags/evaluate', () => {
        calls += 1
        return calls === 1 ? fail('Boom', 500) : ok(flagsEvaluation(), 'Flags evaluated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    expect(
      await screen.findByText(
        'We couldn’t evaluate the flags, so their values are unknown. Select Try again.'
      )
    ).toBeInTheDocument()
    expect(calls).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Evaluation' })).toBeInTheDocument()
  })

  it('says the role cannot evaluate on a 404', async () => {
    serve()
    server.use(http.get('/api/v1/platform/flags/evaluate', () => fail('Not found', 404)))
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })

  it('warns when the evaluation used a stale snapshot, and marks an unset trait', async () => {
    serve()
    server.use(
      http.get('/api/v1/platform/flags/evaluate', () =>
        ok(
          flagsEvaluation({
            traits: {
              platform_role: 'none',
              tenant_role: 'none',
              app_env: 'local',
              account_created_days: 3,
            },
            snapshot: { fetchedAt: '2026-10-05T09:00:00.000Z', stale: true },
          }),
          'Flags evaluated.'
        )
      )
    )
    renderAppAt(`/settings/platform/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await within(panel).findByRole('table', { name: 'Evaluation' })
    expect(
      within(panel).getByText(
        'The server hasn’t reached PostHog for over 10 minutes, so flags use the last snapshot.'
      )
    ).toBeInTheDocument()
    expect(within(panel).getByText('Not set')).toBeInTheDocument()
  })
})

describe('the user detail page’s Flags link', () => {
  it('opens the evaluation for that user, for an admin', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('link', { name: 'Flags' })).toHaveAttribute(
      'href',
      `/settings/platform/flags?userId=${USER_ID_2}`
    )
  })

  it('is not offered to a viewer', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    serve()
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    expect(screen.queryByRole('link', { name: 'Flags' })).not.toBeInTheDocument()
  })
})
