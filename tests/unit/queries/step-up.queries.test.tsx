import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { useConfirmStepUpLink, useRequestStepUpLink } from '@/queries/step-up.queries'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const LINK_TOKEN = 't'.repeat(43)

/** A provider around a fresh client that does not retry mutations. */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  )
}

describe('useRequestStepUpLink', () => {
  it('posts { app: "apex" }', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/auth/step-up/link/request', async ({ request }) => {
        body = await request.json()
        return ok({ resendAvailableAt: new Date().toISOString() }, 'Check your inbox.', 202)
      })
    )
    const { result } = renderHook(() => useRequestStepUpLink(), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(body).toEqual({ app: 'apex' })
  })
})

describe('useConfirmStepUpLink', () => {
  /** Opens a channel standing in for the tab that waits on the confirmation. */
  function openWaitingTab() {
    const tab = new BroadcastChannel('auth')
    const received: unknown[] = []
    tab.addEventListener('message', (event: MessageEvent<unknown>) => {
      received.push(event.data)
    })
    return { tab, received }
  }

  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('posts the token with the session bearer, swaps the token in and tells the waiting tab', async () => {
    let body: unknown
    let authorization: string | null = null
    server.use(
      http.post('/api/v1/auth/step-up/link/verify', async ({ request }) => {
        body = await request.json()
        authorization = request.headers.get('authorization')
        return ok({ accessToken: 'stepped-up' }, 'Identity confirmed.')
      })
    )
    const { tab, received } = openWaitingTab()

    const { result } = renderHook(() => useConfirmStepUpLink(), { wrapper })
    const answer = await act(() => result.current.mutateAsync(LINK_TOKEN))

    expect(answer).toEqual({ accessToken: 'stepped-up' })
    expect(body).toEqual({ token: LINK_TOKEN })
    expect(authorization).toBe('Bearer access-token')
    expect(useAuthStore.getState().accessToken).toBe('stepped-up')
    expect(useAuthStore.getState().user).toEqual(testUser)
    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
    tab.close()
  })

  /**
   * Answers the verify with an expired-token 401 first, then `then`; and the refresh with `refresh`.
   * @returns The bearer of each verify, and the refresh count.
   */
  function serveExpiredOnce(
    refresh: () => Response,
    then = () => ok({ accessToken: 'stepped-up' })
  ) {
    const seen = { bearers: [] as (string | null)[], refreshes: 0 }
    server.use(
      http.post('/api/v1/auth/step-up/link/verify', ({ request }) => {
        seen.bearers.push(request.headers.get('authorization'))
        return seen.bearers.length === 1
          ? fail('Your sign-in expired. Sign in again to continue.', 401, 'ACCESS_TOKEN_EXPIRED')
          : then()
      }),
      http.post('/api/v1/auth/refresh', () => {
        seen.refreshes += 1
        return refresh()
      })
    )
    return seen
  }

  // Access tokens and links both last 15 minutes: an expired bearer on a live session must not read as its end.
  it('refreshes an expired access token once, then posts the token again', async () => {
    const seen = serveExpiredOnce(() => ok({ accessToken: 'fresh-token' }, 'Session refreshed.'))
    const { tab, received } = openWaitingTab()

    const { result } = renderHook(() => useConfirmStepUpLink(), { wrapper })
    const answer = await act(() => result.current.mutateAsync(LINK_TOKEN))

    expect(answer).toEqual({ accessToken: 'stepped-up' })
    expect(seen).toEqual({ bearers: ['Bearer access-token', 'Bearer fresh-token'], refreshes: 1 })
    expect(useAuthStore.getState().accessToken).toBe('stepped-up')
    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
    tab.close()
  })

  it('rejects with the original 401 when the refresh is refused, and redirects nowhere', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const seen = serveExpiredOnce(() => fail('Unauthorized', 401))
    const { tab, received } = openWaitingTab()

    const { result } = renderHook(() => useConfirmStepUpLink(), { wrapper })
    result.current.mutate(LINK_TOKEN)

    await waitFor(() => expect(result.current.isError).toBe(true))
    vi.unstubAllGlobals()
    await settle(0, 'absence has no event: let any queued channel delivery run')
    tab.close()
    expect(statusFrom(result.current.error)).toBe(401)
    expect(codeFrom(result.current.error)).toBe('ACCESS_TOKEN_EXPIRED')
    expect(seen.bearers).toHaveLength(1)
    expect(seen.refreshes).toBe(1)
    expect(assign).not.toHaveBeenCalled()
    expect(received).not.toContainEqual({ type: 'step_up_confirmed' })
  })

  it('rejects with the refresh failure when the refresh only failed to run', async () => {
    const seen = serveExpiredOnce(() => fail('Service Unavailable', 503))

    const { result } = renderHook(() => useConfirmStepUpLink(), { wrapper })
    result.current.mutate(LINK_TOKEN)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(statusFrom(result.current.error)).toBe(503)
    expect(seen.bearers).toHaveLength(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('does not refresh on a 401 that is not an expired token', async () => {
    let calls = 0
    let refreshes = 0
    server.use(
      http.post('/api/v1/auth/step-up/link/verify', () => {
        calls += 1
        return fail('Unauthorized', 401)
      }),
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return ok({ accessToken: 'fresh-token' }, 'Session refreshed.')
      })
    )

    const { result } = renderHook(() => useConfirmStepUpLink(), { wrapper })
    result.current.mutate(LINK_TOKEN)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
    expect(refreshes).toBe(0)
    expect(useAuthStore.getState().accessToken).toBe('access-token')
  })
})
