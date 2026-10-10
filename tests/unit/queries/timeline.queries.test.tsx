import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import {
  flattenTimelinePages,
  refreshTimeline,
  timelineInfiniteOptions,
  timelineKeys,
} from '@/queries/timeline.queries'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { eventId, timelinePage, timelineRow } from '@/tests/fixtures/timeline'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** Answers the user timeline in two pages, recording each request's query string. */
function serveTwoPages(seen: URLSearchParams[]) {
  server.use(
    http.get(`/api/v1/platform/users/${USER_ID_2}/timeline`, ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      return params.get('before') === 'cursor-2'
        ? ok(timelinePage([timelineRow({ uuid: eventId(2) })]), 'Timeline retrieved.')
        : ok(timelinePage([timelineRow({ uuid: eventId(1) })], 'cursor-2'), 'Timeline retrieved.')
    })
  )
}

describe('timeline options', () => {
  it.each([
    ['user', timelineInfiniteOptions('user', USER_ID_2, '7d', 'all')],
    ['tenant', timelineInfiniteOptions('tenant', TENANT_ID, '7d', 'all')],
  ])('never refetches on its own, and drops the %s cache when left', (_kind, options) => {
    expect(options.retry).toBe(false)
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.refetchOnReconnect).toBe(false)
    expect(options.gcTime).toBe(0)
  })
})

beforeEach(() => {
  resetSessionForTests()
  useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
})

describe('timeline queries', () => {
  it('keys each timeline by kind, id, window and view', () => {
    expect(timelineInfiniteOptions('user', USER_ID_2, '7d', 'all').queryKey).toEqual([
      'timeline',
      'user',
      USER_ID_2,
      '7d',
      'all',
    ])
    expect(timelineInfiniteOptions('tenant', TENANT_ID, '90d', 'key').queryKey).toEqual(
      timelineKeys.page('tenant', TENANT_ID, '90d', 'key')
    )
    expect(timelineInfiniteOptions('user', USER_ID_2, '7d', 'all').staleTime).toBe(30_000)
  })

  it('asks for the first page with no cursor, then pages with the one the API returned', async () => {
    const seen: URLSearchParams[] = []
    serveTwoPages(seen)
    const client = new QueryClient()
    const { result } = renderHook(
      () => useInfiniteQuery(timelineInfiniteOptions('user', USER_ID_2, '30d', 'key')),
      { wrapper: wrapperWith(client) }
    )
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    expect(seen[0]?.get('range')).toBe('30d')
    expect(seen[0]?.get('view')).toBe('key')
    expect(seen[0]?.has('before')).toBe(false)

    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
    expect(seen[1]?.get('before')).toBe('cursor-2')
    expect(flattenTimelinePages(result.current.data).map((row) => row.uuid)).toEqual([
      eventId(1),
      eventId(2),
    ])
  })

  it('reads a tenant’s timeline from the tenant route', async () => {
    const seen: string[] = []
    server.use(
      http.get(`/api/v1/platform/tenants/${TENANT_ID}/timeline`, ({ request }) => {
        seen.push(new URL(request.url).search)
        return ok(timelinePage([]), 'Timeline retrieved.')
      })
    )
    const { result } = renderHook(
      () => useInfiniteQuery(timelineInfiniteOptions('tenant', TENANT_ID, '24h', 'all')),
      { wrapper: wrapperWith(new QueryClient()) }
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen).toEqual(['?range=24h&view=all'])
  })

  it('has no next page and no rows when timelines are not configured', async () => {
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}/timeline`, () =>
        ok({ configured: false }, 'Timeline retrieved.')
      )
    )
    const { result } = renderHook(
      () => useInfiniteQuery(timelineInfiniteOptions('user', USER_ID_2, '7d', 'all')),
      { wrapper: wrapperWith(new QueryClient()) }
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(false)
    expect(flattenTimelinePages(result.current.data)).toEqual([])
  })

  it('does not retry a failed first page, which express would audit again', async () => {
    let calls = 0
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}/timeline`, () => {
        calls += 1
        return fail('PostHog unavailable', 502)
      })
    )
    const { result } = renderHook(
      () => useInfiniteQuery(timelineInfiniteOptions('user', USER_ID_2, '7d', 'all')),
      // The app's own default retry, which the timeline options must override.
      { wrapper: wrapperWith(new QueryClient({ defaultOptions: { queries: { retry: 1 } } })) }
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
  })

  it('refreshes by refetching the first page alone', async () => {
    const seen: URLSearchParams[] = []
    serveTwoPages(seen)
    const client = new QueryClient()
    const options = timelineInfiniteOptions('user', USER_ID_2, '7d', 'all')
    const { result } = renderHook(() => useInfiniteQuery(options), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))

    await act(() => refreshTimeline(client, options.queryKey))

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    expect(seen).toHaveLength(3)
    expect(seen[2]?.has('before')).toBe(false)
    expect(result.current.hasNextPage).toBe(true)
  })

  it('flattens nothing when there is no data yet', () => {
    expect(flattenTimelinePages(undefined)).toEqual([])
  })
})
