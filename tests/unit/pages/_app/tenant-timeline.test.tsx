import { screen, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { STAFF_USER_ID, TENANT_ID, USER_ID_2, USER_ID_3 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { at, eventId, timelineRow } from '@/tests/fixtures/timeline'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type {
  PlatformTenantDetail,
  TenantLifecycleState,
  TimelinePage,
  TimelineRow,
} from '@/types/api.types'

const TIMELINE = `/tenants/${TENANT_ID}/timeline`
const GROUP = `https://us.posthog.com/project/1/groups/0/${TENANT_ID}`

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

/** A member's click, a staff suspension, a purged member's pageview, and a system email. */
const ROWS: TimelineRow[] = [
  timelineRow({
    uuid: eventId(1),
    event: '$autocapture',
    timestamp: at(40),
    elementText: 'Invite',
    actor: { id: USER_ID_2, displayName: 'Cleo Doe' },
  }),
  timelineRow({
    uuid: eventId(2),
    event: 'tenant_suspended',
    timestamp: at(30),
    distinctId: STAFF_USER_ID,
    verified: true,
    source: 'audit',
    access: 'platform',
    app: 'api',
    sessionId: null,
    path: null,
    props: { target_type: 'tenant', target_id: TENANT_ID, has_reason: true },
    actor: { id: STAFF_USER_ID, displayName: 'sam@platform.test' },
  }),
  timelineRow({
    uuid: eventId(3),
    timestamp: at(20),
    distinctId: USER_ID_3,
    sessionId: null,
    actor: { id: USER_ID_3, displayName: null },
  }),
  timelineRow({
    uuid: eventId(4),
    event: 'email_delivered',
    timestamp: at(10),
    distinctId: 'system',
    verified: true,
    source: 'email',
    access: 'system',
    app: 'api',
    sessionId: null,
    path: null,
    props: { template_key: 'tenant_invitation' },
    actor: null,
  }),
]

const PAGE: TimelinePage = {
  configured: true,
  rows: ROWS,
  nextCursor: null,
  links: {
    person: null,
    group: GROUP,
    replay: 'https://us.posthog.com/project/1/replay/{sessionId}',
  },
}

/** Acme's platform detail and its timeline; records each timeline request. */
function serve(lifecycleState: TenantLifecycleState = 'active') {
  const seen: string[] = []
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
      ok(platformDetail(lifecycleState), 'Tenant retrieved.')
    ),
    http.get(`/api/v1/platform/tenants/${TENANT_ID}/timeline`, ({ request }) => {
      seen.push(new URL(request.url).search)
      return ok(PAGE, 'Timeline retrieved.')
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

describe('/tenants/$tenantId/timeline', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('is a tab after Activity for an admin', async () => {
    serve()
    renderAppAt(TIMELINE)
    await screen.findByRole('heading', { name: 'Timeline', level: 2 })
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
        name: 'Timeline',
      })
    ).toHaveAttribute('aria-current', 'page')
  })

  it('names who did each thing: a link for a member, Deleted user, System', async () => {
    const seen = serve()
    renderAppAt(TIMELINE)
    const list = await screen.findByRole('list', { name: 'Timeline' })

    const cleo = within(list).getByRole('link', { name: 'Cleo Doe' })
    expect(cleo).toHaveAttribute('href', `/users/${USER_ID_2}`)
    expect(within(cleo).getByText('Cleo Doe')).toHaveClass('ph-sensitive', 'ph-mask')
    const sam = within(list).getByRole('link', { name: 'sam@platform.test' })
    expect(sam).toHaveAttribute('href', `/users/${STAFF_USER_ID}`)
    expect(within(sam).getByText('sam@platform.test')).toHaveClass('ph-sensitive', 'ph-mask')
    expect(within(list).getByText('Deleted user')).toBeInTheDocument()
    expect(within(list).getByText('Deleted user').closest('a')).toBeNull()
    expect(within(list).queryByRole('link', { name: 'Deleted user' })).toBeNull()
    expect(within(list).getByText('System')).toBeInTheDocument()

    expect(within(list).getByText('Suspended the tenant')).toBeInTheDocument()
    expect(within(list).getByText('Email delivered (Tenant invitation)')).toBeInTheDocument()
    expect(within(list).getByText('Email')).toBeInTheDocument()
    expect(within(list).getAllByText('Browser')).toHaveLength(2)
    expect(within(list).getByText('Server')).toBeInTheDocument()
    expect(within(list).getByText('Staff')).toBeInTheDocument()
    expect(seen).toEqual(['?range=7d&view=all'])
  })

  it('opens the tenant’s group in PostHog', async () => {
    serve()
    renderAppAt(TIMELINE)
    expect(await screen.findByRole('link', { name: /Open in PostHog/ })).toHaveAttribute(
      'href',
      GROUP
    )
  })

  it('still shows an archived tenant’s timeline, from the platform API alone', async () => {
    const seen = serve('archived')
    renderAppAt(TIMELINE)
    expect(await screen.findByRole('list', { name: 'Timeline' })).toBeInTheDocument()
    expect(seen).toHaveLength(1)
  })

  it('keeps the tab out of a viewer’s nav and refuses a viewer who opens it', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    const seen = serve()
    renderAppAt(TIMELINE)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(tabLabels()).not.toContain('Timeline')
    expect(screen.queryByRole('link', { name: /Watch replay|Open in PostHog/ })).toBeNull()
    expect(seen).toHaveLength(0)
  })
})
