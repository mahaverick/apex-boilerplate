/**
 * @file Where Apex reads its flags. Staff are evaluated with no tenant and
 * receive Apex's slice of the registry from `GET /platform/me/flags`, so the
 * scope is always `platform`.
 */

import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
// Import cycle (flag-scope → flag-query → flag-scope): safe, as each reads the other only inside functions.
import { flagKeyFor } from './flag-query'
import type { ClientFlagValues } from './flag-types'
import { syncFeatureProperties } from './register'

/** Which read endpoint, and so which evaluation context, a flag value comes from. */
export type FlagScope = { kind: 'tenant'; slug: string } | { kind: 'none' } | { kind: 'platform' }

/** Apex's only scope, for route loaders, which cannot call a hook. */
export const PLATFORM_FLAG_SCOPE: FlagScope = { kind: 'platform' }

/**
 * The scope for the current render. Apex has one.
 * @returns The platform scope.
 */
export function useFlagScope(): FlagScope {
  return PLATFORM_FLAG_SCOPE
}

/**
 * The read endpoint for a scope, relative to the API prefix; exposures post
 * to the same path plus `/exposures`.
 * @param scope - The scope.
 * @returns The path.
 */
export function flagsPathFor(scope: FlagScope): string {
  switch (scope.kind) {
    case 'tenant':
      return `/tenants/${encodeURIComponent(scope.slug)}/flags`
    case 'none':
      return '/flags'
    case 'platform':
      return '/platform/me/flags'
  }
}

/**
 * Syncs the `$feature/*` super properties to the platform scope's cached
 * values each time the router commits a navigation, the first load
 * included. The router emits `onLoad` before `onResolved`, where the page
 * view is captured, and never for a preload. On the first load React has not
 * mounted yet, so `useFeaturePropertiesSync` cannot have run; a page under
 * the signed-in shell has its values cached by `_app`'s loader by then. With
 * nothing cached (a first load outside the shell, or after a sign-out cleared
 * the flags) it unregisters them all; a page outside the shell reached from
 * inside it, such as `/no-access`, keeps the cached platform values.
 * @param router - The app's router.
 * @param queryClient - The client holding the flag queries.
 * @returns The unsubscribe.
 */
export function installRouteFeatureProperties(
  router: AnyRouter,
  queryClient: QueryClient
): () => void {
  return router.subscribe('onLoad', () => {
    const values = queryClient.getQueryData<ClientFlagValues>(flagKeyFor(PLATFORM_FLAG_SCOPE))
    syncFeatureProperties(values ?? null)
  })
}
