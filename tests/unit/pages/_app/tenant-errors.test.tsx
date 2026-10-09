import { screen, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { errorIssue, errorsPage } from '@/tests/fixtures/errors'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail, TenantLifecycleState } from '@/types/api.types'

const ERRORS = `/tenants/${TENANT_ID}/errors`

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
    deletedAt: lifecycleState === 'archived' ? '2026-09-01T00:00:00.000Z' : null,
    settings: { timezone: 'UTC', locale: 'en' },
    memberCount: 2,
    owners: [],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
  }
}

/** Acme's platform detail and its errors; records each errors request. */
function serve(lifecycleState: TenantLifecycleState = 'active') {
  const seen: string[] = []
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
      ok(platformDetail(lifecycleState), 'Tenant retrieved.')
    ),
    http.get(`/api/v1/platform/tenants/${TENANT_ID}/errors`, ({ request }) => {
      seen.push(new URL(request.url).search)
      return ok(errorsPage([errorIssue({ app: 'react' })]), 'Errors retrieved.')
    }),
    http.get('/api/v1/tenants/acme*', () => fail('Not found', 404))
  )
  return seen
}

function tabLabels() {
  const nav = screen.getByRole('navigation', { name: 'Tenant sections' })
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent)
}

describe('/tenants/$tenantId/errors', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('is a tab after Timeline for an admin, and lists the tenant’s issues', async () => {
    const seen = serve()
    renderAppAt(ERRORS)
    await screen.findByRole('heading', { name: 'Errors', level: 2 })
    expect(tabLabels()).toEqual([
      'Overview',
      'Members',
      'Invitations',
      'Activity',
      'Timeline',
      'Errors',
      'Emails',
      'Onboarding',
      'Flags',
    ])
    expect(
      within(screen.getByRole('navigation', { name: 'Tenant sections' })).getByRole('link', {
        name: 'Errors',
      })
    ).toHaveAttribute('aria-current', 'page')
    const table = await screen.findByRole('table', { name: 'Errors' })
    expect(within(table).getByText('TypeError', { selector: 'code' })).toBeInTheDocument()
    expect(within(table).getByText('Customer app')).toBeInTheDocument()
    expect(seen).toEqual([''])
  })

  it('still shows an archived tenant’s errors, from the platform API alone', async () => {
    const seen = serve('archived')
    renderAppAt(ERRORS)
    expect(await screen.findByRole('table', { name: 'Errors' })).toBeInTheDocument()
    expect(seen).toHaveLength(1)
  })

  it('keeps the tab out of a viewer’s nav and refuses a viewer who opens it', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    const seen = serve()
    renderAppAt(ERRORS)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(tabLabels()).not.toContain('Errors')
    expect(screen.queryByRole('link', { name: /Open in PostHog/ })).toBeNull()
    expect(seen).toHaveLength(0)
  })
})
