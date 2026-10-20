/**
 * @file "Confirm it's you" in the fixtures: the confirm page an emailed link
 * opens, mounted through the harness in a second tab of the same browser
 * context. Both tabs share the auth channel, the Web Lock manager and the
 * harness's session state, so the dialog in the first tab hears the
 * confirmation as it would from a real link.
 */
import { expect, type Page } from '@playwright/test'

/** A step-up link token the confirm page takes: 43 characters, low-entropy so no scanner reads it as a secret. */
const STEP_UP_TOKEN = 't'.repeat(43)

/**
 * The harness URL of a mailed confirm link. The inner query is encoded, and
 * the harness appends its own keys after an `&`, never a second `?`.
 * @param query - The harness's own keys, `&`-joined, e.g. `confirm=gone`.
 */
export function confirmLinkUrl(query: string): string {
  return `/e2e/harness/?path=${encodeURIComponent(`/auth/confirm?token=${STEP_UP_TOKEN}`)}&${query}`
}

/**
 * Opens the mailed link in a second tab of `page`'s context, waits until it
 * reports the confirmation, and closes it. Call it once `page`'s dialog shows
 * the email wait: the wait lock is held from then, so the confirm page reads
 * that a tab is waiting.
 * @param page - The page whose step-up dialog is waiting on the link.
 */
export async function confirmInSecondTab(page: Page): Promise<void> {
  const second = await page.context().newPage()
  try {
    await second.goto(confirmLinkUrl('confirm=ok'))
    await expect(second.getByRole('heading', { level: 1, name: 'Confirmed' })).toBeVisible()
    await expect(second.getByText('You can close this tab.')).toBeVisible()
  } finally {
    await second.close()
  }
}
