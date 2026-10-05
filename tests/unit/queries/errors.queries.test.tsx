import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { errorIssuesQueryOptions, errorsKeys } from '@/queries/errors.queries'
import { useAuthStore } from '@/states/auth.store'
import { errorIssue, errorsPage } from '@/tests/fixtures/errors'
import { TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  resetSessionForTests()
  useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
})

describe('error issue options', () => {
  it.each([
    ['user', errorIssuesQueryOptions('user', USER_ID_2)],
    ['tenant', errorIssuesQueryOptions('tenant', TENANT_ID)],
  ])('never refetches on its own, and drops the %s cache when left', (_kind, options) => {
    expect(options.retry).toBe(false)
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.refetchOnReconnect).toBe(false)
    expect(options.gcTime).toBe(0)
    expect(options.staleTime).toBe(30_000)
  })

  it('keys each list by kind and id', () => {
    expect(errorIssuesQueryOptions('user', USER_ID_2).queryKey).toEqual([
      'errors',
      'user',
      USER_ID_2,
    ])
    expect(errorIssuesQueryOptions('tenant', TENANT_ID).queryKey).toEqual(
      errorsKeys.list('tenant', TENANT_ID)
    )
  })

  it.each([
    ['user', USER_ID_2, `/api/v1/platform/users/${USER_ID_2}/errors`],
    ['tenant', TENANT_ID, `/api/v1/platform/tenants/${TENANT_ID}/errors`],
  ] as const)('reads a %s’s errors from its own route, with no query', async (kind, id, path) => {
    const seen: string[] = []
    server.use(
      http.get(path, ({ request }) => {
        seen.push(new URL(request.url).search)
        return ok(errorsPage([errorIssue()]), 'Errors retrieved.')
      })
    )
    const { result } = renderHook(() => useQuery(errorIssuesQueryOptions(kind, id)), {
      wrapper: wrapperWith(new QueryClient()),
    })
    await waitFor(() => expect(result.current.data).toEqual(errorsPage([errorIssue()])))
    expect(seen).toEqual([''])
  })
})
