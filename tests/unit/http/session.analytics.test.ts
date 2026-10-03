import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installInterceptors } from '@/http/interceptors'
import { ensureSession, installAnalyticsIdentity, resetSessionForTests } from '@/http/session'
import {
  initAnalytics,
  resetAnalyticsForTests,
  SUPERSEDED_RECHECK_MS,
} from '@/observability/analytics/analytics'
import { bootstrapSession } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { USER_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { analyticsConfigFor, resetFakePosthog, sdk } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

const userA = { ...testUser, id: USER_ID }
const userB = { ...testUser, id: USER_ID_2, email: 'b@b.com' }

/** The SDK calls after `init`'s own `register`. */
function sdkCalls(): string[] {
  return sdk.calls.filter((call) => !call.startsWith('register('))
}

describe('analytics identity follows the session', () => {
  beforeEach(async () => {
    resetSessionForTests()
    resetAnalyticsForTests()
    resetFakePosthog()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    installAnalyticsIdentity()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
  })

  afterEach(() => vi.restoreAllMocks())

  it('identifies a user on sign-in, by id alone, after applying their preference', () => {
    useAuthStore.getState().login('token', userA)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })

  it('opts an opted-out user out before identifying them', () => {
    sdk.consent = 'pending'
    useAuthStore.getState().login('token', { ...userA, analyticsOptOut: true })
    expect(sdkCalls()).toEqual(['opt_out_capturing()', `identify("${USER_ID}")`])
  })

  it('user A signs out and user B signs in on the same tab: reset before B, and B never as A', () => {
    useAuthStore.getState().login('token', userA)
    useAuthStore.getState().logout()
    useAuthStore.getState().login('token', userB)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()', `identify("${USER_ID_2}")`])
    expect(sdk.distinctId).toBe(USER_ID_2)
  })

  it('user B replacing user A with no sign-out in between still resets first', () => {
    useAuthStore.getState().login('token', userA)
    useAuthStore.getState().login('token', userB)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()', `identify("${USER_ID_2}")`])
  })

  it('a profile refresh for the same user neither resets nor identifies again', () => {
    useAuthStore.getState().login('token', userA)
    useAuthStore.getState().login('token', { ...userA, firstName: 'Changed' })
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })

  it('a forced sign-out (the refresh answered 401) resets', async () => {
    useAuthStore.getState().login('stale', userA)
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await expect(ensureSession()).rejects.toThrow()
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()'])
  })

  it('a 401 verdict on an API request resets', async () => {
    useAuthStore.getState().login('token', userA)
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    })
    server.use(http.get('/api/v1/widgets', () => fail('Invalid token', 401)))
    const client = axios.create({ baseURL: '/api/v1' })
    installInterceptors(client)
    await expect(client.get('/widgets')).rejects.toThrow()
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`, 'reset()'])
  })

  it('a cold load with a dead cookie, never signed in, resets nothing', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await expect(ensureSession()).rejects.toThrow()
    expect(sdkCalls()).toEqual([])
  })

  it('identifies a user restored by the session refresh', async () => {
    server.use(http.get('/api/v1/profile', () => ok(userA, 'Profile retrieved.')))
    await ensureSession()
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })

  it('another tab signing someone else in signs this tab out, alone, without resetting their person', async () => {
    useAuthStore.getState().login('token', userA)
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign })
    server.use(http.get('/api/v1/profile', () => ok(userB, 'Profile retrieved.')))
    const announced: unknown[] = []
    const listener = new BroadcastChannel('analytics-identity')
    listener.addEventListener('message', (event: MessageEvent<unknown>) =>
      announced.push(event.data)
    )
    const otherTab = new BroadcastChannel('analytics-identity')
    otherTab.postMessage({ type: 'identified', distinctId: USER_ID_2 })
    await vi.waitFor(() => expect(announced).toHaveLength(1))
    listener.close()
    otherTab.close()
    sdk.distinctId = USER_ID_2
    sdk.calls = []

    const beforeSend = sdk.initOptions?.before_send as (event: unknown) => unknown
    expect(
      beforeSend({ uuid: 'u', event: '$pageview', properties: { distinct_id: USER_ID_2 } })
    ).toBeNull()

    await vi.waitFor(() => expect(useAuthStore.getState().user).toBeNull())
    await vi.waitFor(() => expect(assign).toHaveBeenCalled())
    expect(sdk.calls).not.toContain('reset()')
    expect(sdk.distinctId).toBe(USER_ID_2)
  })

  /** Puts the fake SDK under user B, a person another tab of this app announced, and sends one event. */
  async function supersedeByAnotherTab(): Promise<(event: unknown) => unknown> {
    const announced: unknown[] = []
    const listener = new BroadcastChannel('analytics-identity')
    listener.addEventListener('message', (event: MessageEvent<unknown>) =>
      announced.push(event.data)
    )
    const otherTab = new BroadcastChannel('analytics-identity')
    otherTab.postMessage({ type: 'identified', distinctId: USER_ID_2 })
    await vi.waitFor(() => expect(announced).toHaveLength(1))
    listener.close()
    otherTab.close()
    sdk.distinctId = USER_ID_2
    sdk.userState = 'identified'
    sdk.calls = []
    const beforeSend = sdk.initOptions?.before_send as (event: unknown) => unknown
    expect(
      beforeSend({ uuid: 'u', event: '$pageview', properties: { distinct_id: USER_ID_2 } })
    ).toBeNull()
    return beforeSend
  }

  it('a supersession whose refresh returns this tab’s own user resumes it under that user', async () => {
    useAuthStore.getState().login('token', userA)
    server.use(http.get('/api/v1/profile', () => ok(userA, 'Profile retrieved.')))
    await supersedeByAnotherTab()
    await vi.waitFor(() => expect(sdk.calls).toContain(`identify("${USER_ID}")`))
    expect(useAuthStore.getState().user?.id).toBe(USER_ID)
    expect(sdk.distinctId).toBe(USER_ID)
  })

  it('a supersession whose refresh fails for a transient reason keeps the tab and retries', async () => {
    useAuthStore.getState().login('token', userA)
    let refreshes = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return fail('Unavailable', 503)
      })
    )
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    const beforeSend = await supersedeByAnotherTab()
    await vi.waitFor(() => expect(refreshes).toBe(1))
    expect(useAuthStore.getState().user?.id).toBe(USER_ID)
    now.mockReturnValue(1_000_000 + SUPERSEDED_RECHECK_MS)
    beforeSend({ uuid: 'u', event: '$pageview', properties: { distinct_id: USER_ID_2 } })
    await vi.waitFor(() => expect(refreshes).toBe(2))
    expect(sdk.calls).not.toContain('reset()')
  })

  it('a refresh that returns another user signs out without resetting that user’s shared identity', async () => {
    useAuthStore.getState().login('token', userA)
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign: vi.fn() })
    server.use(http.get('/api/v1/profile', () => ok(userB, 'Profile retrieved.')))
    sdk.calls = []
    await expect(ensureSession()).rejects.toThrow()
    expect(useAuthStore.getState().user).toBeNull()
    expect(sdk.calls).not.toContain('reset()')
  })

  it('is installed once however often it is called', () => {
    installAnalyticsIdentity()
    useAuthStore.getState().login('token', userA)
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })
})

describe('installAnalyticsIdentity with a user already signed in', () => {
  it('identifies that user at once', async () => {
    resetSessionForTests()
    resetAnalyticsForTests()
    resetFakePosthog()
    useAuthStore.setState({
      accessToken: 'token',
      user: userA,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    installAnalyticsIdentity()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })
})

describe('a cold load that ends with nobody signed in', () => {
  beforeEach(() => {
    resetSessionForTests()
    resetAnalyticsForTests()
    resetFakePosthog()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('resets a person the browser still holds, before the first event', async () => {
    sdk.distinctId = USER_ID
    sdk.userState = 'identified'
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))

    await bootstrapSession()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))

    expect(sdkCalls()).toEqual(['reset()'])
    expect(sdk.userState).toBe('anonymous')
  })

  it('also resets when the restore failed without a verdict', async () => {
    sdk.distinctId = USER_ID
    sdk.userState = 'identified'
    server.use(http.post('/api/v1/auth/refresh', () => HttpResponse.error()))

    await bootstrapSession()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))

    expect(sdkCalls()).toEqual(['reset()'])
  })

  /** Another open tab of this app, signed in as `distinctId`: it answers the facade's question. */
  function anotherTabSignedInAs(distinctId: string): () => void {
    const tab = new BroadcastChannel('analytics-identity')
    tab.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
      if (event.data.type === 'who') tab.postMessage({ type: 'identified', distinctId })
    })
    return () => tab.close()
  }

  /** The load, with time for another tab's answer to land before the SDK loads. */
  async function coldLoadAnswered(): Promise<void> {
    await bootstrapSession()
    await settle(50, 'another tab answers on the channel; nothing in this tab signals it')
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
  }

  it('a restore that cannot reach the API keeps a person another tab is signed in as', async () => {
    sdk.distinctId = USER_ID
    sdk.userState = 'identified'
    const close = anotherTabSignedInAs(USER_ID)
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unavailable', 503)))
    await coldLoadAnswered()
    close()
    expect(sdkCalls()).toEqual([])
    expect(sdk.distinctId).toBe(USER_ID)
  })

  it('a restore that answers 401 forgets the person even if another tab says it holds them', async () => {
    sdk.distinctId = USER_ID
    sdk.userState = 'identified'
    const close = anotherTabSignedInAs(USER_ID)
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await coldLoadAnswered()
    close()
    expect(sdkCalls()).toEqual(['reset()'])
  })

  it('keeps the person when the restore signs in the same user', async () => {
    sdk.distinctId = USER_ID
    sdk.userState = 'identified'
    server.use(http.get('/api/v1/profile', () => ok(userA, 'Profile retrieved.')))

    await bootstrapSession()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))

    expect(sdkCalls()).toEqual([`identify("${USER_ID}")`])
  })

  it('does nothing for an anonymous browser', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await bootstrapSession()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
    expect(sdkCalls()).toEqual([])
  })
})
