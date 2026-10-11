/**
 * @file The flags inspector's and the status card's responses, shaped as
 * express serves them: the two reference flags, PostHog flag links and the
 * five traits.
 */
import type {
  FlagRow,
  FlagsEvaluateResponse,
  FlagsListResponse,
  FlagsStatus,
  TraitRow,
} from '@/types/api.types'

/**
 * A flag's page in PostHog.
 * @param id - The PostHog flag id.
 * @returns The URL.
 */
export function flagUrl(id: number): string {
  return `https://us.posthog.com/project/1/feature_flags/${id}`
}

/**
 * The tenant beta page, active with one condition at 50%; override what a
 * test is about.
 * @param overrides - The fields that differ.
 * @returns The row.
 */
export function flagRow(overrides: Partial<FlagRow> = {}): FlagRow {
  return {
    key: 'example_beta_page',
    description: 'Reference flag: the tenant Beta page and its API route',
    kind: 'boolean',
    variants: null,
    scope: 'tenant',
    client: true,
    apps: ['react'],
    experiment: false,
    fallback: false,
    state: 'active',
    conditions: 1,
    maxRollout: 50,
    posthogUrl: flagUrl(101),
    ...overrides,
  }
}

/** The CTA experiment, synced but not launched: inactive at 0%. */
const EXPERIMENT_ROW: FlagRow = flagRow({
  key: 'example_cta_experiment',
  description: 'Reference experiment: the getting-started call-to-action style',
  kind: 'multivariate',
  variants: ['control', 'bold'],
  scope: 'user',
  experiment: true,
  fallback: 'control',
  state: 'inactive',
  maxRollout: 0,
  posthogUrl: flagUrl(102),
})

/** A server-only flag a cohort condition made unsupported. */
const UNSUPPORTED_ROW: FlagRow = flagRow({
  key: 'nightly_reconciliation',
  description: 'Reconciles tenant ledgers on the worker.',
  scope: 'user',
  client: false,
  apps: [],
  state: 'unsupported',
  unsupportedReason: 'cohort',
  conditions: 2,
  maxRollout: 100,
  posthogUrl: flagUrl(103),
})

/** The five traits, exactly as express's `FLAG_TRAITS` describes them. */
export const TRAITS: TraitRow[] = [
  {
    name: 'platform_role',
    where: 'person',
    description: "The user's platform (staff) role; none for a user who is not staff.",
    examples: ['none', 'viewer', 'editor', 'manager', 'admin', 'owner'],
  },
  {
    name: 'tenant_role',
    where: 'person',
    description:
      "The user's membership role in the tenant the flag is evaluated for; none with no tenant or no membership.",
    examples: ['owner', 'admin', 'manager', 'editor', 'viewer', 'none'],
  },
  {
    name: 'app_env',
    where: 'person',
    description: 'The deployment the server runs in (APP_ENV).',
    examples: ['local', 'dev', 'qa', 'prod'],
  },
  {
    name: 'account_created_days',
    where: 'person',
    description: 'Whole days since the user signed up, an integer of at least 0.',
    examples: ['0', '30', '365'],
  },
  {
    name: 'tenant_created_days',
    where: 'group',
    description:
      'Whole days since the tenant was created, an integer of at least 0; absent with no tenant.',
    examples: ['0', '90', '365'],
  },
]

/**
 * A configured environment's inspector list; override what a test is about.
 * @param overrides - The fields that differ.
 * @returns The response.
 */
export function flagsList(overrides: Partial<FlagsListResponse> = {}): FlagsListResponse {
  return {
    items: [flagRow(), EXPERIMENT_ROW, UNSUPPORTED_ROW],
    unregistered: [{ key: 'legacy_marketing_banner', active: true, posthogUrl: flagUrl(104) }],
    traits: TRAITS,
    snapshot: { enabled: true, fetchedAt: '2026-10-05T09:59:30.000Z', stale: false },
    ...overrides,
  }
}

/**
 * One evaluation in a tenant: the beta page matches its first condition,
 * the experiment holds the user out, the unsupported flag falls back.
 * @param overrides - The fields that differ.
 * @returns The response.
 */
export function flagsEvaluation(
  overrides: Partial<FlagsEvaluateResponse> = {}
): FlagsEvaluateResponse {
  return {
    traits: {
      platform_role: 'none',
      tenant_role: 'editor',
      app_env: 'local',
      account_created_days: 277,
      tenant_created_days: 120,
    },
    flags: [
      { key: 'example_beta_page', value: true, reason: 'condition_match', conditionIndex: 0 },
      {
        key: 'example_cta_experiment',
        value: 'control',
        reason: 'holdout',
        holdoutVariant: 'holdout-3605',
      },
      { key: 'nightly_reconciliation', value: false, reason: 'fallback:unsupported' },
    ],
    snapshot: { fetchedAt: '2026-10-05T09:59:30.000Z', stale: false },
    ...overrides,
  }
}

/** Healthy feature flags: a fresh snapshot on matching version 1, nothing missing or unsupported. */
export const testFlagsStatus: FlagsStatus = {
  enabled: true,
  snapshotAt: '2026-10-05T09:59:30.000Z',
  checkedAt: '2026-10-05T09:59:50.000Z',
  stale: false,
  lastFetchOk: '2026-10-05T09:59:30.000Z',
  lastFetchError: null,
  propertyMatchingVersion: 1,
  counts: {
    registered: 2,
    active: 1,
    inactive: 1,
    missing: 0,
    unsupported: 0,
    unregistered: 3,
    unknownVariant15m: 0,
  },
}
