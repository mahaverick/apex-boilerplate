import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { platformStatsQueryOptions, systemStatusQueryOptions } from '@/queries/platform.queries'
import {
  platformTenantsQueryOptions,
  usePlatformTenantSearch,
} from '@/queries/tenant-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testSystemStatus, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('usePlatformTenantSearch', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    // `retry: 1` like the router's client, with no delay, so the hook's own retry rule is what decides.
    client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  // A non-staff caller gets a 404 here; asking again changes nothing, the same reason `usePlatformAuditLog` does not retry one either.
  it('does not retry a 404', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return fail('Not found', 404)
      })
    )

    const { result } = renderHook(() => usePlatformTenantSearch('', { enabled: true }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
  })

  it('retries any other failure once', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return fail('Something went wrong.', 500)
      })
    )

    const { result } = renderHook(() => usePlatformTenantSearch('', { enabled: true }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(2)
  })

  /** Serves a 404 at `path`, runs `fetch`, and returns how many requests it took. */
  async function requestsOn404(path: string, fetch: () => Promise<unknown>): Promise<number> {
    let calls = 0
    server.use(
      http.get(path, () => {
        calls += 1
        return fail('Not found', 404)
      })
    )
    await expect(fetch()).rejects.toBeDefined()
    return calls
  }

  // Both options gate on who is asking; a 404 is that answer, so a second request could only repeat it.
  it('platformStatsQueryOptions makes exactly one request on a 404', async () => {
    const calls = await requestsOn404('/api/v1/platform/stats', () =>
      client.fetchQuery(platformStatsQueryOptions('7d'))
    )
    expect(calls).toBe(1)
  })

  it('systemStatusQueryOptions makes exactly one request on a 404', async () => {
    const calls = await requestsOn404('/api/v1/platform/system/status', () =>
      client.fetchQuery(systemStatusQueryOptions())
    )
    expect(calls).toBe(1)
  })

  it('platformTenantsQueryOptions makes exactly one request on a 404', async () => {
    const calls = await requestsOn404('/api/v1/platform/tenants', () =>
      client.fetchQuery(platformTenantsQueryOptions({ q: '', limit: 5 }))
    )
    expect(calls).toBe(1)
  })
})

describe('systemStatusQueryOptions', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Serves `answer` at the status route and returns the request count so far. */
  function serveStatus(answer: () => Response): () => number {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/system/status', () => {
        calls += 1
        return answer()
      })
    )
    return () => calls
  }

  it('asks again every minute, and never from a hidden tab', async () => {
    // Only the interval is faked, so MSW's timers and vi.waitFor's polling still run.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const calls = serveStatus(() => ok(testSystemStatus, 'OK'))
    const options = systemStatusQueryOptions()
    expect(options.queryKey).toEqual(['platform', 'system', 'status'])
    expect(options.refetchIntervalInBackground).toBeUndefined()
    const { result } = renderHook(() => useQuery(systemStatusQueryOptions()), { wrapper })
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls()).toBe(1)
    vi.advanceTimersByTime(60_000)
    await vi.waitFor(() => expect(calls()).toBe(2))
  })

  // A 404 answers who is asking; polling it every minute could only repeat the answer.
  it('stops asking after a 404', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const calls = serveStatus(() => fail('Not found', 404))
    const { result } = renderHook(() => useQuery(systemStatusQueryOptions()), { wrapper })
    await vi.waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls()).toBe(1)
    vi.advanceTimersByTime(60_000)
    vi.advanceTimersByTime(60_000)
    await settle(50, 'a negative check: no request the interval could have started arrives')
    expect(calls()).toBe(1)
  })
})
