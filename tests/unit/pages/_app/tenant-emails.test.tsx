import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { EMAIL_ID, TENANT_ID, TENANT_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { emailSummary, fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail, TenantLifecycleState } from '@/types/api.types'

/** Acme's platform detail in `lifecycleState`; archived carries its `deletedAt`. */
function detail(lifecycleState: TenantLifecycleState = 'active'): PlatformTenantDetail {
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
    deletedAt: lifecycleState === 'archived' ? '2026-09-01T00:00:00.000Z' : null,
    settings: { timezone: 'UTC', locale: 'en' },
    memberCount: 1,
    owners: [],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
  }
}

/** Acme's platform detail and its emails page by page; records every emails query and every tenant-route request. */
function serve(seen: URLSearchParams[], state: TenantLifecycleState = 'active') {
  const internal: string[] = []
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(detail(state), 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme*', ({ request }) => {
      internal.push(new URL(request.url).pathname)
      return fail('Not found', 404)
    }),
    http.get('/api/v1/platform/emails', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'stale') {
        return ok(listPage([], { prevCursor: 'p1', hasPrev: true }), 'ok')
      }
      return ok(
        listPage(
          [emailSummary({ id: EMAIL_ID, templateKey: 'tenant_invitation' })],
          { nextCursor: 'c2', hasNext: true },
          { count: 1, capped: false }
        ),
        'Emails retrieved.'
      )
    })
  )
  return internal
}

describe('/tenants/$tenantId/emails', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('is a tab after Activity, listing the tenant’s emails from the platform API', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    renderAppAt(`/tenants/${TENANT_ID}/emails`)
    const nav = await screen.findByRole('navigation', { name: 'Tenant sections' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Overview', 'Members', 'Invitations', 'Activity', 'Emails', 'Onboarding'])
    expect(within(nav).getByRole('link', { name: 'Emails' })).toHaveAttribute(
      'aria-current',
      'page'
    )

    const table = await screen.findByRole('table', { name: 'Emails' })
    expect(within(table).getByText('Tenant invitation')).toBeInTheDocument()
    // Every row is this tenant's, so the Tenant column would only repeat the page.
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Recipient', 'Template', 'Status', 'Created', 'User'])
    expect(seen.at(-1)?.get('tenant')).toBe(TENANT_ID)
    expect(screen.getByRole('link', { name: 'Filter these in Emails' })).toHaveAttribute(
      'href',
      `/emails?tenant=${TENANT_ID}`
    )
  })

  it.each<TenantLifecycleState>(['suspended', 'archived'])(
    'still lists a %s tenant’s emails, and asks its own routes nothing',
    async (state) => {
      const seen: URLSearchParams[] = []
      const internal = serve(seen, state)
      renderAppAt(`/tenants/${TENANT_ID}/emails`)
      expect(await screen.findByRole('table', { name: 'Emails' })).toBeInTheDocument()
      expect(screen.queryByText(new RegExp(`This tenant is ${state}`))).not.toBeInTheDocument()
      expect(internal).toEqual([])
    }
  )

  it('pages in the URL with the API cursor', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/emails`)
    await screen.findByRole('table', { name: 'Emails' })
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2' }))
    await waitFor(() => expect(seen.at(-1)?.get('cursor')).toBe('c2'))
    expect(seen.at(-1)?.get('tenant')).toBe(TENANT_ID)
  })

  it('filters by status, and the request still carries the tenant', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/emails?cursor=c2`)
    await screen.findByRole('table', { name: 'Emails' })

    await user.click(screen.getByRole('button', { name: 'Filter by status, Emails' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Emails' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Bounced' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'bounced' }))
    await waitFor(() => expect(seen.at(-1)?.get('status')).toBe('bounced'))
    expect(seen.at(-1)?.get('tenant')).toBe(TENANT_ID)
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('ignores ?user and ?tenant in its URL: the tenant is the page’s and there is no user or tenant chip', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    renderAppAt(`/tenants/${TENANT_ID}/emails?user=${USER_ID_2}&tenant=${TENANT_ID_2}`)
    await screen.findByRole('table', { name: 'Emails' })
    expect(seen.at(-1)?.get('tenant')).toBe(TENANT_ID)
    expect(seen.at(-1)?.get('user')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove filter: (User|Tenant):/ })).toBeNull()
  })

  it('searches by recipient and sorts newest first', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/emails`)
    const table = await screen.findByRole('table', { name: 'Emails' })
    expect(within(table).getByRole('columnheader', { name: 'Created' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    await user.type(screen.getByRole('searchbox', { name: 'Search emails' }), 'cleo')
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'cleo' }))
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('cleo'))
    expect(seen.at(-1)?.get('tenant')).toBe(TENANT_ID)
  })

  it('says a stale page is empty and offers the first page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/emails?cursor=stale`)
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByRole('table', { name: 'Emails' })).toBeInTheDocument()
  })

  it('says so when nothing was sent for the tenant', async () => {
    serve([])
    server.use(http.get('/api/v1/platform/emails', () => ok(listPage([]), 'ok')))
    renderAppAt(`/tenants/${TENANT_ID}/emails`)
    expect(await screen.findByText('No emails for this tenant yet.')).toBeInTheDocument()
  })

  it('shows a retryable error, and role-denied on a 404', async () => {
    serve([])
    let calls = 0
    server.use(
      http.get('/api/v1/platform/emails', () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : fail('Not found', 404)
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/emails`)
    expect(
      await screen.findByText('We couldn’t load this tenant’s emails. Select Try again.')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })
})
