import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { flagsEvaluation, flagsList } from '@/tests/fixtures/flags'
import { MEMBERSHIP_ID_2, TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail, TenantLifecycleState } from '@/types/api.types'

const FLAGS = `/tenants/${TENANT_ID}/flags`

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
    http.get('/api/v1/tenants/acme/members', () => {
      seen.push('members')
      return ok(MEMBERS, 'Members retrieved.')
    }),
    http.get('/api/v1/platform/flags', () => ok(flagsList(), 'Flags retrieved.')),
    http.get('/api/v1/platform/flags/evaluate', ({ request }) => {
      seen.push(new URL(request.url).search)
      return ok(flagsEvaluation(), 'Flags evaluated.')
    })
  )
  return seen
}

function tabLabels() {
  const nav = screen.getByRole('navigation', { name: 'Tenant sections' })
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent)
}

describe('/tenants/$tenantId/flags', () => {
  beforeEach(() => {
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
    expect(await screen.findByText('We could not load this tenant’s members.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
