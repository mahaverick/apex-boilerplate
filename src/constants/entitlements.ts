/**
 * @file The entitlement registry's labels, mirroring express's
 * `src/constants/entitlements.constants.ts` (`ENTITLEMENTS[key].label`). The
 * labels are code there, never staff-edited, so an audit sentence can name a
 * grant without a request. Change both repos together; a key added in express
 * first reads as its key until it is added here.
 */

/** Each entitlement key's label, as express's registry names it. */
export const ENTITLEMENT_LABELS: Readonly<Record<string, string>> = {
  members: 'Members',
  advanced_example: 'Workspace insights',
}

/**
 * An entitlement's label, or its key when this build does not know it.
 * @param key - A registry key, such as `members`.
 */
export function entitlementLabel(key: string): string {
  return Object.hasOwn(ENTITLEMENT_LABELS, key) ? (ENTITLEMENT_LABELS[key] ?? key) : key
}
