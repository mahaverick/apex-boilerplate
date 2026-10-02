import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMAIL_ID, TENANT_ID } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { emailSummary, fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail, TenantLifecycleState } from '@/types/api.types'

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
        return ok({ messages: [], nextCursor: null, prevCursor: 'p1' }, 'ok')
      }
      return ok(
        {
          messages: [emailSummary({ id: EMAIL_ID, templateKey: 'tenant_invitation' })],
          nextCursor: 'c2',
          prevCursor: null,
        },
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
    expect(seen.at(-1)?.get('tenantId')).toBe(TENANT_ID)
    expect(screen.getByRole('link', { name: 'Filter these in Emails' })).toHaveAttribute(
      'href',
      `/emails?tenantId=${TENANT_ID}`
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
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2', dir: 'next' }))
    await waitFor(() => expect(seen.at(-1)?.get('cursor')).toBe('c2'))
    expect(seen.at(-1)?.get('tenantId')).toBe(TENANT_ID)
  })

  it('says a stale page is empty and offers the first page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/emails?cursor=stale&dir=next`)
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByRole('table', { name: 'Emails' })).toBeInTheDocument()
  })

  it('says so when nothing was sent for the tenant', async () => {
    serve([])
    server.use(
      http.get('/api/v1/platform/emails', () =>
        ok({ messages: [], nextCursor: null, prevCursor: null }, 'ok')
      )
    )
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
    expect(await screen.findByText('We could not load this tenant’s emails.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })
})
