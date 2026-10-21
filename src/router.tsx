import { QueryClient } from '@tanstack/react-query'
import { createRouter, type AnyRouter, type LinkProps } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { RouteError } from '@/components/features/route-error'
import { RouteNotFound } from '@/components/features/route-not-found'
import { ListPending } from '@/components/shared/pending-templates'
import { apiClient } from '@/http/client'
import {
  ensureSession,
  installAnalyticsIdentity,
  installAuthBroadcastListener,
  isAuthVerdict,
} from '@/http/session'
import { installPasskeySetupInterceptor } from '@/lib/passkey-setup'
import { setErrorRouteSource } from '@/observability/errors'
import { forgetFeatureProperties } from '@/observability/flags/feature-property-names'
import { installRouteFeatureProperties } from '@/observability/flags/flag-scope'
import { capturePageview, forgetStaleIdentity } from '@/observability/telemetry'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { isPasskeySetupRequired } from '@/types/passkey.types'

// Required mode answers 403 PASSKEY_SETUP_REQUIRED to every route off its allowlist; the flag swaps the shell for the setup screen.
installPasskeySetupInterceptor(apiClient)

/** The app's one query client: data stays fresh for 30 s and a failed query retries once, except a refusal that asks for a passkey, which a retry cannot change. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => failureCount < 1 && !isPasskeySetupRequired(error),
    },
  },
})

/**
 * Restores the session once per page load. The access token is memory-only, so
 * a reload starts signed out and `_app` would bounce a signed-in user to
 * /login without this. Whether or not the refresh works, it ends with
 * `isBootstrapped` set. A restore that ends with no user also drops any person
 * posthog-js still holds from an earlier visit (`forgetStaleIdentity`), so the
 * next visitor's pages are not attributed to them. After a failure that judged
 * nothing (a 502, say) that person is kept if another open tab answers that it
 * is signed in as them, so that tab's replay is not split.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().isBootstrapped) return
  installAuthBroadcastListener()
  installAnalyticsIdentity(queryClient)
  let isVerdict = false
  try {
    await ensureSession()
  } catch (error) {
    // Only an auth verdict signs the store out; any other failure judges nothing (see refreshSession).
    isVerdict = isAuthVerdict(error)
  } finally {
    if (!useAuthStore.getState().user) {
      forgetStaleIdentity({ keepIfAnotherTabHoldsThem: !isVerdict })
      forgetFeatureProperties()
    }
    useAuthStore.getState().setBootstrapped()
  }
}

/**
 * The app router's route-state screens and timings. Exported so a test that
 * builds its own router over the real tree shows the same error, not-found
 * and pending screens the app does. Frozen, since every such test shares it.
 */
export const ROUTER_DEFAULTS = Object.freeze({
  /** Imported statically: when a chunk cannot be fetched, a lazy error screen could not load either. */
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  /** A list-shaped skeleton, at the boot shell's sizes; routes shaped otherwise name their own. */
  defaultPendingComponent: ListPending,
  /** Shown only after 300ms of waiting, then for at least 300ms: it neither flashes on a fast navigation nor blinks on a slow one. */
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
} satisfies Partial<AnyRouter['options']>)

/** The app's router; its context carries the query client, and links preload on intent. */
export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  ...ROUTER_DEFAULTS,
})

/**
 * One `$pageview` per resolved navigation, captured here because posthog-js's
 * own history pageviews are off: they fire when the URL changes, before the
 * route has resolved. Only a new path is a page view: a search or filter
 * change is not.
 */
router.subscribe('onResolved', ({ pathChanged }) => {
  if (pathChanged) capturePageview()
})
installRouteFeatureProperties(router, queryClient)
setErrorRouteSource(() => router.state.matches.at(-1)?.routeId)

declare module '@tanstack/react-router' {
  /** Registers the router's type so links, params and search are checked against the route tree. */
  interface Register {
    router: typeof router
  }

  /**
   * A route's breadcrumb, declared on the route (`/activity` is `Activity`). A
   * component receives the match's path params, so a record page can name
   * itself after the record once it has loaded.
   */
  interface StaticDataRouteOption {
    crumb?: string | ComponentType<{ params: Record<string, string> }>
    /** A crumb placed before this route's own, for a record page whose list is a sibling route, not a parent. */
    crumbParent?: { label: string; to: LinkProps['to'] }
  }
}
