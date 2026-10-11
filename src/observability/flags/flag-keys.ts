/**
 * @file Apex's slice of the express flag registry
 * (`src/constants/flags.constants.ts`): every entry with `client: true` and
 * `apex` in `apps`, mirrored by hand. Apex reads no flag yet, so the slice is
 * empty and every key type is `never`; a new apex flag is one entry here,
 * copied from its express declaration (README "Feature flags").
 */
import type { ClientFlagDefinition } from './flag-types'

export type { BooleanClientFlagKey, ClientFlagKey, MultivariateClientFlagKey } from './flag-types'

/** The flags this app reads, keyed by their registry key. */
export const CLIENT_FLAGS = {} as const satisfies Readonly<Record<string, ClientFlagDefinition>>
