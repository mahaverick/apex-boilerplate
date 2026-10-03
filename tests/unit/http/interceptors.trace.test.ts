import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import * as analytics from '@/observability/analytics'
import { initAnalytics, resetAnalyticsForTests } from '@/observability/analytics/analytics'
import { useAuthStore } from '@/states/auth.store'
import { USER_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
import { analyticsConfigFor, resetFakePosthog, sdk } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
const SESSION_ID = '01a0fc35-b7fe-7546-a76f-fea28a1f3cbe'

function makeClient() {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true })
  installInterceptors(client)
  return client
}

/** Answers `url` with the headers it received. */
function echoHeaders(url: string) {
  const seen: Headers[] = []
  server.use(
    http.get(url, ({ request }) => {
      seen.push(request.headers)
      return ok({})
    })
  )
  return seen
}

describe('the trace headers', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
    vi.restoreAllMocks()
  })

  it('send a fresh traceparent on every API request, and no session id while analytics is off', async () => {
    const seen = echoHeaders('/api/v1/widgets')
    const client = makeClient()
    await client.get('/widgets')
    await client.get('/widgets')
    expect(seen[0]?.get('traceparent')).toMatch(TRACEPARENT)
    expect(seen[1]?.get('traceparent')).toMatch(TRACEPARENT)
    expect(seen[0]?.get('traceparent')).not.toBe(seen[1]?.get('traceparent'))
    expect(seen[0]?.has('x-posthog-session-id')).toBe(false)
  })

  it('add the analytics session id when there is one', async () => {
    vi.spyOn(analytics, 'getAnalyticsSessionIdFor').mockReturnValue(SESSION_ID)
    const seen = echoHeaders('/api/v1/widgets')
    await makeClient().get('/widgets')
    expect(seen[0]?.get('x-posthog-session-id')).toBe(SESSION_ID)
  })

  it('keep a traceparent the request already carries', async () => {
    const seen = echoHeaders('/api/v1/widgets')
    const own = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`
    await makeClient().get('/widgets', { headers: { traceparent: own } })
    expect(seen[0]?.get('traceparent')).toBe(own)
  })

  it('never reach a request that leaves the API', async () => {
    vi.spyOn(analytics, 'getAnalyticsSessionIdFor').mockReturnValue(SESSION_ID)
    const seen: Headers[] = []
    server.use(
      http.get('https://elsewhere.example/thing', ({ request }) => {
        seen.push(request.headers)
        return HttpResponse.json({ success: true, data: {} })
      }),
      http.get('/not-the-api', ({ request }) => {
        seen.push(request.headers)
        return HttpResponse.json({ success: true, data: {} })
      })
    )
    const client = makeClient()
    await client.get('https://elsewhere.example/thing')
    await client.get('/not-the-api', { baseURL: '/' })
    expect(seen).toHaveLength(2)
    for (const headers of seen) {
      expect(headers.has('traceparent')).toBe(false)
      expect(headers.has('x-posthog-session-id')).toBe(false)
    }
  })
})

describe('the session header and whose session it is', () => {
  beforeEach(() => {
    resetSessionForTests()
    vi.restoreAllMocks()
  })

  it('asks for the session of the signed-in user, or of nobody', async () => {
    const spy = vi.spyOn(analytics, 'getAnalyticsSessionIdFor').mockReturnValue(undefined)
    echoHeaders('/api/v1/widgets')
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapped: true })
    await makeClient().get('/widgets')
    useAuthStore.setState({ user: { ...testUser, id: USER_ID }, accessToken: 't' })
    await makeClient().get('/widgets')
    expect(spy.mock.calls).toEqual([[null], [USER_ID]])
  })

  describe('over the facade', () => {
    beforeEach(async () => {
      resetAnalyticsForTests()
      resetFakePosthog()
      await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
      useAuthStore.setState({ accessToken: null, user: null, isAuthenticated: false })
    })

    async function sent(): Promise<string | null | undefined> {
      const seen = echoHeaders('/api/v1/widgets')
      await makeClient().get('/widgets')
      return seen[0]?.get('x-posthog-session-id')
    }

    it('sends it while PostHog is anonymous, the sign-in request included', async () => {
      expect(await sent()).toBe(sdk.sessionId)
    })

    it('sends none when PostHog holds a person and nobody, or somebody else, is signed in', async () => {
      sdk.userState = 'identified'
      sdk.distinctId = USER_ID
      expect(await sent()).toBeNull()
      useAuthStore.setState({ user: { ...testUser, id: USER_ID_2 }, isAuthenticated: true })
      expect(await sent()).toBeNull()
    })

    it('sends it when PostHog holds the signed-in user', async () => {
      sdk.userState = 'identified'
      sdk.distinctId = USER_ID
      useAuthStore.setState({ user: { ...testUser, id: USER_ID }, isAuthenticated: true })
      expect(await sent()).toBe(sdk.sessionId)
    })
  })
})
