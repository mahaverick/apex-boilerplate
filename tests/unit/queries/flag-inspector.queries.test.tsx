import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import {
  flagInspectorKeys,
  flagsEvaluateQueryOptions,
  flagsListQueryOptions,
} from '@/queries/flag-inspector.queries'
import { useAuthStore } from '@/states/auth.store'
import { flagsEvaluation, flagsList } from '@/tests/fixtures/flags'
import { TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
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

describe('flags inspector options', () => {
  it('keys every read under platform, apart from the app’s own flag values', () => {
    expect(flagsListQueryOptions().queryKey).toEqual(['platform', 'flags', 'list'])
    expect(
      flagsEvaluateQueryOptions({ userId: USER_ID_2, tenantId: TENANT_ID, app: 'react' }).queryKey
    ).toEqual(['platform', 'flags', 'evaluate', USER_ID_2, TENANT_ID, 'react'])
    expect(flagsEvaluateQueryOptions({ userId: USER_ID_2, app: 'apex' }).queryKey).toEqual(
      flagInspectorKeys.evaluate({ userId: USER_ID_2, app: 'apex' })
    )
    expect(flagInspectorKeys.all).toEqual(['platform', 'flags'])
  })

  it('never refetches an evaluation on its own, and drops it when left', () => {
    const options = flagsEvaluateQueryOptions({ userId: USER_ID_2, app: 'react' })
    expect(options.retry).toBe(false)
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.refetchOnReconnect).toBe(false)
    expect(options.gcTime).toBe(0)
    expect(options.staleTime).toBe(30_000)
  })

  it('reads the list from /platform/flags', async () => {
    server.use(http.get('/api/v1/platform/flags', () => ok(flagsList(), 'Flags retrieved.')))
    const { result } = renderHook(() => useQuery(flagsListQueryOptions()), {
      wrapper: wrapperWith(new QueryClient()),
    })
    await waitFor(() => expect(result.current.data).toEqual(flagsList()))
  })

  it('does not retry the list on a 404, which answers who is asking', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/flags', () => {
        calls += 1
        return fail('Not found', 404)
      })
    )
    const { result } = renderHook(() => useQuery(flagsListQueryOptions()), {
      wrapper: wrapperWith(new QueryClient()),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
  })

  it.each([
    [
      { userId: USER_ID_2, tenantId: TENANT_ID, app: 'react' as const },
      `?userId=${USER_ID_2}&tenantId=${TENANT_ID}&app=react`,
    ],
    [{ userId: USER_ID_2, app: 'apex' as const }, `?userId=${USER_ID_2}&app=apex`],
  ])('sends the user, the tenant only when chosen, and the app', async (params, search) => {
    const seen: string[] = []
    server.use(
      http.get('/api/v1/platform/flags/evaluate', ({ request }) => {
        seen.push(new URL(request.url).search)
        return ok(flagsEvaluation(), 'Flags evaluated.')
      })
    )
    const { result } = renderHook(() => useQuery(flagsEvaluateQueryOptions(params)), {
      wrapper: wrapperWith(new QueryClient()),
    })
    await waitFor(() => expect(result.current.data).toEqual(flagsEvaluation()))
    expect(seen).toEqual([search])
  })
})
