import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { flagRows, flagsEvaluation } from '@/tests/fixtures/flags'
import {
  MEMBERSHIP_ID_2,
  MEMBERSHIP_ID_3,
  TENANT_ID,
  USER_ID_2,
  USER_ID_3,
} from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail, testUser, testUserDetail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail, TenantLifecycleState } from '@/types/api.types'

const FLAGS = `/tenants/${TENANT_ID}/flags`

/** Acme's platform detail in `lifecycleState`. */
function platformDetail(lifecycleState: TenantLifecycleState = 'active'): PlatformTenantDetail {
  return {
    id: TENANT_ID,
    name: 'Acme Corp',
    slug: 'acme',
    description: null,
    website: null,
    logo: null,
    lifecycleState,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
    settings: { timezone: 'UTC', locale: 'en' },
    memberCount: 1,
    owners: [],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
  }
}

const MEMBERS = [
  {
    membership: {
      id: MEMBERSHIP_ID_2,
      userId: USER_ID_2,
      tenantId: TENANT_ID,
      role: 'editor',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID_2, email: 'cleo@example.com', firstName: 'Cleo', lastName: 'Doe' },
  },
]

/** Ada, a member the first twenty miss: only a search finds her. */
const ADA = {
  membership: { ...MEMBERS[0]!.membership, id: MEMBERSHIP_ID_3, userId: USER_ID_3, role: 'viewer' },
  user: { id: USER_ID_3, email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
}

/** The query string of each members read of the running test. */
const memberReads: string[] = []

/** The query string of each registry read of the running test. */
const registryReads: string[] = []

/** Acme, its members and the flags; records each members and evaluation request. */
function serve(lifecycleState: TenantLifecycleState = 'active') {
  const seen: string[] = []
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
      ok(platformDetail(lifecycleState), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(platformDetail(), 'admin', 'platform'), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/members', ({ request }) => {
      const url = new URL(request.url)
      seen.push('members')
      memberReads.push(url.search)
      const search = url.searchParams.get('search')
      const rows = search === null ? MEMBERS : search === 'ada' ? [ADA] : []
      return ok(listPage(rows), 'Members retrieved.')
    }),
    http.get('/api/v1/platform/users/:userId', ({ params }) => {
      seen.push(`user ${String(params.userId)}`)
      return params.userId === USER_ID_3
        ? ok(
            {
              ...testUserDetail,
              id: USER_ID_3,
              email: 'ada@example.com',
              firstName: 'Ada',
              lastName: 'Lovelace',
            },
            'User retrieved.'
          )
        : fail('User not found', 404)
    }),
    http.get('/api/v1/platform/flags', ({ request }) => {
      registryReads.push(new URL(request.url).search)
      return ok(listPage(flagRows()), 'Flags retrieved.')
    }),
    http.get('/api/v1/platform/flags/evaluate', ({ request }) => {
      seen.push(new URL(request.url).search)
      return ok(flagsEvaluation(), 'Flags evaluated.')
    })
  )
  return seen
}

/** The text of each link in the tenant page's section navigation, in order. */
function tabLabels() {
  const nav = screen.getByRole('navigation', { name: 'Tenant sections' })
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent)
}

describe('/tenants/$tenantId/flags', () => {
  beforeEach(() => {
    registryReads.length = 0
    memberReads.length = 0
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('is the last tab for an admin, and evaluates a picked member in this tenant', async () => {
    const seen = serve()
    const user = userEvent.setup()
    const router = renderAppAt(FLAGS)
    await screen.findByRole('heading', { name: 'Flags', level: 2 })
    expect(tabLabels().at(-1)).toBe('Flags')
    expect(
      within(screen.getByRole('navigation', { name: 'Tenant sections' })).getByRole('link', {
        name: 'Flags',
      })
    ).toHaveAttribute('aria-current', 'page')

    const members = await screen.findByRole('list', { name: 'Members' })
    expect(
      screen.getByText(
        'Pick a member to see every flag as the customer app evaluates it for them here.'
      )
    ).toBeInTheDocument()
    await user.click(within(members).getByRole('button', { name: /Cleo Doe/ }))

    await waitFor(() => expect(router.state.location.search).toEqual({ userId: USER_ID_2 }))
    const table = await screen.findByRole('table', { name: 'Evaluation' })
    expect(within(table).getByText('Condition matched')).toBeInTheDocument()
    expect(within(members).getByRole('button', { name: /Cleo Doe/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(seen).toEqual(['members', `?userId=${USER_ID_2}&tenantId=${TENANT_ID}&app=react`])
  })

  it('finds a member beyond the first page by search', async () => {
    const seen = serve()
    const user = userEvent.setup()
    const router = renderAppAt(FLAGS)
    const members = await screen.findByRole('list', { name: 'Members' })
    expect(within(members).queryByRole('button', { name: /Ada Lovelace/ })).not.toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: 'Find a member' }), 'ada')
    await user.click(await within(members).findByRole('button', { name: /Ada Lovelace/ }))

    await waitFor(() => expect(router.state.location.search).toEqual({ userId: USER_ID_3 }))
    expect(await screen.findByRole('table', { name: 'Evaluation' })).toBeInTheDocument()
    expect(screen.getByText('Showing flags for', { exact: false })).toHaveTextContent(
      'Showing flags for Ada Lovelace'
    )
    expect(screen.getByPlaceholderText('Search by name or email')).toBeInTheDocument()
    // Twenty at a time, no total, and the debounced term sent once.
    expect(memberReads).toEqual(['?limit=20', '?search=ada&limit=20'])
    // A member in the results is named from them, with no read of their record.
    expect(seen.filter((entry) => entry.startsWith('user '))).toEqual([])
  })

  it('evaluates and names a URL member outside the results', async () => {
    const seen = serve()
    renderAppAt(`${FLAGS}?userId=${USER_ID_3}`)
    expect(await screen.findByRole('table', { name: 'Evaluation' })).toBeInTheDocument()
    expect(
      await screen.findByText((_, node) => node?.textContent === 'Showing flags for Ada Lovelace.')
    ).toBeInTheDocument()
    expect(seen).toContain(`?userId=${USER_ID_3}&tenantId=${TENANT_ID}&app=react`)
    expect(seen).toContain(`user ${USER_ID_3}`)
  })

  it('says no member matches a search that finds nobody', async () => {
    serve()
    const user = userEvent.setup()
    renderAppAt(FLAGS)
    await screen.findByRole('list', { name: 'Members' })
    await user.type(screen.getByRole('searchbox', { name: 'Find a member' }), 'zed')
    expect(await screen.findByText('No members match.')).toBeInTheDocument()
  })

  it('says nothing about matches while a new search is still loading', async () => {
    serve()
    /** Lets the held "ada" answer go. */
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/v1/tenants/acme/members', async ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search === 'ada') {
          await held
          return ok(listPage([ADA]), 'Members retrieved.')
        }
        return ok(listPage(search === null ? MEMBERS : []), 'Members retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(FLAGS)
    const box = await screen.findByRole('searchbox', { name: 'Find a member' })
    await user.type(box, 'zed')
    expect(await screen.findByText('No members match.')).toBeInTheDocument()

    await user.clear(box)
    await user.type(box, 'ada')
    // The empty page for "zed" stays up as a placeholder while "ada" loads; it must not claim no match.
    await waitFor(() => expect(screen.queryByText('No members match.')).not.toBeInTheDocument())
    release()
    expect(await screen.findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()
    expect(screen.queryByText('No members match.')).not.toBeInTheDocument()
  })

  it('keeps the newer search’s members when an older, slower answer lands last', async () => {
    serve()
    /** Lets the held "cle" answer go. */
    let releaseOld: () => void = () => {}
    const oldHeld = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    let oldAsked = false
    let oldAnswered = false
    server.use(
      http.get('/api/v1/tenants/acme/members', async ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search === 'cle') {
          oldAsked = true
          await oldHeld
          oldAnswered = true
          return ok(listPage(MEMBERS), 'Members retrieved.')
        }
        return ok(listPage(search === 'ada' ? [ADA] : MEMBERS), 'Members retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(FLAGS)
    const box = await screen.findByRole('searchbox', { name: 'Find a member' })
    const members = screen.getByRole('list', { name: 'Members' })
    await user.type(box, 'cle')
    // The slow "cle" read is in flight before the term changes.
    await waitFor(() => expect(oldAsked).toBe(true))
    await user.clear(box)
    await user.type(box, 'ada')
    expect(await within(members).findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()

    releaseOld()
    await waitFor(() => expect(oldAnswered).toBe(true))
    await settle(50, 'a late answer that is ignored renders nothing to wait on')
    expect(within(members).getByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()
    expect(within(members).queryByRole('button', { name: /Cleo Doe/ })).not.toBeInTheDocument()
  })

  it('says no member matches only for a search, never for the unsearched list', async () => {
    serve()
    server.use(
      http.get('/api/v1/tenants/acme/members', () => ok(listPage([]), 'Members retrieved.'))
    )
    renderAppAt(FLAGS)
    expect(await screen.findByRole('list', { name: 'Members' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Pick a member to see every flag as the customer app evaluates it for them here.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('No members match.')).not.toBeInTheDocument()
  })

  it('keeps the search box when a member search fails, with the error and a retry under it', async () => {
    serve()
    let failing = true
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        const search = new URL(request.url).searchParams.get('search')
        if (search === 'ada') {
          return failing ? fail('Boom', 500) : ok(listPage([ADA]), 'Members retrieved.')
        }
        return ok(listPage(MEMBERS), 'Members retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(FLAGS)
    const box = await screen.findByRole('searchbox', { name: 'Find a member' })
    await user.type(box, 'ada')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'We couldn’t search this tenant’s members. Select Try again to search again.'
    )
    expect(screen.getByRole('searchbox', { name: 'Find a member' })).toHaveValue('ada')
    expect(screen.getByRole('heading', { name: 'Flags', level: 2 })).toBeInTheDocument()

    failing = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('caps the member search at the API’s 100 characters', async () => {
    serve()
    renderAppAt(FLAGS)
    expect(await screen.findByRole('searchbox', { name: 'Find a member' })).toHaveAttribute(
      'maxlength',
      '100'
    )
  })

  it('reads the registry as rows, with no total, to mark what the app receives', async () => {
    serve()
    renderAppAt(`${FLAGS}?userId=${USER_ID_2}`)
    const table = await screen.findByRole('table', { name: 'Evaluation' })
    expect(within(table).getByText('example_beta_page')).toBeInTheDocument()
    expect(registryReads).toEqual(['?limit=100'])
  })

  it('shows the flags error, retrying the registry, when it fails to load', async () => {
    serve()
    let calls = 0
    server.use(
      http.get('/api/v1/platform/flags', () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : ok(listPage(flagRows()), 'Flags retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`${FLAGS}?userId=${USER_ID_2}`)
    expect(
      await screen.findByText(
        'We couldn’t load the flags, so their states are unknown. Select Try again.'
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Evaluation' })).toBeInTheDocument()
  })

  it('shows one role refusal when the registry answers 404', async () => {
    serve()
    server.use(http.get('/api/v1/platform/flags', () => fail('Not found', 404)))
    renderAppAt(FLAGS)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })

  it('shows the Flags heading and the member picker’s skeleton while the tenant loads', async () => {
    server.use(
      http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => new Promise<never>(() => {}))
    )
    renderAppAt(FLAGS)
    const region = await screen.findByRole('region', { name: 'Flags' })
    // The search box, three member bars and the hint line.
    expect(region.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5)
  })

  it('holds the evaluation’s table rows while it loads', async () => {
    serve()
    server.use(http.get('/api/v1/platform/flags/evaluate', () => new Promise<never>(() => {})))
    renderAppAt(`${FLAGS}?userId=${USER_ID_2}`)
    await screen.findByRole('list', { name: 'Members' })
    await waitFor(() =>
      expect(document.querySelectorAll('[data-slot="table-rows-skeleton"]')).toHaveLength(1)
    )
  })

  it('refuses a viewer at once, with no skeleton while the tenant loads', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    server.use(
      http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => new Promise<never>(() => {}))
    )
    renderAppAt(FLAGS)
    const region = await screen.findByRole('region', { name: 'Flags' })
    expect(region.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
    expect(within(region).getByText('Your role can’t see this any more.')).toBeVisible()
  })

  it('refuses a viewer without asking for members or an evaluation', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    const seen = serve()
    renderAppAt(`${FLAGS}?userId=${USER_ID_2}`)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Tenant sections' })).queryByRole('link', {
        name: 'Flags',
      })
    ).not.toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it('says a suspended tenant’s members are frozen, and asks for nothing', async () => {
    const seen = serve('suspended')
    renderAppAt(FLAGS)
    expect(
      await screen.findByText('This tenant is suspended. Its members and invitations are frozen.')
    ).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it('shows a retryable error when the members fail to load', async () => {
    serve()
    server.use(http.get('/api/v1/tenants/acme/members', () => fail('Boom', 500)))
    renderAppAt(FLAGS)
    expect(
      await screen.findByText('We couldn’t load this tenant’s members. Select Try again.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
