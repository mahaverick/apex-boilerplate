import { expect, test } from '../hermetic'

/**
 * The Overview in a real browser. jsdom has no layout, so recharts draws no
 * marks there and the unit tests assert on the hidden tables instead; this is
 * where the charts are proved to actually paint.
 */

test('draws both charts and switches the window through the URL', async ({ page }) => {
  await page.goto('/e2e/harness/')

  const signups = page.getByRole('figure', { name: 'Sign-ups per day' })
  const emails = page.getByRole('figure', { name: 'Emails per day' })
  await expect(signups.locator('.recharts-area-area')).toHaveCount(2)
  // Seven days of sent bars, and the one day with a failed attempt.
  await expect(emails.locator('.recharts-bar-rectangle path')).toHaveCount(8)

  await page.getByRole('button', { name: '30 days' }).click()
  await expect(page).toHaveURL(/[?&]range=30d/)
  await expect(page.getByText('Send attempts (30 days)')).toBeVisible()
})
