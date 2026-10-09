import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flagRow, flagsEvaluation, flagsList, flagUrl, TRAITS } from '@/tests/fixtures/flags'
import { TENANT_ID, TENANT_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { FlagReason, FlagRow, PlatformUserDetail, PlatformUserRow } from '@/types/api.types'

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
  hasPassword: true,
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

/** Answers the list, the directory search and Cleo's detail; records each evaluation's query. */
function serve(list: () => Response = () => ok(flagsList(), 'Flags retrieved.')) {
  const evaluated: string[] = []
  const searched: string[] = []
  server.use(
    http.get('/api/v1/platform/flags', list),
    http.get('/api/v1/platform/flags/evaluate', ({ request }) => {
      evaluated.push(new URL(request.url).search)
      return ok(flagsEvaluation(), 'Flags evaluated.')
    }),
    http.get('/api/v1/platform/users', ({ request }) => {
      searched.push(new URL(request.url).searchParams.get('q') ?? '')
      return ok({ users: [CLEO_ROW], nextCursor: null, prevCursor: null }, 'Users retrieved.')
    }),
    http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(CLEO, 'User retrieved.'))
  )
  return { evaluated, searched }
}

/** The data rows of a table, header row left out. */
function rowsOf(name: string) {
  return within(screen.getByRole('table', { name })).getAllByRole('row').slice(1)
}

describe('/flags', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists every registered flag with its declaration, live state and PostHog link', async () => {
    serve()
    renderAppAt('/flags')
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
    serve(() =>
      ok(
        flagsList({
          items: [flagRow({ state: 'unsupported', unsupportedReason: 'unknown_field' })],
        }),
        'Flags retrieved.'
      )
    )
    renderAppAt('/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    const [row] = rowsOf('Registered flags')
    expect(within(row!).getByText('Unsupported')).toHaveAttribute('data-tone', 'warning')
    expect(within(row!).getByText('unknown_field')).toBeInTheDocument()
  })

  it('names a missing flag, and leaves the link out when the API has none', async () => {
    serve(() =>
      ok(
        flagsList({
          items: [flagRow({ state: 'missing', conditions: 0, maxRollout: null, posthogUrl: null })],
        }),
        'Flags retrieved.'
      )
    )
    renderAppAt('/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    const [missing] = rowsOf('Registered flags')
    expect(within(missing!).getByText('Missing in PostHog')).toHaveAttribute('data-tone', 'warning')
    expect(within(missing!).getByText('No conditions')).toBeInTheDocument()
    expect(within(missing!).queryByRole('link')).not.toBeInTheDocument()
  })

  it('lists PostHog’s unregistered flags with their links', async () => {
    serve()
    renderAppAt('/flags')
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
    serve(() => ok(flagsList({ unregistered: [] }), 'Flags retrieved.'))
    renderAppAt('/flags')
    expect(await screen.findByText('None. Every PostHog flag is registered.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Unregistered flags' })).not.toBeInTheDocument()
  })

  it('says when flags are not set up, and still lists the registry', async () => {
    serve(() =>
      ok(
        flagsList({
          items: [flagRow({ state: 'missing', posthogUrl: null })],
          unregistered: [],
          snapshot: { enabled: false, fetchedAt: null, stale: false },
        }),
        'Flags retrieved.'
      )
    )
    renderAppAt('/flags')
    expect(
      await screen.findByText(
        'Feature flags are not set up for this environment, so every flag serves its fallback.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Registered flags' })).toBeInTheDocument()
    expect(screen.queryByText(/Flag definitions last changed/)).not.toBeInTheDocument()
  })

  it('warns when the snapshot is stale, and says when the definitions last changed', async () => {
    serve(() =>
      ok(
        flagsList({
          snapshot: { enabled: true, fetchedAt: '2026-10-05T09:00:00.000Z', stale: true },
        }),
        'Flags retrieved.'
      )
    )
    renderAppAt('/flags')
    expect(
      await screen.findByText(
        'PostHog has not been reached for over 10 minutes; flags use the last snapshot.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/Flag definitions last changed/).querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-10-05T09:00:00.000Z'
    )
  })

  it('shows a neutral badge with the raw value for a state this app does not know', async () => {
    serve(() =>
      ok(
        flagsList({ items: [flagRow({ state: 'archived' as FlagRow['state'] })] }),
        'Flags retrieved.'
      )
    )
    renderAppAt('/flags')
    await screen.findByRole('table', { name: 'Registered flags' })
    const [row] = rowsOf('Registered flags')
    expect(within(row!).getByText('archived')).toHaveAttribute('data-tone', 'neutral')
  })

  it('lists each trait with where it lives and examples, and copies its name', async () => {
    serve()
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/flags')
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
    renderAppAt('/flags')
    const traits = await screen.findByRole('region', { name: 'Traits reference' })
    await user.click(within(traits).getByRole('button', { name: 'Copy app_env' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not copy app_env'))
  })

  it('offers a viewer no evaluation, and never asks for one', async () => {
    const { evaluated } = serve()
    renderAppAt(`/flags?userId=${USER_ID_2}`)
    await screen.findByRole('table', { name: 'Registered flags' })
    expect(screen.queryByRole('region', { name: 'Evaluate' })).not.toBeInTheDocument()
    expect(evaluated).toEqual([])
  })

  it('shows one retryable error when the list fails', async () => {
    let calls = 0
    serve(() => {
      calls += 1
      return calls <= 2 ? fail('Boom', 500) : ok(flagsList(), 'Flags retrieved.')
    })
    const user = userEvent.setup()
    renderAppAt('/flags')
    expect(
      await screen.findByText('We could not load the flags. This is not a sign they are off.')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Registered flags' })).toBeInTheDocument()
  })

  it('says the role cannot see this on a 404, without signing out', async () => {
    serve(() => fail('Not found', 404))
    renderAppAt('/flags')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })
})

describe('/flags evaluate', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('finds a user through the directory and evaluates every flag for the customer app', async () => {
    const { evaluated, searched } = serve()
    const user = userEvent.setup()
    const router = renderAppAt('/flags')
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.type(within(panel).getByRole('searchbox', { name: 'Find a user' }), 'cleo')
    await user.click(await within(panel).findByRole('button', { name: /Cleo Doe/ }))

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ userId: USER_ID_2, app: 'react' })
    )
    expect(searched.at(-1)).toBe('cleo')
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
    const router = renderAppAt(`/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await within(panel).findByRole('table', { name: 'Evaluation' })

    await user.click(within(panel).getByRole('combobox', { name: 'Tenant' }))
    await user.click(await screen.findByRole('option', { name: 'Acme Corp' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        userId: USER_ID_2,
        tenantId: TENANT_ID,
        app: 'react',
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
    renderAppAt(`/flags?userId=${USER_ID_2}&tenantId=${TENANT_ID_2}`)
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
    renderAppAt(`/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    const table = await within(panel).findByRole('table', { name: 'Evaluation' })
    expect(within(table).getByText('brand_new')).toHaveAttribute('data-tone', 'neutral')
  })

  it('goes back to the picker when Change user is pressed', async () => {
    serve()
    const user = userEvent.setup()
    const router = renderAppAt(`/flags?userId=${USER_ID_2}&app=apex`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.click(await within(panel).findByRole('button', { name: 'Change user' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ app: 'apex' }))
    expect(within(panel).getByRole('searchbox', { name: 'Find a user' })).toBeInTheDocument()
  })

  it('says when no user matches the search', async () => {
    serve()
    server.use(
      http.get('/api/v1/platform/users', () =>
        ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/flags')
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await user.type(within(panel).getByRole('searchbox', { name: 'Find a user' }), 'nobody')
    expect(await within(panel).findByText('No users match.')).toBeInTheDocument()
  })

  it('says when the user no longer exists, and evaluates nothing', async () => {
    const { evaluated } = serve()
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)))
    renderAppAt(`/flags?userId=${USER_ID_2}`)
    expect(await screen.findByText('That user doesn’t exist any more.')).toBeInTheDocument()
    expect(evaluated).toEqual([])
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
    renderAppAt(`/flags?userId=${USER_ID_2}`)
    expect(
      await screen.findByText('We could not evaluate the flags. This is not a sign they are off.')
    ).toBeInTheDocument()
    expect(calls).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Evaluation' })).toBeInTheDocument()
  })

  it('says the role cannot evaluate on a 404', async () => {
    serve()
    server.use(http.get('/api/v1/platform/flags/evaluate', () => fail('Not found', 404)))
    renderAppAt(`/flags?userId=${USER_ID_2}`)
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
    renderAppAt(`/flags?userId=${USER_ID_2}`)
    const panel = await screen.findByRole('region', { name: 'Evaluate' })
    await within(panel).findByRole('table', { name: 'Evaluation' })
    expect(
      within(panel).getByText(
        'PostHog has not been reached for over 10 minutes; flags use the last snapshot.'
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
      `/flags?userId=${USER_ID_2}&app=react`
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
