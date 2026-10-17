import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, test } from '../hermetic'

/**
 * The ⌘K palette in a real browser: a page action run from the keyboard,
 * where focus lands when a dialog the palette opened closes, the lazy
 * chunk's slow and failed loads, the theme, and the list once it outgrows
 * its `max-h-72` viewport, which only a real browser can produce: jsdom has
 * no layout, so the unit a11y gate always sees a list that fits. Base UI then
 * makes the scroll viewport a tab stop, as axe's `scrollable-region-focusable`
 * requires, because the options take virtual focus from the input and none of
 * them is focusable itself.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

/** A cold Vite transform of the palette's chunk; the contrast suite allows the same. */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/** Acme's tenant page in the harness. */
const ACME_PAGE = '/tenants/10000000-0000-4000-8000-000000000001'

/** The slice of axe's run result this test reads. */
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
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette.getByRole('option', { name: 'Activity log' })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
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

test('runs Suspend from ⌘K, and the reason dialog takes focus', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME_PAGE}`)
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(
    palette.getByRole('group', { name: 'This page' }).getByRole('option', { name: 'Suspend' })
  ).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await page.keyboard.type('suspend')
  await page.keyboard.press('Enter')

  const reason = page.getByRole('alertdialog', { name: 'Suspend Acme Corp?' })
  await expect(reason).toBeVisible()
  await expect(palette).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement
            ?.closest('[role="alertdialog"]')
            ?.textContent?.includes('Suspend Acme Corp?') === true
      )
    )
    .toBe(true)
})

/**
 * Opens New tenant from the palette, checks the dialog has focus in Name, and
 * closes it with Escape.
 * @param page - The page, on a staff page an admin can open the palette on.
 */
async function openAndEscapeNewTenant(page: Page) {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await page.keyboard.type('new tenant')
  await expect(
    palette.getByRole('group', { name: 'Account' }).getByRole('option', { name: 'New tenant' })
  ).toBeVisible()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'New tenant' })
  await expect(dialog).toBeVisible()
  await expect(palette).toHaveCount(0)
  await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
}

test('Escape on New tenant from ⌘K on the overview gives the main landmark focus', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await openAndEscapeNewTenant(page)
  await expect(page.getByRole('main')).toBeFocused()
})

test('Escape on New tenant from ⌘K on a tenant page gives the heading focus', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME_PAGE}`)
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible()
  await openAndEscapeNewTenant(page)
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeFocused()
})

test('sets the theme from the keyboard alone', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/)
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('dark')
  await expect(page.getByRole('option', { name: /^Dark/ })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
})

test('shows the shortcut hint on the header button', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  const trigger = page.getByRole('button', { name: 'Search…' })
  await expect(trigger).toHaveText(/(⌘K|Ctrl K)$/)
  await expect(trigger).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+K$/)
})

/** The palette chunk's dev-server URL, which the routes below hold or abort. */
const CHUNK_URL = /\/src\/components\/features\/command-palette\.tsx(\?|$)/

/** What the toast says when the palette's chunk cannot be fetched. */
const LOAD_FAILED = 'Search could not be loaded. Reloading the page will fix it.'

/**
 * Aborts the palette's chunk until `held` is cleared, and counts the requests made.
 * Routed on the context: the harness's service worker answers page-level fetches before `page.route` sees them.
 * @param page - The page whose context gets the route.
 * @returns The hold, whose `held` the test clears and whose `requests` it reads.
 */
async function holdPaletteChunk(page: Page) {
  const chunk = { held: true, requests: 0 }
  await page.context().route(CHUNK_URL, async (route) => {
    chunk.requests += 1
    return chunk.held ? route.abort() : route.continue()
  })
  return chunk
}

test('a failed palette chunk load offers a reload, on every open, and the reload fixes it', async ({
  page,
}) => {
  const chunk = await holdPaletteChunk(page)
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  // The idle prefetch asks first and is refused.
  await expect.poll(() => chunk.requests, { timeout: COLD_TRANSFORM_BUDGET_MS }).toBeGreaterThan(0)
  const asked = chunk.requests

  const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true })
  const reload = page.getByRole('button', { name: 'Reload' })
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByText(LOAD_FAILED)).toBeVisible()
  await expect(reload).toBeVisible()
  await expect(page.getByText('Loading search…')).toHaveCount(0)
  await expect(dialog).toHaveCount(0)

  // Base UI hides the close button from the tree, so it is clicked by slot; a raise while the toast shows would only update it.
  await page
    .getByRole('dialog', { name: LOAD_FAILED, exact: true })
    .locator('[data-slot="toast-close"]')
    .click()
  await expect(page.getByText(LOAD_FAILED)).toHaveCount(0)
  // The browser keeps a failed import() for the page, so the next press makes no request and fails the same way.
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByText(LOAD_FAILED)).toBeVisible()
  await expect(reload).toBeVisible()
  expect(chunk.requests).toBe(asked)

  // The reload leaves the harness (the router has rewritten the address), so the page is opened again once the route lets the chunk through.
  chunk.held = false
  await Promise.all([page.waitForEvent('load'), reload.click()])
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await page.keyboard.press('ControlOrMeta+k')
  await expect(dialog).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
})

/**
 * Holds the palette's chunk on a promise the test releases, and counts the requests made.
 * Routed on the context, like `holdPaletteChunk`.
 * @param page - The page whose context gets the route.
 * @returns The hold, whose `release` lets the chunk through and whose `requests` the test reads.
 */
async function slowPaletteChunk(page: Page) {
  const chunk = { requests: 0, release: undefined as (() => void) | undefined }
  const released = new Promise<void>((resolve) => {
    chunk.release = resolve
  })
  await page.context().route(CHUNK_URL, async (route) => {
    chunk.requests += 1
    await released
    await route.continue()
  })
  return chunk
}

test('keys typed while the palette loads are kept', async ({ page }) => {
  const chunk = await slowPaletteChunk(page)
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  // The idle prefetch has asked and the chunk is on hold, so the open finds it still loading.
  await expect.poll(() => chunk.requests, { timeout: COLD_TRANSFORM_BUDGET_MS }).toBeGreaterThan(0)

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByText('Loading search…')).toBeVisible()
  await page.keyboard.type('acm')
  chunk.release?.()
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  const input = palette.getByRole('combobox')
  await expect(input).toHaveValue('acm')
  await expect(
    palette.getByRole('group', { name: 'Tenants' }).getByRole('option', { name: /^Acme Corp/ })
  ).toBeVisible()
  // The caret sits after the kept text.
  await page.keyboard.type('e')
  await expect(input).toHaveValue('acme')
})

test('Escape after a first open from the Search… button gives the button focus back', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/overview')
  const trigger = page.getByRole('button', { name: 'Search…' })
  await expect(trigger).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await trigger.click()
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('Escape after an open that waited for the chunk gives the button focus back', async ({
  page,
}) => {
  const chunk = await slowPaletteChunk(page)
  await page.goto('/e2e/harness/?path=/overview')
  const trigger = page.getByRole('button', { name: 'Search…' })
  await expect(trigger).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await expect.poll(() => chunk.requests, { timeout: COLD_TRANSFORM_BUDGET_MS }).toBeGreaterThan(0)

  await trigger.click()
  await expect(page.getByText('Loading search…')).toBeVisible()
  chunk.release?.()
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await expect(page.getByText('Loading search…')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
