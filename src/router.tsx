import { QueryClient } from '@tanstack/react-query'
import { createRouter, type LinkProps } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { RouteError } from '@/components/features/route-error'
import { RouteNotFound } from '@/components/features/route-not-found'
import { RoutePending } from '@/components/features/route-pending'
import {
  ensureSession,
  installAnalyticsIdentity,
  installAuthBroadcastListener,
  isAuthVerdict,
} from '@/http/session'
import { capturePageview, forgetStaleIdentity } from '@/observability/analytics'
import { setErrorRouteSource } from '@/observability/errors'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

/**
 * Restore the session once per page load. The access token is memory-only, so
 * every reload starts signed out; without this, `_app` would bounce a
 * signed-in user to /login. ensureSession() dedupes concurrent callers and
 * signs the store out on an auth verdict, so this only starts the cross-tab
 * logout listener and the analytics identity subscription, and flips
 * isBootstrapped, whether or not the refresh worked. A restore that ends with
 * no user also drops any person posthog-js still holds from an earlier visit
 * (`forgetStaleIdentity`), so the next visitor's pages are not theirs. After a
 * failure that judged nothing (a 502, say) the person is kept if another open
 * tab answers that it is signed in as them, so that tab's replay is not split.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().isBootstrapped) return
  installAuthBroadcastListener()
  installAnalyticsIdentity()
  let isVerdict = false
  try {
    await ensureSession()
  } catch (error) {
    // Any refresh failure leaves this load signed out; only an auth verdict also clears the store (see refreshSession).
    isVerdict = isAuthVerdict(error)
  } finally {
    if (!useAuthStore.getState().user) {
      forgetStaleIdentity({ keepIfAnotherTabHoldsThem: !isVerdict })
    }
    useAuthStore.getState().setBootstrapped()
  }
}

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  /** Imported statically: when a chunk cannot be fetched, a lazy error screen could not load either. */
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  defaultPendingComponent: RoutePending,
  /** Held back 300ms so a fast navigation never flashes it, then kept 300ms so it never blinks. */
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
})

/**
 * One `$pageview` per resolved navigation, captured here because posthog-js's
 * own history pageviews are off: it fires after the URL changes, before the
 * route's state has settled. Only a new path is a page view, as posthog-js
 * counts them: a search, filter or range change, or a reload of the same match,
 * is not.
 */
router.subscribe('onResolved', ({ pathChanged }) => {
  if (pathChanged) capturePageview()
})
setErrorRouteSource(() => router.state.matches.at(-1)?.routeId)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }

  /**
   * A route's breadcrumb, declared on the route so each route names itself in
   * the trail (`/activity` is `Activity`). A component receives the match's
   * path params, so a route with params can name itself after the record it
   * shows (a tenant's or a user's name) once that has loaded.
   */
  interface StaticDataRouteOption {
    crumb?: string | ComponentType<{ params: Record<string, string> }>
    /**
     * A crumb placed before this route's own, for a record page whose list is
     * a sibling route rather than a parent (`/tenants/$tenantId` follows
     * `Tenants`).
     */
    crumbParent?: { label: string; to: LinkProps['to'] }
  }
}
