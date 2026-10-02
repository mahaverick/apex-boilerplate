/**
 * @file The status badge tones every status label shares (email statuses,
 * onboarding states), so a tone means the same on every page.
 */

/**
 * Every tone, each drawn differently: `neutral` is the secondary fill,
 * `neutral-outline` that fill with a border, `outline` a border with
 * foreground text, and `muted` a border with muted text.
 */
export const BADGE_TONES = [
  'success',
  'neutral',
  'neutral-outline',
  'warning',
  'destructive',
  'outline',
  'muted',
] as const
export type BadgeTone = (typeof BADGE_TONES)[number]
