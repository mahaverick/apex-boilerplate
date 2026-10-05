/**
 * @file The flags inspector's and the status card's copy and labels. Like
 * the Errors pages', it says what is true of the request, never that a flag
 * is off when the read failed.
 */
import type { BadgeTone } from '@/constants/badge-tones'
import type { FlagApp, FlagReason, FlagState, TraitName, TraitRow } from '@/types/api.types'

/** No feature flags key in this environment: express answered `snapshot.enabled: false`. */
export const FLAGS_NOT_CONFIGURED =
  'Feature flags are not set up for this environment, so every flag serves its fallback.'

/** The list failed: said of the request, not of the flags. */
export const FLAGS_LIST_ERROR = 'We could not load the flags. This is not a sign they are off.'

/** The evaluation failed: said of the request, not of the person's flags. */
export const FLAGS_EVALUATE_ERROR =
  'We could not evaluate the flags. This is not a sign they are off.'

/** Shown beside a snapshot express has not refreshed for 10 minutes. */
export const FLAGS_STALE_NOTE =
  'PostHog has not been reached for over 10 minutes; flags use the last snapshot.'

/** Each app as the inspector names it. */
export const FLAG_APP_LABELS: Record<FlagApp, string> = {
  react: 'Customer app',
  apex: 'Apex',
}

/** Each snapshot state as a badge. */
export const FLAG_STATE_BADGES: Record<FlagState, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'muted' },
  missing: { label: 'Missing in PostHog', tone: 'warning' },
  unsupported: { label: 'Unsupported', tone: 'warning' },
}

/** Each evaluation reason as a badge; a `fallback:*` reason served the registry's fallback. */
export const FLAG_REASON_BADGES: Record<FlagReason, { label: string; tone: BadgeTone }> = {
  condition_match: { label: 'Condition matched', tone: 'success' },
  out_of_rollout: { label: 'Out of rollout', tone: 'neutral' },
  no_condition_match: { label: 'No condition matched', tone: 'neutral' },
  holdout: { label: 'Holdout', tone: 'neutral-outline' },
  'fallback:unconfigured': { label: 'Fallback: not set up', tone: 'muted' },
  'fallback:snapshot_missing': { label: 'Fallback: no snapshot', tone: 'warning' },
  'fallback:flag_missing': { label: 'Fallback: missing in PostHog', tone: 'warning' },
  'fallback:inactive': { label: 'Fallback: inactive', tone: 'muted' },
  'fallback:unsupported': { label: 'Fallback: unsupported', tone: 'warning' },
  'fallback:no_tenant': { label: 'Fallback: no tenant', tone: 'muted' },
  'fallback:inconclusive': { label: 'Fallback: inconclusive', tone: 'warning' },
}

/**
 * A flag state's badge. A state a newer express added is shown as it came,
 * in a neutral badge, rather than breaking the page.
 * @param state - The state express reported.
 * @returns The badge's label and tone.
 */
export function flagStateBadge(state: string): { label: string; tone: BadgeTone } {
  return (
    (FLAG_STATE_BADGES as Partial<Record<string, { label: string; tone: BadgeTone }>>)[state] ?? {
      label: state,
      tone: 'neutral',
    }
  )
}

/**
 * An evaluation reason's badge. A reason a newer express added is shown as
 * it came, in a neutral badge, rather than breaking the page.
 * @param reason - The reason express reported.
 * @returns The badge's label and tone.
 */
export function flagReasonBadge(reason: string): { label: string; tone: BadgeTone } {
  return (
    (FLAG_REASON_BADGES as Partial<Record<string, { label: string; tone: BadgeTone }>>)[reason] ?? {
      label: reason,
      tone: 'neutral',
    }
  )
}

/** Where a trait lives in a PostHog release condition. */
export const TRAIT_WHERE_LABELS: Record<TraitRow['where'], string> = {
  person: 'Person property',
  group: 'Tenant group property',
}

/** The traits in the order express declares them, for the evaluation's Traits list. */
export const TRAIT_NAMES = [
  'platform_role',
  'tenant_role',
  'app_env',
  'account_created_days',
  'tenant_created_days',
] as const satisfies readonly TraitName[]
