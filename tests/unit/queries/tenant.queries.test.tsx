import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { auditKeys } from '@/queries/audit.queries'
import { tenantAdminKeys } from '@/queries/tenant-admin.queries'
import {
  dropTenantCache,
  useInviteMember,
  useLeaveTenant,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
  useUpdateMemberRole,
} from '@/queries/tenant-writes.queries'
import { memberName, tenantKeys, useMembers, type TenantMember } from '@/queries/tenant.queries'
import { userAdminKeys } from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import {
  INVITATION_ID,
  MEMBERSHIP_ID,
  PLATFORM_TENANT_ID,
  TENANT_ID,
  USER_ID,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const member: TenantMember = {
  membership: {
    id: MEMBERSHIP_ID,
    userId: USER_ID,
    tenantId: PLATFORM_TENANT_ID,
    role: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  user: { id: USER_ID, email: 'ada@b.com', firstName: 'Ada', lastName: 'Lovelace' },
}

describe('useMembers', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
  })

  it('lists a tenant’s members under its members key', async () => {
    let path: string | null = null
    server.use(
      http.get('/api/v1/tenants/:slug/members', ({ request }) => {
        path = new URL(request.url).pathname
        return ok([member], 'Members retrieved.')
      })
    )

    const { result } = renderHook(() => useMembers('platform'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(path).toBe('/api/v1/tenants/platform/members')
    expect(result.current.data).toEqual([member])
    expect(client.getQueryData(tenantKeys.members('platform'))).toEqual([member])
  })
})

describe('member writes', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  /** Every cache a staff member's role or membership shows up in, beyond the member list itself. */
  const DIRECTORY_KEYS = [
    userAdminKeys.detail(USER_ID_2),
    userAdminKeys.list({ limit: 20 }),
    tenantAdminKeys.detail(TENANT_ID),
    tenantAdminKeys.page({ q: '' }),
    auditKeys.platform({}),
  ]

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
    for (const key of DIRECTORY_KEYS) client.setQueryData(key, {})
  })

  it('a role change refreshes the directory: the user’s page, the lists, the tenant pages and the platform log', async () => {
    server.use(
      http.patch(`/api/v1/tenants/platform/members/${USER_ID_2}`, () =>
        ok({ ...member.membership, userId: USER_ID_2, role: 'viewer' }, 'Role updated.')
      )
    )
    const { result } = renderHook(() => useUpdateMemberRole('platform'), { wrapper })
    result.current.mutate({ userId: USER_ID_2, role: 'viewer' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const key of DIRECTORY_KEYS) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
  })

  it('a removal refreshes the directory too', async () => {
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_2}`, () => ok(null, 'Member removed.'))
    )
    const { result } = renderHook(() => useRemoveMember('acme'), { wrapper })
    result.current.mutate({ userId: USER_ID_2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const key of DIRECTORY_KEYS) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
  })
})

describe('useLeaveTenant', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  /** A cache the staff directory refresh reaches, outside the tenant left. */
  const DIRECTORY_KEY = userAdminKeys.detail(USER_ID_2)
  const LAST_OWNER = 'You are the last owner: make someone else an owner before you leave.'

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
    client.setQueryData(DIRECTORY_KEY, {})
    client.setQueryData(tenantKeys.detail('acme', TENANT_ID), { id: TENANT_ID })
    client.setQueryData(tenantKeys.members('acme', TENANT_ID), [member])
  })

  it('leaves through the self-leave route, with no body, and refreshes the directory', async () => {
    let sent: { path: string; contentType: string | null; body: string } | null = null
    server.use(
      http.delete('/api/v1/tenants/:slug/membership', async ({ request }) => {
        sent = {
          path: new URL(request.url).pathname,
          contentType: request.headers.get('content-type'),
          body: await request.text(),
        }
        return ok(null, 'You left the tenant.')
      })
    )
    const { result } = renderHook(() => useLeaveTenant('acme'), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sent).toEqual({ path: '/api/v1/tenants/acme/membership', contentType: null, body: '' })
    expect(client.getQueryState(DIRECTORY_KEY)?.isInvalidated).toBe(true)
    // The page drops the tenant's cache once it has left the tenant's routes (`dropTenantCache`).
    expect(client.getQueryState(tenantKeys.detail('acme', TENANT_ID))?.data).toEqual({
      id: TENANT_ID,
    })
  })

  it('refetches the member list, and nothing else, when leaving is refused with a 409', async () => {
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () => fail(LAST_OWNER, 409, 'LAST_OWNER'))
    )
    const { result } = renderHook(() => useLeaveTenant('acme'), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryState(tenantKeys.members('acme', TENANT_ID))?.isInvalidated).toBe(true)
    expect(client.getQueryState(DIRECTORY_KEY)?.isInvalidated).toBe(false)
  })

  it('refreshes the directory when the membership was already gone (404)', async () => {
    server.use(http.delete('/api/v1/tenants/acme/membership', () => fail('Tenant not found', 404)))
    const { result } = renderHook(() => useLeaveTenant('acme'), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryState(DIRECTORY_KEY)?.isInvalidated).toBe(true)
  })

  it('refreshes the stored platform role after leaving the platform tenant, or finding it gone', async () => {
    for (const answer of [
      () => ok(null, 'You left the tenant.'),
      () => fail('Tenant not found', 404),
    ]) {
      useAuthStore.setState({ user: { ...testUser, platformRole: 'viewer' } })
      server.use(
        http.delete('/api/v1/tenants/platform/membership', answer),
        http.get('/api/v1/profile', () => ok({ ...testUser, platformRole: null }, 'Profile.'))
      )
      const { result } = renderHook(() => useLeaveTenant('platform'), { wrapper })
      result.current.mutate()

      await waitFor(() => expect(result.current.isIdle).toBe(false))
      await waitFor(() => expect(useAuthStore.getState().user?.platformRole).toBeNull())
    }
  })

  it('does not ask for the profile after leaving any other tenant', async () => {
    let profileCalls = 0
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () => ok(null, 'You left the tenant.')),
      http.get('/api/v1/profile', () => {
        profileCalls += 1
        return ok(testUser, 'Profile.')
      })
    )
    const { result } = renderHook(() => useLeaveTenant('acme'), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(profileCalls).toBe(0)
  })

  it('drops the whole tenant cache prefix with dropTenantCache, and nothing else', () => {
    dropTenantCache(client, 'acme')

    expect(client.getQueryState(tenantKeys.detail('acme', TENANT_ID))).toBeUndefined()
    expect(client.getQueryState(tenantKeys.members('acme', TENANT_ID))).toBeUndefined()
    expect(client.getQueryState(DIRECTORY_KEY)?.data).toEqual({})
  })
})

/** What one write put on the wire: its JSON content type, if any, and its raw body. */
interface Sent {
  contentType: string | null
  body: string
}

describe('a staff reason on the wire', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
  })

  /** Answers every member and invitation write on `acme`, keeping what each one sent. */
  function record(): Sent[] {
    const sent: Sent[] = []
    const keep = async ({ request }: { request: Request }) => {
      sent.push({ contentType: request.headers.get('content-type'), body: await request.text() })
      return ok(null, 'Done.')
    }
    server.use(
      http.patch(`/api/v1/tenants/acme/members/${USER_ID_2}`, keep),
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_2}`, keep),
      http.post('/api/v1/tenants/acme/invitations', keep),
      http.post(`/api/v1/tenants/acme/invitations/${INVITATION_ID}/resend`, keep),
      http.delete(`/api/v1/tenants/acme/invitations/${INVITATION_ID}`, keep)
    )
    return sent
  }

  /** Runs one write through its hook and waits for it to settle. */
  async function run<T>(useWrite: () => { mutateAsync: (input: T) => Promise<unknown> }, input: T) {
    const { result } = renderHook(useWrite, { wrapper })
    await result.current.mutateAsync(input)
  }

  const REASON = 'Ticket 4411: the owner asked'

  it('sends the reason in a JSON body on every write, the DELETEs included', async () => {
    const sent = record()
    await run(() => useUpdateMemberRole('acme'), {
      userId: USER_ID_2,
      role: 'editor' as const,
      reason: REASON,
    })
    await run(() => useRemoveMember('acme'), { userId: USER_ID_2, reason: REASON })
    await run(() => useInviteMember('acme'), {
      email: 'new@example.com',
      role: 'viewer' as const,
      reason: REASON,
    })
    await run(() => useResendInvitation('acme'), { invitationId: INVITATION_ID, reason: REASON })
    await run(() => useRevokeInvitation('acme'), { invitationId: INVITATION_ID, reason: REASON })

    expect(sent.map((one) => one.contentType)).toEqual(Array(5).fill('application/json'))
    expect(sent.map((one) => JSON.parse(one.body) as unknown)).toEqual([
      { role: 'editor', reason: REASON },
      { reason: REASON },
      { email: 'new@example.com', role: 'viewer', reason: REASON },
      { reason: REASON },
      { reason: REASON },
    ])
  })

  it('sends no reason, and no body where there was none, for a member', async () => {
    const sent = record()
    await run(() => useUpdateMemberRole('acme'), { userId: USER_ID_2, role: 'editor' as const })
    await run(() => useRemoveMember('acme'), { userId: USER_ID_2 })
    await run(() => useInviteMember('acme'), { email: 'new@example.com', role: 'viewer' as const })
    await run(() => useResendInvitation('acme'), { invitationId: INVITATION_ID })
    await run(() => useRevokeInvitation('acme'), { invitationId: INVITATION_ID })

    expect(sent.map((one) => one.body)).toEqual([
      JSON.stringify({ role: 'editor' }),
      '',
      JSON.stringify({ email: 'new@example.com', role: 'viewer' }),
      '',
      '',
    ])
  })
})

describe('memberName', () => {
  it('joins the names, and falls back to the email when there are none', () => {
    expect(memberName(member)).toBe('Ada Lovelace')
    expect(memberName({ ...member, user: { ...member.user, lastName: null } })).toBe('Ada')
    expect(
      memberName({ ...member, user: { ...member.user, firstName: null, lastName: null } })
    ).toBe('ada@b.com')
  })
})
