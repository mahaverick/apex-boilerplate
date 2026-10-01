import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, FALLBACK_HEADER, test } from '../hermetic'
import { afterAnimations, afterFontsAndFrames } from '../timing'

/**
 * COLOUR CONTRAST, measured.
 *
 * `tests/unit/a11y.test.tsx` disables every `cat.color` rule, and says so in its
 * header: jest-axe turns them off by default under jsdom because jsdom has no
 * layout and no cascade, so a contrast ratio cannot be computed there at all.
 * A green run of the a11y gate therefore says **nothing** about contrast, and
 * the Phase B renders only made it *visible*, not *checked*.
 *
 * A real browser can compute it. This suite injects the same axe-core the unit
 * gate uses — already a devDependency, no new package — and runs the one rule
 * that needs pixels, in both themes.
 *
 * Deliberately NOT in CI and not part of `pnpm test`: run it with
 * `pnpm test:contrast` when tokens or surfaces change. Contrast is a property
 * of the palette, which moves rarely and deliberately.
 *
 * No surface depends on a backend. `test` comes from `../hermetic`, which
 * answers every `/api` request that would leave the browser with a 401, so the
 * public pages' session bootstrap cannot reach whatever runs on :4040, nor hang
 * on it while it restarts.
 */

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')

/**
 * The dev server transforms a lazily loaded route's modules on first
 * request, which has taken past 7s under load, and `goto` resolves on
 * `load` before that. Below the 30s test timeout, so a hang is reported by
 * the heading assertion.
 */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/**
 * A chart legend's text. recharts positions its legend wrapper absolutely
 * over the chart's SVG, so axe cannot resolve the background behind it and
 * files it as incomplete; the 'chart legends' test measures it another way.
 */
const LEGEND_ITEM = '.recharts-legend-wrapper'

/**
 * Every surface reachable without a backend, with a selector proving the page
 * actually rendered.
 *
 * `expect` is not optional decoration. A route that silently redirected — an
 * authenticated page losing its session, a `validateSearch` rejecting a token
 * and bouncing to /login — would still produce a fully painted page with
 * perfectly good contrast, and this suite would report it green while
 * measuring something else entirely. Each entry therefore names something only
 * THAT surface renders, asserted before axe runs.
 *
 * The `/e2e/harness/` entries mount an in-app route with MSW answering and the
 * auth store pre-populated (e2e/harness/harness.tsx). `?path=` picks which
 * route; without it the harness mounts the overview.
 */
const ACME_PAGE = '/tenants/10000000-0000-4000-8000-000000000001'
const CLEO_PAGE = '/users/20000000-0000-4000-8000-000000000002'

const SURFACES = [
  // Public — straight URLs, no harness needed.
  { name: 'sign-in', url: '/login', heading: 'Sign in' },
  // Invitation-only: without `?invitation=` the route redirects to /login, and the form waits on the preview, which `answerInvitationPreview` supplies.
  {
    name: 'register',
    url: '/register?invitation=contrast-probe',
    heading: 'Create an account',
  },
  { name: 'forgot-password', url: '/forgot-password', heading: 'Forgot your password?' },
  // Both of these routes read a token out of the query. Without one, reset-password renders its "This link is incomplete" branch instead — a real surface, but not the one worth measuring, and the heading assertion is what keeps that swap from passing unnoticed.
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
  // Authenticated — mounted through the harness. The overview is strict: any axe incomplete fails, except the chart legends, which 'chart legends' below proves instead.
  {
    name: 'overview',
    url: '/e2e/harness/',
    heading: 'Overview',
    provenIncomplete: LEGEND_ITEM,
  },
  { name: 'profile', url: '/e2e/harness/?path=/profile', heading: 'Sign-in methods' },
  { name: 'tenants', url: '/e2e/harness/?path=/tenants', heading: 'Tenants' },
  { name: 'activity', url: '/e2e/harness/?path=/activity', heading: 'Activity' },
  // Exact: the page's own h2s ('Staff members', 'Invite staff') also contain the word.
  { name: 'staff', url: '/e2e/harness/?path=/staff', heading: /^Staff$/ },
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
] as const

const THEMES = ['light', 'dark'] as const

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
 * The theme must be set BEFORE the document runs: index.html loads a
 * pre-paint script that reads localStorage and toggles `.dark` before the
 * bundle loads, so setting it afterwards would measure a repaint rather
 * than the real render.
 *
 * Loading the surface is proved, not assumed, BEFORE measuring it: a route
 * that redirected — an authenticated page without a session, a
 * `validateSearch` rejecting the probe token — still paints a perfectly
 * legible page, so contrast over it would come back green while saying
 * nothing about the surface this entry names.
 */
async function contrastOf(
  page: Page,
  url: string,
  theme: string,
  heading: string | RegExp,
  scope?: string
): Promise<ContrastResult> {
  await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
  await page.goto(url)
  await expect(page.getByRole('heading', { name: heading })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  // The heading can render outside each page's data conditional, so it can show while the data behind it is still a skeleton. Grade the loaded page.
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)

  // Fonts change glyph coverage, not colour, but a late swap can move text over a different background. Sample only once it has reflowed.
  await afterFontsAndFrames(page)

  await page.addScriptTag({ path: AXE_PATH })

  return runAxe(page, scope)
}

/**
 * Run axe's contrast rule over the whole document, or over one element.
 *
 * Scoping matters for the popup surfaces: the page behind an open menu is
 * already graded by its own entry above, so running the whole document again
 * would report the same nodes twice and make a popup failure harder to see,
 * not easier.
 * @param page - The page, with axe already injected.
 * @param scope - A selector to grade instead of the whole document.
 * @returns axe's violations and incompletes.
 */
async function runAxe(page: Page, scope?: string): Promise<ContrastResult> {
  return page.evaluate(async (selector) => {
    // `color-contrast` ONLY. Everything else about these pages is already gated by tests/unit/a11y.test.tsx, and re-running it here would mean two sources of truth for the same finding.
    const results = await (
      window as unknown as {
        axe: { run: (ctx: Document | Element, opts: unknown) => Promise<ContrastResult> }
      }
    ).axe.run((selector ? document.querySelector(selector) : document) ?? document, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations'],
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

/** axe's failureSummary carries the ratio and both colours; keep it readable. */
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
       * `incomplete` is not a pass. axe files a node here when it cannot
       * resolve the background — a gradient, an image, an overlapped
       * element — and those are exactly the cases a human has to look at.
       * Surfaced rather than asserted, because a false alarm here should
       * not block.
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
 * Popup surfaces — menus and the mobile sheet.
 *
 * These carry their own `--popover` / `--popover-foreground` pair (and the
 * sheet its own background), so a failure on one is invisible to every page
 * test above: axe only sees what is in the DOM, and a closed menu is not.
 * That makes them the surfaces most likely to hide a bad token pair, and the
 * ones a palette change is least likely to be checked against by eye.
 *
 * Selectors are ported from `tests/unit/a11y.test.tsx`'s "open overlays" and
 * menu blocks, which already drive each of these open — deliberately reused
 * rather than reinvented, so the two suites cannot drift on what "the user
 * menu" means.
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
      // A menu that opened EMPTY would grade clean while saying nothing about the items this test exists for — the same guard the a11y gate states for its own menu block.
      await expect(menu.getByRole(popup.itemRole).first()).toBeVisible()

      await afterAnimations(menu)
      await afterFontsAndFrames(page)
      await page.addScriptTag({ path: AXE_PATH })

      const result = await runAxe(page, `[role="${popup.role}"]`)
      expect(report(popup.name, theme, result), report(popup.name, theme, result)).toBe('')
    })
  }
}

test.describe('popups that are not menus', () => {
  for (const theme of THEMES) {
    test(`the mobile navigation sheet meets WCAG AA contrast in ${theme}`, async ({ page }) => {
      // The sheet carries its own background token, and it only exists below the desktop breakpoint — so the desktop shell tests above can never reach it however many pages they visit.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
      await page.goto('/e2e/harness/?path=/overview')
      await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
        timeout: COLD_TRANSFORM_BUDGET_MS,
      })

      await page.getByRole('button', { name: 'Toggle sidebar' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      // Opened AND populated: an empty sheet grades clean and proves nothing.
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
      // Archive is the destructive item, with its own token pair: opened AND populated, or this grades nothing.
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

      await page.getByRole('button', { name: 'Actions for c@d.com' }).click()
      const menu = page.getByRole('menu')
      // The destructive item carries its own token pair; opened AND populated, or this grades nothing.
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
 * not only the ones the overview uses today: they are the palette the next
 * chart picks from. Each colour is resolved to sRGB by painting it on a canvas,
 * since Chromium reports `oklch()` tokens back as `oklch()`.
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
