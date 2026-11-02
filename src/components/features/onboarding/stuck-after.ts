/**
 * @file The stuck threshold as copy. Its own module, not
 * `onboarding.constants.ts`, which first-visit JS loads: only the Overview and
 * Onboarding pages use it.
 */

/** Where the threshold comes from, as the copy names it. */
const SETTING = 'the server’s ONBOARDING_STUCK_AFTER_DAYS'

/**
 * How long a tenant goes without progress before it counts as stuck, as the
 * phrase the copy puts after "no onboarding progress".
 * @param days - express's `ONBOARDING_STUCK_AFTER_DAYS`, as the stats and the
 *   funnel send it (`stuckAfterDays`); `undefined` while that response loads,
 *   or from an API older than the field.
 * @returns "for 7 days or more (…)", or the setting's name and no number
 *   without `days`, so the copy never states a figure the server may not use.
 */
export function stuckAfter(days: number | undefined): string {
  if (days === undefined) return `for the days ${SETTING} sets, or more`
  return `for ${days.toLocaleString('en-US')} ${days === 1 ? 'day' : 'days'} or more (${SETTING})`
}
