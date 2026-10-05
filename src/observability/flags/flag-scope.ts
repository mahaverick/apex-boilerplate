/**
 * @file Where Apex reads its flags. Staff are evaluated with no tenant and
 * receive Apex's slice of the registry from `GET /platform/me/flags`, so the
 * scope is always `platform`.
 */

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
