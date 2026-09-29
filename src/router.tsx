import { QueryClient } from '@tanstack/react-query'
import { createRouter, type LinkProps } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { RouteError } from '@/components/features/route-error'
import { RouteNotFound } from '@/components/features/route-not-found'
import { RoutePending } from '@/components/features/route-pending'
import { ensureSession, installAuthBroadcastListener } from '@/http/session'
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
 * logout listener and flips isBootstrapped, whether or not the refresh worked.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().isBootstrapped) return
  installAuthBroadcastListener()
  try {
    await ensureSession()
  } catch {
    // Any refresh failure leaves this load signed out; only an auth verdict also clears the store (see refreshSession).
  } finally {
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
