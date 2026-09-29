import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { memberName, tenantKeys, useMembers, type TenantMember } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { MEMBERSHIP_ID, PLATFORM_TENANT_ID, USER_ID } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
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

describe('memberName', () => {
  it('joins the names, and falls back to the email when there are none', () => {
    expect(memberName(member)).toBe('Ada Lovelace')
    expect(memberName({ ...member, user: { ...member.user, lastName: null } })).toBe('Ada')
    expect(
      memberName({ ...member, user: { ...member.user, firstName: null, lastName: null } })
    ).toBe('ada@b.com')
  })
})
