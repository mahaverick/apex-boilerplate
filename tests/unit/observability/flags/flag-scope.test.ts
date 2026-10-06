import { QueryClient } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { renderHook } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  capturePageview,
  initAnalytics,
  resetAnalyticsForTests,
} from '@/observability/analytics/analytics'
import { ensureFlags } from '@/observability/flags/flag-query'
import {
  flagsPathFor,
  installRouteFeatureProperties,
  PLATFORM_FLAG_SCOPE,
  useFlagScope,
} from '@/observability/flags/flag-scope'
import { forgetFeatureProperties } from '@/observability/flags/register'
import { ok, testFlags } from '@/tests/mocks/handlers'
import { analyticsConfigFor, instance, resetFakePosthog, sdk } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

describe('apex flag scope', () => {
  it('is always the platform scope: staff are evaluated with no tenant', () => {
    expect(renderHook(() => useFlagScope()).result.current).toEqual({ kind: 'platform' })
    expect(PLATFORM_FLAG_SCOPE).toEqual({ kind: 'platform' })
  })

  it('reads the platform scope from /platform/me/flags', () => {
    expect(flagsPathFor(PLATFORM_FLAG_SCOPE)).toBe('/platform/me/flags')
  })

  it('names the customer app’s endpoints for the other scopes, slug encoded', () => {
    expect(flagsPathFor({ kind: 'none' })).toBe('/flags')
    expect(flagsPathFor({ kind: 'tenant', slug: 'acme' })).toBe('/tenants/acme/flags')
    expect(flagsPathFor({ kind: 'tenant', slug: 'a/b' })).toBe('/tenants/a%2Fb/flags')
  })
})

describe('installRouteFeatureProperties', () => {
  let features: Record<string, unknown>[]
  let uninstall: () => void = () => {}

  beforeEach(() => {
    resetAnalyticsForTests()
    resetFakePosthog()
    forgetFeatureProperties()
    features = []
    instance.capture.mockImplementation(() => {
      features.push(
        Object.fromEntries(
          Object.entries(sdk.properties).filter(([name]) => name.startsWith('$feature/'))
        )
      )
    })
    server.use(
      http.get('/api/v1/platform/me/flags', () =>
        ok(testFlags({ test_bool: true, test_exp: 'bold' }))
      )
    )
  })

  afterEach(() => {
    uninstall()
    instance.capture.mockRestore()
  })

  /** The router's shape at boot: the `_app` loader warms the flags, `onResolved` captures the page view. */
  function makeRouter(queryClient: QueryClient) {
    const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
      component: Outlet,
    })
    const appRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: '_app',
      loader: ({ context }) => ensureFlags(context.queryClient, PLATFORM_FLAG_SCOPE),
    })
    const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/' })
    const router = createRouter({
      routeTree: rootRoute.addChildren([appRoute.addChildren([homeRoute])]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient },
    })
    const stopPageviews = router.subscribe('onResolved', ({ pathChanged }) => {
      if (pathChanged) capturePageview()
    })
    const stopSync = installRouteFeatureProperties(router, queryClient)
    uninstall = () => {
      stopPageviews()
      stopSync()
    }
    return router
  }

  it('the landing page view, loaded before React mounts as main.tsx does, carries the flags', async () => {
    const router = makeRouter(new QueryClient())
    await router.load()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))

    expect(features).toHaveLength(1)
    expect(features[0]).toMatchObject({ '$feature/test_bool': true, '$feature/test_exp': 'bold' })
  })
})
