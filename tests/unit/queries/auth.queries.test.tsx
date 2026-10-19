import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENT_KEY_PREFIX } from '@/components/shared/command-palette/recent-keys'
import { resetSessionForTests } from '@/http/session'
import { track, yieldSharedIdentity } from '@/observability/telemetry'
import {
  useConfirmStepUpLink,
  useRequestSignInLink,
  useRevokeOtherSessions,
  useVerifySignInLink,
} from '@/queries/auth.queries'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
  yieldSharedIdentity: vi.fn(),
}))

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

describe('useRevokeOtherSessions', () => {
  // With the refresh cookie the API spares only the chain it names; without it, the whole calling session is kept, sibling chains included.
  it('posts an empty JSON body with credentials, so the refresh cookie travels, and answers the count', async () => {
    const seen: { body?: string; contentType?: string | null; credentials?: string } = {}
    server.use(
      http.post('/api/v1/auth/sessions/revoke-others', async ({ request }) => {
        seen.body = await request.text()
        seen.contentType = request.headers.get('content-type')
        seen.credentials = request.credentials
        return ok({ revoked: 2 }, 'Other sessions signed out.')
      })
    )
    const { result } = renderHook(() => useRevokeOtherSessions(), { wrapper })
    const answer = await act(() => result.current.mutateAsync())
    expect(answer).toEqual({ revoked: 2 })
    expect(seen).toEqual({
      body: '{}',
      contentType: 'application/json',
      credentials: 'include',
    })
  })
})

describe('sign-in link queries', () => {
  let client: QueryClient

  /** Provides the per-test `client` to the hook under test. */
  function linkWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  /** Opens a channel standing in for another tab, and collects what it hears. */
  function openOtherTab() {
    const tab = new BroadcastChannel('auth')
    const received: unknown[] = []
    tab.addEventListener('message', (event: MessageEvent<unknown>) => {
      received.push(event.data)
    })
    return { tab, received }
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    resetSessionForTests()
    vi.mocked(track).mockReset()
    vi.mocked(yieldSharedIdentity).mockReset()
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
  })

  describe('useRequestSignInLink', () => {
    // Express defaults a missing `app` to 'web', which would mail staff a customer-app link.
    it('requests a link for the apex app with no bearer', async () => {
      let body: unknown
      let authorization: string | null = 'unset'
      server.use(
        http.post('/api/v1/auth/link/request', async ({ request }) => {
          body = await request.json()
          authorization = request.headers.get('authorization')
          return ok(null, 'Check your inbox for a sign-in link.', 202)
        })
      )
      // A signed-in tab must not send its bearer either.
      useAuthStore.getState().login('access-token', testUser)

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper: linkWrapper })
      result.current.mutate({ email: 'a@b.test' })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ email: 'a@b.test', app: 'apex' })
      expect(authorization).toBeNull()
      expect(track).toHaveBeenCalledWith('sign_in_link_requested')
    })

    it('sends the redirect when one is given', async () => {
      let body: unknown
      server.use(
        http.post('/api/v1/auth/link/request', async ({ request }) => {
          body = await request.json()
          return ok(null, 'Check your inbox for a sign-in link.', 202)
        })
      )

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper: linkWrapper })
      result.current.mutate({ email: 'a@b.test', redirect: '/tenants/acme' })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ email: 'a@b.test', app: 'apex', redirect: '/tenants/acme' })
    })

    it('does not retry a 401 or refresh the session', async () => {
      let calls = 0
      let refreshes = 0
      server.use(
        http.post('/api/v1/auth/link/request', () => {
          calls += 1
          return fail('Unauthorized', 401)
        }),
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
        })
      )

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper: linkWrapper })
      result.current.mutate({ email: 'a@b.test' })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(calls).toBe(1)
      expect(refreshes).toBe(0)
    })

    it('tracks nothing when the request fails', async () => {
      server.use(http.post('/api/v1/auth/link/request', () => fail('Too many requests.', 429)))

      const { result } = renderHook(() => useRequestSignInLink(), { wrapper: linkWrapper })
      result.current.mutate({ email: 'a@b.test' })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(track).not.toHaveBeenCalled()
    })
  })

  describe('useVerifySignInLink', () => {
    it('tracks sign_in_completed after the store signs in', async () => {
      let body: unknown
      let authorization: string | null = 'unset'
      server.use(
        http.post('/api/v1/auth/link/verify', async ({ request }) => {
          body = await request.json()
          authorization = request.headers.get('authorization')
          return ok(
            { user: testUser, accessToken: 'link-token', isNewUser: false, redirect: '/tenants' },
            'Signed in.'
          )
        })
      )
      let signedInAtTrack: boolean | undefined
      vi.mocked(track).mockImplementation(() => {
        signedInAtTrack = useAuthStore.getState().isAuthenticated
      })

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper: linkWrapper })
      result.current.mutate(LINK_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual({ token: LINK_TOKEN })
      expect(authorization).toBeNull()
      expect(result.current.data).toEqual({
        user: testUser,
        accessToken: 'link-token',
        isNewUser: false,
        redirect: '/tenants',
      })
      expect(useAuthStore.getState().user).toEqual(testUser)
      expect(useAuthStore.getState().accessToken).toBe('link-token')
      expect(track).toHaveBeenCalledWith('sign_in_completed', { method: 'link' })
      expect(signedInAtTrack).toBe(true)
    })

    it('does not retry a 401 or refresh the session', async () => {
      let calls = 0
      let refreshes = 0
      server.use(
        http.post('/api/v1/auth/link/verify', () => {
          calls += 1
          return fail('Unauthorized', 401)
        }),
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
        })
      )

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper: linkWrapper })
      result.current.mutate(LINK_TOKEN)

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(calls).toBe(1)
      expect(refreshes).toBe(0)
    })

    it('leaves the store signed out on a 400 LINK_INVALID', async () => {
      server.use(
        http.post('/api/v1/auth/link/verify', () =>
          fail('This link has expired or was already used.', 400, 'LINK_INVALID')
        )
      )

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper: linkWrapper })
      result.current.mutate(LINK_TOKEN)

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(track).not.toHaveBeenCalled()
    })

    it('switches out a different signed-in user before signing in', async () => {
      const other = { ...testUser, id: 'other-user-id', email: 'other@b.test' }
      useAuthStore.getState().login('other-token', other)
      client.setQueryData(['tenants', 'secret'], { owner: other.id })
      localStorage.setItem(`${RECENT_KEY_PREFIX}${other.id}`, '["x"]')
      const { tab, received } = openOtherTab()

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper: linkWrapper })
      result.current.mutate(LINK_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      await vi.waitFor(() => expect(received).toContainEqual({ type: 'logout' }))
      tab.close()
      expect(client.getQueryData(['tenants', 'secret'])).toBeUndefined()
      expect(localStorage.getItem(`${RECENT_KEY_PREFIX}${other.id}`)).toBeNull()
      expect(yieldSharedIdentity).toHaveBeenCalledOnce()
      expect(useAuthStore.getState().user).toEqual(testUser)
      expect(useAuthStore.getState().accessToken).toBe('link-token')
    })

    it('keeps the cache and sends no broadcast for the same user', async () => {
      useAuthStore.getState().login('old-token', testUser)
      client.setQueryData(['tenants', 'mine'], { ok: true })
      const { tab, received } = openOtherTab()

      const { result } = renderHook(() => useVerifySignInLink(), { wrapper: linkWrapper })
      result.current.mutate(LINK_TOKEN)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      await settle(0, 'absence has no event: let any queued channel delivery run')
      tab.close()
      expect(received).toEqual([])
      expect(client.getQueryData(['tenants', 'mine'])).toEqual({ ok: true })
      expect(yieldSharedIdentity).not.toHaveBeenCalled()
    })
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

  // A refresh-and-retry would turn the session's end into /login?redirect=/auth/confirm?token=….
  it('does not refresh or retry on a 401, and keeps the store as it was', async () => {
    let calls = 0
    let refreshes = 0
    server.use(
      http.post('/api/v1/auth/step-up/link/verify', () => {
        calls += 1
        return fail('Session ended', 401, 'ACCESS_TOKEN_EXPIRED')
      }),
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )
    const { tab, received } = openWaitingTab()

    const { result } = renderHook(() => useConfirmStepUpLink(), { wrapper })
    result.current.mutate(LINK_TOKEN)

    await waitFor(() => expect(result.current.isError).toBe(true))
    await settle(0, 'absence has no event: let any queued channel delivery run')
    tab.close()
    expect(calls).toBe(1)
    expect(refreshes).toBe(0)
    expect(received).toEqual([])
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'access-token',
      isAuthenticated: true,
    })
  })
})
