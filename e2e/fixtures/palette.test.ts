import { createRequire } from 'node:module'
import { expect, test } from '../hermetic'

/**
 * The ⌘K palette's list once it outgrows its `max-h-72` viewport, which only a
 * real browser can produce: jsdom has no layout, so the unit a11y gate always
 * sees a list that fits. Base UI then makes the scroll viewport a tab stop, as
 * axe's `scrollable-region-focusable` requires, because the options take
 * virtual focus from the input and none of them is focusable itself.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

type AxeRun = {
  violations: { id: string; nodes: { target: string[] }[] }[]
  passes: { id: string }[]
}

test('an overflowing palette list stays keyboard-scrollable and axe-clean', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  // The harness has too few pages and tenants to overflow the list, so each option is made taller instead.
  await page.addStyleTag({ content: '[data-slot="command-item"] { min-height: 8rem }' })

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette.getByRole('option', { name: 'Activity log' })).toBeVisible()
  // Base UI's scroll viewport: the `role="presentation"` wrapper that manages its own tabindex.
  const viewport = palette.locator('[role="presentation"][tabindex]:has([role="listbox"])')
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(0)
  await expect(viewport).toHaveAttribute('tabindex', '0')

  await page.addScriptTag({ path: AXE_PATH })
  const results = await page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run: (ctx: Element, opts: unknown) => Promise<AxeRun> } }
    ).axe
    const run = await axe.run(document.querySelector('[role="dialog"]')!, {
      resultTypes: ['violations'],
    })
    return {
      violations: run.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
      ),
      passes: run.passes.map((p) => p.id),
    }
  })
  expect(results.violations).toEqual([])
  // Not vacuous: axe really evaluated a region that scrolls.
  expect(results.passes).toContain('scrollable-region-focusable')
})
