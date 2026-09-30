import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { auditKeys } from '@/queries/audit.queries'
import {
  platformUsersQueryOptions,
  useDeleteUser,
  usePurgeUser,
  userAdminKeys,
} from '@/queries/user-admin.queries'
import { USER_ID_2 } from '@/tests/fixtures/ids'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A History card's cached page: every write must mark it stale. */
const AUDIT_KEY = auditKeys.platform({ targetId: USER_ID_2 })

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('user-admin queries', () => {
  it('sends only the filters that are set, trimmed, with the API parameter names', async () => {
    let seen: URLSearchParams | undefined
    server.use(
      http.get('/api/v1/platform/users', ({ request }) => {
        seen = new URL(request.url).searchParams
        return ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      })
    )
    const client = new QueryClient()
    await client.fetchQuery(
      platformUsersQueryOptions({
        q: '  ada ',
        status: 'inactive',
        verified: false,
        cursor: 'c1',
        direction: 'prev',
      })
    )
    expect(Object.fromEntries(seen!)).toEqual({
      q: 'ada',
      status: 'inactive',
      verified: 'false',
      cursor: 'c1',
      direction: 'prev',
      limit: '20',
    })
  })

  it('sends a DELETE body with the reason and refreshes the detail, which now shows the deleted account', async () => {
    let body: unknown
    server.use(
      http.delete(`/api/v1/platform/users/${USER_ID_2}`, async ({ request }) => {
        body = await request.json()
        return ok(null, 'User deleted.')
      })
    )
    const client = new QueryClient()
    client.setQueryData(userAdminKeys.detail(USER_ID_2), { id: USER_ID_2 })
    client.setQueryData(AUDIT_KEY, { pages: [], pageParams: [] })
    const { result } = renderHook(() => useDeleteUser(), { wrapper: wrapperWith(client) })
    result.current.mutate({ userId: USER_ID_2, reason: 'Spam account' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ reason: 'Spam account' })
    expect(client.getQueryState(userAdminKeys.detail(USER_ID_2))?.isInvalidated).toBe(true)
    expect(client.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true)
  })

  it('purges with the reason and drops the user from the cache', async () => {
    let body: unknown
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/purge`, async ({ request }) => {
        body = await request.json()
        return ok(null, 'User permanently deleted.')
      })
    )
    const client = new QueryClient()
    client.setQueryData(userAdminKeys.detail(USER_ID_2), { id: USER_ID_2 })
    client.setQueryData(AUDIT_KEY, { pages: [], pageParams: [] })
    const { result } = renderHook(() => usePurgeUser({ onPurged: async () => {} }), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ userId: USER_ID_2, reason: 'Erasure request' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ reason: 'Erasure request' })
    expect(client.getQueryData(userAdminKeys.detail(USER_ID_2))).toBeUndefined()
    expect(client.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true)
  })
})
