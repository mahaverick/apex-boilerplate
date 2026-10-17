import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, FALLBACK_HEADER, test } from '../hermetic'
import { afterAnimations, afterFontsAndFrames } from '../timing'

/**
 * @file Colour contrast, measured in a real browser. `tests/unit/a11y.test.tsx`
 * disables every `cat.color` rule because jsdom has no layout, so a green unit
 * run says nothing about contrast. This suite injects the same axe-core (already
 * a devDependency) and runs its `color-contrast` rule in both themes.
 *
 * Opt-in, not in CI and not part of `pnpm test`: run `pnpm test:contrast` when
 * tokens, surfaces or component composition change. No surface needs a backend:
 * `test` comes from `../hermetic`, which answers every `/api` request that would
 * leave the browser with a 401, so the public pages' session bootstrap cannot
 * reach whatever runs on :4040 or hang on it while it restarts.
 */

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')

/**
 * How long to wait for a heading: the dev server transforms a lazily loaded
 * route's modules on first request, which has taken past 7s under load, and
 * `goto` resolves on `load` before that.
 * Below the 30 s test timeout, so a hang is reported by the heading assertion.
 */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/**
 * A chart legend's text. axe cannot resolve the background behind recharts'
 * legend wrapper, which sits over the chart's SVG, and files it as incomplete;
 * the 'chart legends' test measures it another way.
 */
const LEGEND_ITEM = '.recharts-legend-wrapper'

/**
 * Every surface reachable without a backend, with a heading only that surface
 * renders, asserted before axe runs. Without it, a route that silently
 * redirected (an authenticated page losing its session, a `validateSearch`
 * bouncing a token to /login) would paint a legible page and report green while
 * measuring something else.
 *
 * The `/e2e/harness/` entries mount an in-app route with MSW answering and the
 * auth store pre-populated (e2e/harness/harness.tsx). `?path=` picks the route;
 * without it the harness mounts the overview.
 */
const ACME_PAGE = '/tenants/10000000-0000-4000-8000-000000000001'
const CLEO_PAGE = '/users/20000000-0000-4000-8000-000000000002'
const FLAGS_PAGE = `/e2e/harness/?path=/settings/platform/flags?userId=20000000-0000-4000-8000-000000000002&tenantId=10000000-0000-4000-8000-000000000001`

const SURFACES = [
  // Public: straight URLs, no harness.
  { name: 'sign-in', url: '/login', heading: 'Sign in' },
  // Invitation-only: without `?invitation=` the route redirects to /login, and the form waits on the invitation preview that `answerInvitationPreview` supplies.
  {
    name: 'register',
    url: '/register?invitation=contrast-probe',
    heading: 'Create an account',
  },
  { name: 'forgot-password', url: '/forgot-password', heading: 'Forgot your password?' },
  // Both read `?token=`. Without one, reset-password renders its "This link is incomplete" branch, and the heading assertion keeps that swap from passing unnoticed.
  {
    name: 'reset-password',
    url: '/reset-password?token=contrast-probe',
    heading: 'Choose a new password',
  },
  {
    name: 'verify-email',
    url: '/verify-email?token=contrast-probe',
    heading: 'Verify your email',
  },
  // Authenticated, mounted through the harness. The overview is strict: any axe incomplete fails, except the chart legends, which 'chart legends' below proves instead.
  {
    name: 'overview',
    url: '/e2e/harness/',
    heading: 'Overview',
    provenIncomplete: LEGEND_ITEM,
  },
  // The settings pages: each heading is one only that page renders, since the settings layout's h1 paints before the page's data.
  { name: 'settings', url: '/e2e/harness/?path=/settings', heading: 'Platform' },
  { name: 'profile', url: '/e2e/harness/?path=/settings/account/profile', heading: 'Details' },
  {
    name: 'security',
    url: '/e2e/harness/?path=/settings/account/security',
    heading: 'Sign-in methods',
  },
  { name: 'tenants', url: '/e2e/harness/?path=/tenants', heading: 'Tenants' },
  { name: 'activity', url: '/e2e/harness/?path=/activity', heading: 'Activity' },
  // Exact: the page's own h2s ('Staff members', 'Invite staff') also contain the word.
  { name: 'staff', url: '/e2e/harness/?path=/settings/platform/staff', heading: /^Staff$/ },
  // As an owner in full maintenance, so the banner, every fact and every control is graded.
  {
    name: 'maintenance',
    url: '/e2e/harness/?path=/settings/platform/maintenance&maintenance=full&role=owner',
    heading: 'Queues',
  },
  { name: 'users', url: '/e2e/harness/?path=/users', heading: /^Users$/ },
  // A live account with its History card, and a deleted one with its read-only notice and Deleted badge.
  { name: 'user', url: `/e2e/harness/?path=${CLEO_PAGE}`, heading: 'Cleo D' },
  {
    name: 'deleted user',
    url: '/e2e/harness/?path=/users/20000000-0000-4000-8000-000000000003',
    heading: 'Evangeline Featherstonehaugh',
  },
  // The section nav's active tab, the inactive owner's badge and the History card.
  {
    name: 'tenant',
    url: `/e2e/harness/?path=${ACME_PAGE}`,
    heading: 'Staff actions on this tenant',
  },
  {
    name: 'tenant members',
    url: `/e2e/harness/?path=${ACME_PAGE}/members`,
    heading: 'Members',
  },
  {
    name: 'tenant invitations',
    url: `/e2e/harness/?path=${ACME_PAGE}/invitations`,
    heading: 'Pending invitations',
  },
  {
    name: 'tenant activity',
    url: `/e2e/harness/?path=${ACME_PAGE}/activity`,
    heading: 'Acme Corp',
  },
  // The flags inspector: state and reason badges, the traits' copy buttons and an evaluation.
  {
    name: 'flags',
    url: FLAGS_PAGE,
    heading: 'Feature flags',
  },
  {
    name: 'tenant flags',
    url: `/e2e/harness/?path=${ACME_PAGE}/flags?userId=20000000-0000-4000-8000-000000000002`,
    heading: /^Flags$/,
  },
  // Frozen: the Suspended badge and the frozen notice.
  {
    name: 'suspended tenant',
    url: '/e2e/harness/?path=/tenants/10000000-0000-4000-8000-000000000002/members',
    heading: 'Beta Ltd',
  },
  // Signed in without a platform role: the harness's `?role=none`, or /no-access would redirect its admin to the overview.
  {
    name: 'no-access',
    url: '/e2e/harness/?path=/no-access&role=none',
    heading: 'This account has no platform access',
  },
  {
    name: 'overview (figures loading)',
    url: '/e2e/harness/?path=/overview&hold=/api/v1/platform/stats',
    heading: { loading: 'section', heading: /^Overview$/ },
  },
  {
    name: 'overview (figures failed)',
    url: '/e2e/harness/?path=/overview&fail=/api/v1/platform/stats',
    heading: { failed: /^Overview$/ },
  },
  {
    name: 'profile (read failed)',
    url: '/e2e/harness/?path=/settings/account/profile&profile=stale&fail=/api/v1/profile',
    heading: { failed: /^Profile$/ },
  },
  {
    name: 'onboarding (funnel loading)',
    url: '/e2e/harness/?path=/onboarding&hold=/api/v1/platform/onboarding/funnel',
    heading: { loading: 'section', heading: /^Onboarding$/ },
  },
] as const

const THEMES = ['light', 'dark'] as const

/**
 * A surface graded while it loads: `template` waits for the route template's
 * `status` region named "Loading", `section` for a busy section's skeleton,
 * each under `heading` when the state renders one. Neither waits for the
 * skeletons to go: they are what is graded. No apex surface uses `template`:
 * apex's loaders await nothing, so no held request can show a page template.
 */
type LoadingWait = { loading: 'template' | 'section'; heading?: string | RegExp }

/**
 * A surface graded after a read failed: `failed` is the heading it renders,
 * and the surface must show a visible `alert` before it is graded, so a state
 * that never reaches the failure cannot pass as one. Skeletons beside the
 * alert (a section still retrying) stay.
 */
type FailedWait = { failed: string | RegExp }

/** What `contrastOf` waits for: a loaded surface's heading, a loading state or a failed one. */
type Wait = string | RegExp | LoadingWait | FailedWait

/** Whether `wait` names a loading state rather than a loaded heading. */
function isLoadingWait(wait: Wait): wait is LoadingWait {
  return typeof wait === 'object' && !(wait instanceof RegExp) && 'loading' in wait
}

/** Whether `wait` names a failed state. */
function isFailedWait(wait: Wait): wait is FailedWait {
  return typeof wait === 'object' && !(wait instanceof RegExp) && 'failed' in wait
}

/** What the tests read from an axe run: each rule's nodes, with their selectors and failure summaries. */
type ContrastResult = {
  violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[]
  incomplete: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[]
}

/** Answer the invitation preview the register page waits on, stamped so the hermetic teardown counts it as answered here. */
async function answerInvitationPreview(page: Page): Promise<void> {
  await page.route('**/api/v1/invitations/preview', (route) =>
    route.fulfill({
      status: 200,
      headers: { [FALLBACK_HEADER]: '1' },
      json: {
        success: true,
        message: 'Invitation retrieved.',
        statusCode: 200,
        data: {
          tenant: { name: 'Acme Corp', slug: 'acme' },
          role: 'viewer',
          invitedBy: null,
          email: 'invitee@example.com',
        },
      },
    })
  )
}

/**
 * Loads `url` in `theme`, waits until the surface `wait` names has rendered:
 * with its data, or in the loading state it names. Runs axe over it, or over
 * `scope`. The theme is set before the document runs: index.html's pre-paint script reads
 * localStorage and toggles `.dark` before the bundle loads, so setting it
 * afterwards would measure a repaint. The heading is asserted before measuring,
 * because a route that redirected still paints a legible page and would come
 * back green without measuring the surface this entry names.
 */
async function contrastOf(
  page: Page,
  url: string,
  theme: string,
  wait: Wait,
  scope?: string
): Promise<ContrastResult> {
  await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
  await page.goto(url)
  if (isLoadingWait(wait)) {
    if (wait.heading) {
      await expect(page.getByRole('heading', { name: wait.heading })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })
    }
    const loading =
      wait.loading === 'template'
        ? page.getByRole('status', { name: 'Loading' })
        : page.locator('[data-slot="query-state"][aria-busy="true"] [data-slot="skeleton"]')
    await expect(loading.first()).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  } else if (isFailedWait(wait)) {
    await expect(page.getByRole('heading', { name: wait.failed })).toBeVisible({
      timeout: COLD_TRANSFORM_BUDGET_MS,
    })
    await expect(page.getByRole('alert').first()).toBeVisible({
      timeout: COLD_TRANSFORM_BUDGET_MS,
    })
  } else {
    await expect(page.getByRole('heading', { name: wait })).toBeVisible({
      timeout: COLD_TRANSFORM_BUDGET_MS,
    })
    // The heading can render outside each page's data conditional, so it can show while the data behind it is still a skeleton. Grade the loaded page.
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
  }

  // A late font swap can move text over a different background, so sample only once it has reflowed.
  await afterFontsAndFrames(page)

  await page.addScriptTag({ path: AXE_PATH })

  return runAxe(page, scope)
}

/**
 * Runs axe's contrast rule over the whole document, or over one element.
 *
 * Scoping matters for the popup surfaces: the page behind an open menu is
 * already graded by its own entry, so the whole document would report the same
 * nodes twice and hide a popup failure.
 * @param page - The page, with axe already injected.
 * @param scope - A selector to grade instead of the whole document.
 * @returns axe's violations and incompletes.
 */
async function runAxe(page: Page, scope?: string): Promise<ContrastResult> {
  return page.evaluate(async (selector) => {
    // Only `color-contrast`: everything else is gated by tests/unit/a11y.test.tsx, and a second run here would give two sources of truth for one finding.
    const results = await (
      window as unknown as {
        axe: { run: (ctx: Document | Element, opts: unknown) => Promise<ContrastResult> }
      }
    ).axe.run((selector ? document.querySelector(selector) : document) ?? document, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations'],
      // The only frame is an email preview sandboxed without scripts, where axe never runs; left in, axe would wait `frameWaitTime` for it to answer.
      iframes: false,
    })
    return {
      violations: results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
      })),
      incomplete: results.incomplete.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
      })),
    }
  }, scope)
}

/** The failure message for one result: each violating node's selector and axe's failureSummary (the ratio and both colours), or '' when none failed. */
function report(surface: string, theme: string, result: ContrastResult): string {
  const lines: string[] = []
  for (const violation of result.violations) {
    for (const node of violation.nodes) {
      lines.push(`  ✘ ${node.target.join(' ')}`)
      for (const detail of (node.failureSummary ?? '').split('\n')) {
        if (detail.trim() && !detail.startsWith('Fix any')) lines.push(`      ${detail.trim()}`)
      }
    }
  }
  return lines.length ? `${surface} · ${theme}\n${lines.join('\n')}` : ''
}

for (const theme of THEMES) {
  for (const surface of SURFACES) {
    test(`${surface.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      if (surface.url.startsWith('/register')) await answerInvitationPreview(page)
      const result = await contrastOf(page, surface.url, theme, surface.heading)

      /**
       * `incomplete` is not a pass: axe files a node there when it cannot
       * resolve the background (a gradient, an image, an overlapped element). A
       * surface with `provenIncomplete` fails on any incomplete node outside
       * it; the others only warn, so a false alarm does not block.
       */
      if ('provenIncomplete' in surface) {
        const unproven = result.incomplete.flatMap((i) =>
          i.nodes
            .map((n) => n.target.join(' '))
            .filter((target) => !target.includes(surface.provenIncomplete))
        )
        expect(unproven, `${surface.name} · ${theme}: nodes axe could not resolve`).toEqual([])
      } else if (result.incomplete.length > 0) {
        const targets = result.incomplete.flatMap((i) => i.nodes.map((n) => n.target.join(' ')))
        console.warn(
          `[contrast] ${surface.name} · ${theme}: ${targets.length} node(s) axe could not resolve — check by eye:\n  ${targets.join('\n  ')}`
        )
      }

      expect(report(surface.name, theme, result), report(surface.name, theme, result)).toBe('')
    })
  }
}

/**
 * Popup menus. They carry their own `--popover` / `--popover-foreground` pair,
 * and a closed menu is not in the DOM, so a failure on one is invisible to every
 * page test above. The selectors come from `tests/unit/a11y.test.tsx`'s "open
 * overlays" and menu blocks, which already drive each open, so the two suites
 * agree on what "the user menu" means.
 */
const POPUPS = [
  {
    name: 'user menu',
    path: '/overview',
    trigger: /^Account menu for/,
    triggerRole: 'button',
    role: 'menu',
    itemRole: 'menuitem',
  },
] as const

for (const theme of THEMES) {
  for (const popup of POPUPS) {
    test(`${popup.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto(`/e2e/harness/?path=${popup.path}`)
      await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.getByRole(popup.triggerRole, { name: popup.trigger }).click()
      const menu = page.getByRole(popup.role)
      await expect(menu).toBeVisible()
      // An empty menu would grade clean without checking the items this test exists for.
      await expect(menu.getByRole(popup.itemRole).first()).toBeVisible()

      await afterAnimations(menu)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, `[role="${popup.role}"]`)
      expect(report(popup.name, theme, result), report(popup.name, theme, result)).toBe('')
    })
  }
}

// The avatar initials sit on `bg-muted`; ui/avatar.tsx uses `text-foreground` for a wider margin than the registry's `text-muted-foreground` (STYLESEED.md).
for (const theme of THEMES) {
  test(`the avatar initials meet WCAG AA contrast in ${theme}`, async ({ page }) => {
    const result = await contrastOf(
      page,
      '/e2e/harness/',
      theme,
      'Overview',
      '[data-slot="avatar-fallback"]'
    )
    // An absent avatar would grade clean without checking the initials this test exists for.
    expect(await page.locator('[data-slot="avatar-fallback"]').count()).toBeGreaterThan(0)
    expect(report('avatar', theme, result), report('avatar', theme, result)).toBe('')
  })
}

test.describe('popups that are not menus', () => {
  for (const theme of THEMES) {
    test(`the mobile navigation sheet meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      // The sheet carries its own background token and exists only below the desktop breakpoint, so the desktop shell tests above cannot reach it.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/?path=/overview')
      await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      // Populated: an empty sheet grades clean and proves nothing.
      await expect(sheet.getByRole('link').first()).toBeVisible()

      await afterAnimations(sheet)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="dialog"]')
      expect(report('mobile sheet', theme, result), report('mobile sheet', theme, result)).toBe('')
    })
  }
})

/**
 * The chart legends axe files as incomplete on the overview. Their text is
 * held to the KPI card titles, which axe does grade: the same colour on the
 * same card background is the same contrast ratio. Both are compared, so a
 * legend restyled onto another token, or a chart card moved onto another
 * surface, fails here.
 */
test.describe('chart legends', () => {
  for (const theme of THEMES) {
    test(`use the graded KPI title colours in ${theme}`, async ({ page }) => {
      await contrastOf(page, '/e2e/harness/', theme, 'Overview')
      const items = page.locator(`${LEGEND_ITEM} > div > div`)
      // Two sign-up series and five email groups: an empty legend would compare nothing.
      await expect(items).toHaveCount(7)

      const title = page
        .getByRole('region', { name: 'Key figures' })
        .locator('[data-slot="card-title"]')
        .first()
      const titleColour = await title.evaluate((el) => getComputedStyle(el).color)
      /** The background colour of the card around `el`. */
      const cardBackground = (el: Element) =>
        getComputedStyle(el.closest('[data-slot="card"]')!).backgroundColor
      const titleSurface = await title.evaluate(cardBackground)

      for (const item of await items.all()) {
        expect(await item.evaluate((el) => getComputedStyle(el).color)).toBe(titleColour)
        expect(await item.evaluate(cardBackground)).toBe(titleSurface)
      }
    })
  }
})

/**
 * The ⌘K palette: its own dialog surface and its highlighted-option pair
 * (`--accent` on `--popover`), neither of which any page above renders.
 */
test.describe('command palette', () => {
  for (const theme of THEMES) {
    test(`the open command palette meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/?path=/overview')
      await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.keyboard.press('ControlOrMeta+k')
      const palette = page.getByRole('dialog', { name: 'Command palette' })
      await expect(palette).toBeVisible()
      // Populated, with one option highlighted: an empty palette grades clean and proves nothing.
      await expect(palette.getByRole('option').first()).toBeVisible()
      await expect(palette.locator('[data-highlighted]')).toHaveCount(1)

      await afterAnimations(palette)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="dialog"]')
      expect(report('palette', theme, result), report('palette', theme, result)).toBe('')
    })
  }
})

/**
 * The tenant actions menu and the two dialogs a lifecycle action stacks: the
 * reason dialog, then the step-up the harness's suspend always asks for.
 * Each carries its own token pairs (the destructive item, the alert dialog's
 * surface, the step-up over it), and none renders until driven open.
 */
test.describe('tenant actions and their dialogs', () => {
  for (const theme of THEMES) {
    test(`the tenant actions menu, the reason dialog and the step-up dialog meet WCAG AA contrast in ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto(`/e2e/harness/?path=${ACME_PAGE}`)
      await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.getByRole('button', { name: 'Actions', exact: true }).click()
      const menu = page.getByRole('menu')
      // Archive is the destructive item, with its own token pair: the menu must be populated, or this grades nothing.
      await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeVisible()
      await afterAnimations(menu)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })
      const menuResult = await runAxe(page, '[role="menu"]')
      expect(
        report('tenant actions menu', theme, menuResult),
        report('tenant actions menu', theme, menuResult)
      ).toBe('')

      await menu.getByRole('menuitem', { name: 'Suspend' }).click()
      const reason = page.getByRole('alertdialog', { name: 'Suspend Acme Corp?' })
      await expect(reason.getByLabel('Reason')).toBeVisible()
      await afterAnimations(reason)
      const reasonResult = await runAxe(page, '[role="alertdialog"]')
      expect(
        report('reason dialog', theme, reasonResult),
        report('reason dialog', theme, reasonResult)
      ).toBe('')

      await reason.getByLabel('Reason').fill('contrast check')
      await reason.getByRole('button', { name: 'Suspend' }).click()
      const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
      await expect(stepUp.getByLabel('Password')).toBeVisible()
      await afterAnimations(stepUp)
      const stepUpResult = await runAxe(page, '[role="dialog"]')
      expect(
        report('step-up dialog', theme, stepUpResult),
        report('step-up dialog', theme, stepUpResult)
      ).toBe('')

      // Dismissed: the reason dialog now shows its form error, a token pair of its own.
      await page.keyboard.press('Escape')
      await expect(reason.getByText('Confirm it’s you to continue.')).toBeVisible()
      await afterAnimations(reason)
      const errorResult = await runAxe(page, '[role="alertdialog"]')
      expect(
        report('reason dialog error', theme, errorResult),
        report('reason dialog error', theme, errorResult)
      ).toBe('')
    })
  }
})

test.describe('user actions menu', () => {
  for (const theme of THEMES) {
    test(`the open user actions menu meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto(`/e2e/harness/?path=${CLEO_PAGE}`)
      await expect(page.getByRole('heading', { name: 'Cleo D', level: 1 })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.getByRole('button', { name: 'Actions for cleo.d@example.com' }).click()
      const menu = page.getByRole('menu')
      // The destructive item carries its own token pair: the menu must be populated, or this grades nothing.
      await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible()

      await afterAnimations(menu)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, '[role="menu"]')
      expect(
        report('user actions menu', theme, result),
        report('user actions menu', theme, result)
      ).toBe('')
    })
  }
})

/** WCAG 1.4.11: a chart mark needs 3:1 against what it is drawn on. */
const NON_TEXT_MINIMUM = 3

/**
 * The chart series tokens against the card the charts sit on (WCAG 1.4.11,
 * non-text contrast). axe grades text only, so a series colour too pale to
 * tell from its card would pass every other test here. All five are measured,
 * including those the overview does not use, since they are the palette the next
 * chart picks from. Each colour is resolved to sRGB by painting it on a canvas,
 * because Chromium's `getComputedStyle` reports `oklch()` tokens back as `oklch()`.
 */
test.describe('chart series', () => {
  for (const theme of THEMES) {
    test(`each --chart-N has 3:1 against the chart card in ${theme}`, async ({ page }) => {
      await contrastOf(page, '/e2e/harness/', theme, 'Overview')
      const chart = page
        .getByRole('figure', { name: 'Sign-ups per day' })
        .locator('[data-slot="chart"]')
      await expect(chart).toBeVisible()

      const ratios = await chart.evaluate((element) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        /** The sRGB bytes of `colours` painted in order over the page background. */
        const paint = (...colours: string[]) => {
          context.clearRect(0, 0, 1, 1)
          for (const colour of [getComputedStyle(document.body).backgroundColor, ...colours]) {
            context.fillStyle = colour
            context.fillRect(0, 0, 1, 1)
          }
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
        }
        /** The relative luminance of an sRGB colour, as WCAG defines it. */
        const luminance = (rgb: number[]) => {
          const [r, g, b] = rgb.map((byte) => {
            const c = byte / 255
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
        }
        const card = getComputedStyle(element.closest('[data-slot="card"]')!).backgroundColor
        const cardLuminance = luminance(paint(card))
        const style = getComputedStyle(element)
        return [1, 2, 3, 4, 5].map((n) => {
          const token = style.getPropertyValue(`--chart-${n}`).trim()
          const series = luminance(paint(card, token))
          const [lighter, darker] = [series, cardLuminance].sort((a, b) => b - a)
          return { token: `--chart-${n}: ${token}`, ratio: (lighter! + 0.05) / (darker! + 0.05) }
        })
      })

      expect(ratios).toHaveLength(5)
      const failing = ratios
        .filter(({ ratio }) => ratio < NON_TEXT_MINIMUM)
        .map(({ token, ratio }) => `${token} is ${ratio.toFixed(2)}:1`)
      expect(failing, `series under ${NON_TEXT_MINIMUM}:1 on the card in ${theme}`).toEqual([])
    })
  }
})

/**
 * The staff surfaces: the Staff badge on an Activity row and the three tenant
 * status badges, each asserted present, because a page without them grades
 * clean and proves nothing about their token pairs.
 */
test.describe('staff surfaces', () => {
  for (const theme of THEMES) {
    test(`the Activity Staff badge meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      const result = await contrastOf(page, '/e2e/harness/?path=/activity', theme, 'Activity')
      const row = page.getByRole('listitem').filter({ hasText: 'Sam Staff' })
      await expect(row.getByText('Staff', { exact: true })).toBeVisible()
      expect(report('staff badge', theme, result), report('staff badge', theme, result)).toBe('')
    })

    test(`the Tenants status badges meet WCAG AA contrast in ${theme}`, async ({ page }) => {
      const result = await contrastOf(page, '/e2e/harness/?path=/tenants', theme, 'Tenants')
      const table = page.getByRole('table', { name: 'Tenants' })
      for (const status of ['Active', 'Suspended', 'Archived']) {
        await expect(table.getByText(status, { exact: true })).toBeVisible()
      }
      expect(report('status badges', theme, result), report('status badges', theme, result)).toBe(
        ''
      )
    })
  }
})

/**
 * Message tracking's surfaces, at phone width, in both themes: the email
 * status badges (each surface's `shows` asserted visible before its result is
 * judged), the suppressed-address banner, the preview tab's frame chrome,
 * Deliverability with and without provider data, Suppressions with an active
 * and a lifted row, the tenant's Emails tab and the user's Emails card, then
 * the lift and resend dialogs. 390px because the harness's long address makes
 * these pages the widest.
 */
const DELIVERED_EMAIL = '/emails/70000000-0000-4000-8000-000000000001'
const SUPPRESSED_EMAIL = '/emails/70000000-0000-4000-8000-000000000002'
const LONG_ADDRESS = 'a-very-long-address-for-the-overflow-check@example-corp.co.uk'

const TRACKING_SURFACES = [
  { name: 'emails', path: '/emails', heading: /^Emails$/, shows: ['Delivered', 'Bounced'] },
  { name: 'suppressed email', path: SUPPRESSED_EMAIL, heading: LONG_ADDRESS, shows: ['Bounced'] },
  {
    name: 'email preview',
    path: `${DELIVERED_EMAIL}?tab=preview`,
    heading: 'cleo.d@example.com',
    shows: [],
  },
  { name: 'deliverability', path: '/deliverability', heading: 'Deliverability', shows: [] },
  {
    name: 'deliverability without provider events',
    path: '/deliverability?range=30d',
    heading: 'Deliverability',
    shows: ['No provider data'],
  },
  {
    name: 'suppressions',
    path: '/suppressions?state=active,lifted',
    heading: 'Suppressions',
    shows: ['Active'],
  },
  { name: 'tenant emails', path: `${ACME_PAGE}/emails`, heading: 'Acme Corp', shows: ['Bounced'] },
  { name: 'user emails card', path: CLEO_PAGE, heading: /^Emails$/, shows: ['Delivered'] },
] as const

test.describe('message tracking at 390px', () => {
  for (const theme of THEMES) {
    for (const surface of TRACKING_SURFACES) {
      test(`${surface.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        const result = await contrastOf(
          page,
          `/e2e/harness/?path=${surface.path}`,
          theme,
          surface.heading
        )
        for (const text of surface.shows) {
          await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
        }
        const unproven = result.incomplete.flatMap((i) =>
          i.nodes.map((n) => n.target.join(' ')).filter((target) => !target.includes(LEGEND_ITEM))
        )
        if (unproven.length > 0) {
          console.warn(
            `[contrast] ${surface.name} · ${theme}: ${unproven.length} node(s) axe could not resolve — check by eye:\n  ${unproven.join('\n  ')}`
          )
        }
        expect(report(surface.name, theme, result), report(surface.name, theme, result)).toBe('')
      })
    }

    test(`the lift and resend dialogs meet WCAG AA contrast in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await contrastOf(page, '/e2e/harness/?path=/suppressions', theme, 'Suppressions')
      await page.getByRole('button', { name: `Lift suppression for ${LONG_ADDRESS}` }).click()
      const lift = page.getByRole('alertdialog', { name: 'Lift this suppression?' })
      await expect(lift.getByLabel('Reason')).toBeVisible()
      await afterAnimations(lift)
      const liftResult = await runAxe(page, '[role="alertdialog"]')
      expect(
        report('lift dialog', theme, liftResult),
        report('lift dialog', theme, liftResult)
      ).toBe('')

      await page.keyboard.press('Escape')
      await expect(lift).toHaveCount(0)
      await page.goto(`/e2e/harness/?path=${DELIVERED_EMAIL}`)
      await expect(page.getByRole('heading', { name: 'cleo.d@example.com', level: 1 })).toBeVisible(
        {
          timeout: COLD_TRANSFORM_BUDGET_MS,
        }
      )
      await page.getByRole('button', { name: 'Resend' }).click()
      const resend = page.getByRole('alertdialog', { name: 'Resend this email?' })
      await expect(resend.getByLabel('Reason')).toBeVisible()
      await afterAnimations(resend)
      await page.addScriptTag({ path: AXE_PATH })
      const resendResult = await runAxe(page, '[role="alertdialog"]')
      expect(
        report('resend dialog', theme, resendResult),
        report('resend dialog', theme, resendResult)
      ).toBe('')
    })
  }
})

// Each note and compact empty state is asserted present: a page without it grades clean and proves nothing.
const NOTE_SURFACES = [
  {
    name: 'warning note (partial email preview)',
    url: `/e2e/harness/?path=${DELIVERED_EMAIL}?tab=preview&preview=partial`,
    heading: 'cleo.d@example.com',
    role: 'status',
    text: 'Some of this email’s details were not stored',
  },
  {
    name: 'warning note (stale flags snapshot)',
    url: `${FLAGS_PAGE}&flags=stale`,
    heading: 'Feature flags',
    role: 'status',
    text: /snapshot/i,
  },
  {
    name: 'info note (template unavailable)',
    url: `/e2e/harness/?path=${DELIVERED_EMAIL}?tab=preview&preview=unavailable`,
    heading: 'cleo.d@example.com',
    role: 'status',
    text: 'no longer part of the app',
  },
  {
    name: 'passive note (no provider events)',
    url: '/e2e/harness/?path=/deliverability?range=30d',
    heading: 'Deliverability',
    role: null,
    text: 'No provider events yet',
  },
  {
    name: 'compact empty state (user emails card)',
    url: `/e2e/harness/?path=${CLEO_PAGE}&emails=none`,
    heading: /^Emails$/,
    role: null,
    text: 'No emails sent to this account yet.',
  },
] as const

test.describe('notes and compact empty states', () => {
  for (const theme of THEMES) {
    for (const surface of NOTE_SURFACES) {
      test(`the ${surface.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
        const result = await contrastOf(page, surface.url, theme, surface.heading)
        const shown = page.getByText(surface.text).first()
        await expect(shown).toBeVisible()
        if (surface.role) {
          await expect(page.getByRole(surface.role).filter({ hasText: surface.text })).toBeVisible()
        }
        expect(report(surface.name, theme, result), report(surface.name, theme, result)).toBe('')
      })
    }
  }
})

/**
 * Onboarding's surfaces, at phone width, in both themes: the page on two
 * tabs, a tenant's Onboarding tab in every state (each badge tone asserted
 * visible first; the harness's `?onboarding=` picks Acme's state), the
 * suspended and awaiting-owner tabs, then both reason dialogs.
 */
const ACME_ONBOARDING = `${ACME_PAGE}/onboarding`

const ONBOARDING_SURFACES = [
  { name: 'onboarding', url: '/e2e/harness/?path=/onboarding', heading: 'Tenants', shows: 'Stuck' },
  {
    name: 'onboarding awaiting owner tab',
    url: '/e2e/harness/?path=/onboarding?state=awaiting_owner',
    heading: 'Tenants',
    shows: 'Delta LLC',
  },
  ...(
    [
      ['stuck', 'Stuck'],
      ['in_progress', 'In progress'],
      ['complete', 'Complete'],
      ['dismissed', 'Dismissed'],
      ['not_tracked', 'Not tracked'],
    ] as const
  ).map(([state, badge]) => ({
    name: `tenant onboarding ${state}`,
    url: `/e2e/harness/?path=${ACME_ONBOARDING}&onboarding=${state}`,
    heading: /^Onboarding$/,
    shows: badge,
  })),
  {
    name: 'suspended tenant onboarding',
    url: '/e2e/harness/?path=/tenants/10000000-0000-4000-8000-000000000002/onboarding',
    heading: 'Reminders',
    shows: 'Stuck',
  },
  {
    name: 'tenant onboarding awaiting owner',
    url: '/e2e/harness/?path=/tenants/10000000-0000-4000-8000-000000000004/onboarding',
    heading: 'Reminders',
    shows: 'Awaiting owner',
  },
] as const

test.describe('onboarding at 390px', () => {
  for (const theme of THEMES) {
    for (const surface of ONBOARDING_SURFACES) {
      test(`${surface.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        const result = await contrastOf(page, surface.url, theme, surface.heading)
        await expect(page.getByText(surface.shows, { exact: true }).first()).toBeVisible()
        if (result.incomplete.length > 0) {
          const targets = result.incomplete.flatMap((i) => i.nodes.map((n) => n.target.join(' ')))
          console.warn(
            `[contrast] ${surface.name} · ${theme}: ${targets.length} node(s) axe could not resolve — check by eye:\n  ${targets.join('\n  ')}`
          )
        }
        expect(report(surface.name, theme, result), report(surface.name, theme, result)).toBe('')
      })
    }

    test(`the mark-complete and reminder dialogs meet WCAG AA contrast in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await contrastOf(page, `/e2e/harness/?path=${ACME_ONBOARDING}`, theme, 'Reminders')
      for (const [trigger, title] of [
        ['Mark complete: Invite a teammate', 'Mark “Invite a teammate” complete?'],
        ['Send reminder', 'Send an onboarding reminder?'],
      ] as const) {
        await page.getByRole('button', { name: trigger }).click()
        const dialog = page.getByRole('alertdialog', { name: title })
        await expect(dialog.getByLabel('Reason')).toBeVisible()
        await afterAnimations(dialog)
        const result = await runAxe(page, '[role="alertdialog"]')
        expect(report(title, theme, result), report(title, theme, result)).toBe('')
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
      }
    })
  }
})

/** WCAG 1.4.3: text below the large-text size (18pt, or 14pt bold) needs 4.5:1. */
const TEXT_MINIMUM = 4.5

/**
 * The onboarding funnel, measured directly rather than through axe: its
 * labels and bars sit in an `aria-hidden` block (the sr-only table carries
 * the figures), and its bars are non-text marks axe never grades. The muted
 * share labels and the legend are held to 4.5:1 on the card; each drawn bar
 * segment, the staff share among them, to 3:1 against the track it is drawn
 * on and the card around it (WCAG 1.4.11).
 */
test.describe('onboarding funnel', () => {
  for (const theme of THEMES) {
    test(`its muted labels and bar segments meet WCAG AA contrast in ${theme}`, async ({
      page,
    }) => {
      await contrastOf(page, '/e2e/harness/?path=/onboarding', theme, 'Onboarding funnel')
      const funnel = page.getByRole('figure', { name: 'Onboarding funnel' })
      // Four steps, two of them with a staff share: an empty funnel would compare nothing.
      await expect(funnel.locator('li .rounded-full')).toHaveCount(4)
      await expect(funnel.getByText(/\d by staff$/)).toHaveCount(2)

      const measured = await funnel.evaluate((figure) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        /** The sRGB bytes of `colours` painted in order over the page background. */
        const paint = (...colours: string[]) => {
          context.clearRect(0, 0, 1, 1)
          for (const colour of [getComputedStyle(document.body).backgroundColor, ...colours]) {
            context.fillStyle = colour
            context.fillRect(0, 0, 1, 1)
          }
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
        }
        /** The relative luminance of an sRGB colour, as WCAG defines it. */
        const luminance = (rgb: number[]) => {
          const [r, g, b] = rgb.map((byte) => {
            const c = byte / 255
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
        }
        /** The WCAG contrast ratio between two luminances. */
        const ratio = (a: number, b: number) => {
          const [lighter, darker] = [a, b].sort((x, y) => y - x)
          return (lighter! + 0.05) / (darker! + 0.05)
        }
        const card = getComputedStyle(figure.closest('[data-slot="card"]')!).backgroundColor
        const cardLuminance = luminance(paint(card))

        const labels = [...figure.querySelectorAll('.text-muted-foreground')]
          .filter((element) => element.textContent?.trim())
          .map((element) => ({
            text: element.textContent.trim(),
            ratio: ratio(luminance(paint(card, getComputedStyle(element).color)), cardLuminance),
          }))

        const segments = [...figure.querySelectorAll('li .rounded-full')].flatMap((track) => {
          const trackLuminance = luminance(paint(card, getComputedStyle(track).backgroundColor))
          return [...track.children].flatMap((segment, index) => {
            // A step with no staff completions draws its staff segment at zero width: nothing to see, nothing to grade.
            if (segment.getBoundingClientRect().width === 0) return []
            const fill = luminance(paint(card, getComputedStyle(segment).backgroundColor))
            return {
              segment: `${index === 0 ? 'completed' : 'staff'} on ${track.closest('li')!.querySelector('.font-medium')!.textContent}`,
              onTrack: ratio(fill, trackLuminance),
              onCard: ratio(fill, cardLuminance),
            }
          })
        })
        return { labels, segments }
      })

      // Four share labels, the two "· optional" suffixes and the legend, which sets the colour of both its entries.
      expect(measured.labels).toHaveLength(7)
      const faintLabels = measured.labels
        .filter(({ ratio }) => ratio < TEXT_MINIMUM)
        .map(({ text, ratio }) => `"${text}" is ${ratio.toFixed(2)}:1`)
      expect(faintLabels, `funnel labels under ${TEXT_MINIMUM}:1 in ${theme}`).toEqual([])

      // Four completed segments and the two staff shares that have width.
      expect(measured.segments).toHaveLength(6)
      const faintSegments = measured.segments
        .filter(({ onTrack, onCard }) => Math.min(onTrack, onCard) < NON_TEXT_MINIMUM)
        .map(
          ({ segment, onTrack, onCard }) =>
            `${segment} is ${onTrack.toFixed(2)}:1 on the track, ${onCard.toFixed(2)}:1 on the card`
        )
      expect(faintSegments, `funnel bars under ${NON_TEXT_MINIMUM}:1 in ${theme}`).toEqual([])
    })
  }
})

/**
 * The toasts, graded at the toast: the popover surface with a status border and
 * icon, which no page entry renders. axe grades the text; the icon and the
 * border are non-text marks it never grades, so they are measured here, and
 * held to the 4.5:1 their tokens were chosen for on `--popover`. The error
 * toast comes from an OAuth `?error=` on sign-in, the success toast from
 * signing out other sessions on the harness's Security page. No warning toast
 * is reachable through the harness: its raises need an answer it does not
 * mock (an email that was not sent, a maintenance change that stored nothing).
 */
test.describe('toasts', () => {
  const TOASTS = [
    {
      name: 'error toast',
      url: '/login?error=google_auth_failed',
      title: 'Google sign-in failed. Please try again.',
      raise: async () => {},
    },
    {
      name: 'success toast',
      url: '/e2e/harness/?path=/settings/account/security',
      title: 'Signed out 2 other sessions.',
      raise: async (page: Page) => {
        await page
          .getByRole('button', { name: 'Sign out other sessions' })
          .click({ timeout: COLD_TRANSFORM_BUDGET_MS })
      },
    },
  ] as const

  for (const theme of THEMES) {
    for (const entry of TOASTS) {
      test(`the ${entry.name} meets WCAG AA contrast in ${theme}`, async ({ page }) => {
        await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
        await page.goto(entry.url)
        await entry.raise(page)
        const item = page.getByRole('dialog', { name: entry.title })
        await expect(item).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })

        await afterAnimations(item)
        await afterFontsAndFrames(page)
        await page.addScriptTag({ path: AXE_PATH })

        const result = await runAxe(page, '[data-slot="toast"]')
        expect(report(entry.name, theme, result), report(entry.name, theme, result)).toBe('')

        const marks = await item.evaluate((toast) => {
          const canvas = document.createElement('canvas')
          canvas.width = 1
          canvas.height = 1
          const context = canvas.getContext('2d', { willReadFrequently: true })!
          /** The sRGB bytes of `colours` painted in order over the page background. */
          const paint = (...colours: string[]) => {
            context.clearRect(0, 0, 1, 1)
            for (const colour of [getComputedStyle(document.body).backgroundColor, ...colours]) {
              context.fillStyle = colour
              context.fillRect(0, 0, 1, 1)
            }
            return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
          }
          /** The relative luminance of an sRGB colour, as WCAG defines it. */
          const luminance = (rgb: number[]) => {
            const [r, g, b] = rgb.map((byte) => {
              const c = byte / 255
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
          }
          /** The WCAG contrast ratio between two luminances. */
          const ratio = (a: number, b: number) => {
            const [lighter, darker] = [a, b].sort((x, y) => y - x)
            return (lighter! + 0.05) / (darker! + 0.05)
          }
          const surface = getComputedStyle(toast).backgroundColor
          const surfaceLuminance = luminance(paint(surface))
          const icon = toast.querySelector('[data-slot="toast-icon"] svg')!
          return [
            {
              mark: 'icon',
              ratio: ratio(
                luminance(paint(surface, getComputedStyle(icon).color)),
                surfaceLuminance
              ),
            },
            {
              mark: 'border',
              ratio: ratio(
                luminance(paint(surface, getComputedStyle(toast).borderTopColor)),
                surfaceLuminance
              ),
            },
          ]
        })
        const faint = marks
          .filter(({ ratio }) => ratio < TEXT_MINIMUM)
          .map(({ mark, ratio }) => `${mark} is ${ratio.toFixed(2)}:1 on the toast`)
        expect(faint, `${entry.name} marks under ${TEXT_MINIMUM}:1 in ${theme}`).toEqual([])
      })
    }
  }
})

/**
 * The suite's own isolation. Without the fallback in `../hermetic` this
 * refresh goes through the Vite proxy: `answered` stays empty, and the
 * fixture's teardown reports the unstamped response.
 */
test('a public page gets its bootstrap refresh from the fallback, not the dev server proxy', async ({
  page,
  apiFallback,
}) => {
  await page.goto('/login')
  // The root beforeLoad awaits the refresh, so the heading means it has settled.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  expect(apiFallback.answered).toContain('POST /api/v1/auth/refresh')
})
