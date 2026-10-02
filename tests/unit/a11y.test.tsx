import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axeCore from 'axe-core'
import { http } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  EMAIL_ATTEMPT_ID,
  EMAIL_EVENT_ID,
  EMAIL_ID,
  EMAIL_ID_2,
  EMAIL_ID_3,
  INVITATION_ID,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  PLATFORM_TENANT_ID,
  STAFF_USER_ID,
  SUPPRESSION_ID,
  SUPPRESSION_ID_2,
  TENANT_ID,
  TENANT_ID_2,
  TENANT_ID_3,
  USER_ID,
  USER_ID_2,
  USER_ID_3,
} from '@/tests/fixtures/ids'
import { renderAppAt } from '@/tests/fixtures/render-app'
import {
  emailDetail,
  emailSummary,
  emailSuppression,
  fail,
  ok,
  onboardingReminder,
  onboardingTenantRow,
  tenantOnboardingAfterStaffCompletion,
  tenantOnboardingDetail,
  TEST_INVITATION_TOKEN,
  testEmailHealth,
  testEmailPreview,
  testInvitation,
  testOnboardingFunnel,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import {
  EMAIL_MESSAGE_STATUSES,
  ONBOARDING_LIST_STATES,
  type AuditEntry,
  type EmailMessageSummary,
  type EmailSuppression,
  type PlatformAuditEntry,
  type PlatformTenantDetail,
  type PlatformTenantRow,
  type PlatformUserDetail,
  type PlatformUserRow,
  type TenantLifecycleState,
} from '@/types/api.types'

/**
 * THE ACCESSIBILITY GATE. Spec section 9's criteria, made enforceable.
 *
 * Five things about this file are deliberate and easy to undo by accident:
 *
 * 1. IT RUNS OVER `document`, NOT over a fragment. Not `axe(container)` and not
 *    even `axe(document.body)`: axe's PAGE-LEVEL rules — `page-has-heading-one`,
 *    `landmark-one-main`, `bypass`, `html-has-lang`, `document-title` — select on
 *    `html`, and axe reports them as `inapplicable` whenever the context is
 *    anything smaller than the document. Measured: with `document.body` as the
 *    context every one of them came back inapplicable, so the gate was silently
 *    grading a fragment. jest-axe's own `axe()` CANNOT take `document` (its
 *    `mount()` re-serialises anything not inside `body`, which destroys the
 *    DOM), so axe-core is called directly and jest-axe's default rule set is
 *    reproduced explicitly below. `toHaveNoViolations` is still jest-axe's.
 *
 * 2. WHAT COLOUR CONTRAST IS NOT CHECKED HERE. Every `cat.color` rule is
 *    disabled — by us here, exactly as jest-axe does it by default, because
 *    contrast cannot be computed in jsdom, which has no layout and no cascade
 *    (`node_modules/jest-axe/index.js`: "Color contrast checking doesnt work in
 *    a jsdom environment"). A green run on this file therefore says NOTHING
 *    about contrast. That is a browser check, and automating it belongs to the
 *    Phase B Playwright gate.
 *
 * 3. TWO PAGE-LEVEL RULES CANNOT RUN UNDER JSDOM, SO THEY ARE ASSERTED BY HAND.
 *    `page-has-heading-one` and `landmark-one-main` both query
 *    `[role=heading][aria-level=1]`, and jsdom's selector engine REJECTS an
 *    unquoted attribute value that starts with a digit — `document.querySelectorAll`
 *    throws "Invalid selector" on it. axe catches that and files the rule under
 *    `incomplete`, which `toHaveNoViolations` does not read, so both rules pass
 *    vacuously. `expectNoViolations` therefore asserts exactly one `<main>` and
 *    exactly one `<h1>` itself. That is what caught the five auth pages having
 *    no level-one heading at all.
 *
 * 4. NO RULE IS TURNED OFF beyond contrast. jest-axe's defaults are used as they
 *    come, `region` included. `region` exempts a `button` but NOT an `a`: the
 *    sidebar footer's controls are buttons and pass as they are, and the brand
 *    link in the sidebar header passes because it sits inside a `header`
 *    (banner) landmark. The rule genuinely runs (a stray `<p>` appended to
 *    `document.body` IS flagged, which the first test below asserts). If
 *    something starts tripping a rule, fix the markup.
 *
 * 5. THE DOCUMENT SHELL IS MIRRORED FROM `index.html`. jsdom's blank document
 *    has no `lang` and no `<title>`, so `html-has-lang` and `document-title`
 *    failed on every page for a reason belonging to the test harness rather than
 *    to the app — index.html really does ship both. Supplying them is providing
 *    the real shell, not suppressing a finding.
 *
 * Driven through a real `RouterProvider` on a memory history, not by rendering
 * each page component standalone as the brief sketched: the pages call
 * `Route.useSearch()`, `useNavigate()` and `useMatches()`, and the app shell is
 * where the landmarks, the breadcrumb trail and the nav actually live. Rendering
 * a page without it would gate a fragment nobody ever sees.
 */
/** `testUser.id` is `USER_ID`, so the first row is always "me". */
const MEMBERS = [
  {
    membership: {
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID, email: 'a@b.com', firstName: 'A', lastName: 'B' },
  },
  {
    membership: {
      id: MEMBERSHIP_ID_2,
      userId: USER_ID_2,
      tenantId: TENANT_ID,
      role: 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID_2, email: 'c@d.com', firstName: 'Cleo', lastName: 'D' },
  },
]

/** The platform tenant's staff, as the Staff page lists them: me an admin, Cleo a viewer. */
const STAFF_MEMBERS = MEMBERS.map((member, index) => ({
  ...member,
  membership: {
    ...member.membership,
    tenantId: PLATFORM_TENANT_ID,
    role: index === 0 ? 'admin' : 'viewer',
  },
}))

/** The Staff page's two requests beyond the platform tenant the top-level `beforeEach` answers. */
function serveStaff() {
  server.use(
    http.get('/api/v1/tenants/platform/members', () => ok(STAFF_MEMBERS, 'Members retrieved.')),
    http.get('/api/v1/tenants/platform/invitations', () => ok([], 'Invitations retrieved.'))
  )
}

/** One member action and one staff action, so the Staff badge is graded too. */
const AUDIT_ENTRIES: AuditEntry[] = [
  {
    id: AUDIT_ID_2,
    occurredAt: '2026-09-25T10:00:00.000Z',
    action: 'tenant.settings_updated',
    access: 'platform',
    actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
    target: { type: 'settings', id: TENANT_ID },
    metadata: { changed: ['timezone'] },
  },
  {
    id: AUDIT_ID_1,
    occurredAt: '2026-09-25T09:00:00.000Z',
    action: 'tenant.created',
    access: 'member',
    actor: { id: USER_ID, name: 'A B', email: 'a@b.com' },
    target: { type: 'tenant', id: TENANT_ID },
    metadata: { name: 'Acme Corp', slug: 'acme' },
  },
]
/** The tenant detail pages' platform read. */
const ACME_DETAIL: PlatformTenantDetail = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: 'Widgets',
  website: 'https://acme.test',
  logo: null,
  lifecycleState: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  deletedAt: null,
  settings: { timezone: 'UTC', locale: 'en' },
  memberCount: 2,
  owners: [{ userId: USER_ID_2, email: 'c@d.com', firstName: 'Cleo', lastName: 'D', active: true }],
  pendingInvitationCount: 0,
  pendingOwnerInvitation: null,
}

/** The platform tenant's row, for any page that looks up the caller's role in it. */
const PLATFORM_DETAIL_ROW = {
  id: PLATFORM_TENANT_ID,
  name: 'Platform',
  slug: 'platform',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** Acme in `state`, with every route its detail tabs read. */
function serveTenant(state: TenantLifecycleState) {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
      ok({ ...ACME_DETAIL, lifecycleState: state }, 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme', () =>
      ok(
        { ...ACME_DETAIL, isPlatform: false, role: 'admin', access: 'platform' },
        'Tenant retrieved.'
      )
    ),
    http.get('/api/v1/tenants/acme/members', () => ok(MEMBERS, 'Members retrieved.')),
    http.get('/api/v1/tenants/acme/invitations', () => ok([], 'Invitations retrieved.')),
    http.get('/api/v1/tenants/acme/audit-log', () =>
      ok({ entries: AUDIT_ENTRIES, nextCursor: null }, 'Audit log retrieved.')
    )
  )
}

/** A signed-in session, already bootstrapped, so `_app`'s guard lets pages render. */
function signIn() {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** A visitor with no refresh cookie, so `_auth`'s guard lets its pages render. */
function signOut() {
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/**
 * jest-axe's default rule set, reproduced explicitly because axe-core is being
 * driven directly. This is exactly what `configureAxe` does on import: take
 * every rule tagged `cat.color` and switch it off, since jsdom cannot compute
 * contrast.
 */
const AXE_OPTIONS: axeCore.RunOptions = {
  rules: Object.fromEntries(
    axeCore.getRules(['cat.color']).map(({ ruleId }) => [ruleId, { enabled: false }])
  ),
}

/**
 * The rules axe files under `incomplete` here for reasons that belong to jsdom,
 * not to the markup. Pinned as a set so a NEW one cannot appear unnoticed —
 * `toHaveNoViolations` reads only `violations`, so anything that quietly stops
 * being evaluable would otherwise look like a pass.
 *
 * - `page-has-heading-one`, `landmark-one-main`: axe's selector contains
 *   `[aria-level=1]`, which jsdom rejects as an invalid selector. Asserted by
 *   hand below instead.
 * - `heading-order`: "Unable to determine previous heading" for the first
 *   heading in the tree. Nothing to fix.
 * - `aria-hidden-focus`: "Check that focusable elements are not tabbable in the
 *   current state". Base UI marks the background `aria-hidden` and inert while a
 *   modal is open; whether its contents are still tabbable is a layout question
 *   jsdom cannot answer.
 * - `aria-valid-attr-value`: "Unable to determine if aria-controls referenced ID
 *   exists on the page while using aria-haspopup" (axe's own `controlsWithinPopup`
 *   check). The combobox trigger and its input both carry `aria-controls`
 *   alongside `aria-haspopup`, and both referenced IDs resolving is asserted
 *   in code by the "activity tenant filter open" test below, not just claimed here.
 *   This id is NOT accepted outright: `isOnlyControlsWithinPopup`, below,
 *   still fails a node whose `aria-valid-attr-value` finding is a genuinely
 *   dangling reference (`messageKey: 'noId'`) rather than this one.
 */
const KNOWN_INCOMPLETE = new Set([
  'page-has-heading-one',
  'landmark-one-main',
  'heading-order',
  'aria-hidden-focus',
  'aria-valid-attr-value',
])

/**
 * `aria-valid-attr-value` is pinned above for exactly ONE reason
 * (`controlsWithinPopup`), but axe files the SAME rule id for a genuinely
 * dangling `aria-describedby`/`aria-labelledby` (`messageKey: 'noId'`) or an
 * invalid enumerated value like `aria-current="bogus"`. Accepting the id
 * outright would swallow those too, so this checks every `any`/`all`/`none`
 * check on every flagged node and accepts the result only when EVERY one of
 * them is `controlsWithinPopup` — a node mixing that with a real dangling
 * reference still fails.
 */
function isOnlyControlsWithinPopup(result: axeCore.IncompleteResult): boolean {
  return result.nodes.every((node) => {
    const keys = [...node.any, ...node.all, ...node.none].map(
      (check) => (check.data as { messageKey?: unknown } | null | undefined)?.messageKey
    )
    return keys.length > 0 && keys.every((key) => key === 'controlsWithinPopup')
  })
}

/**
 * `results.incomplete`, minus the ones `KNOWN_INCOMPLETE` explains — with
 * `aria-valid-attr-value` narrowed by `isOnlyControlsWithinPopup` rather than
 * accepted by id alone, so a real dangling ARIA reference still surfaces here.
 */
function unexpectedIncomplete(results: axeCore.AxeResults): string[] {
  return results.incomplete
    .filter((result) => {
      if (!KNOWN_INCOMPLETE.has(result.id)) return true
      if (result.id === 'aria-valid-attr-value') return !isOnlyControlsWithinPopup(result)
      return false
    })
    .map((result) => result.id)
}

/**
 * Asserts the WHOLE document is clean — portals, landmarks and page-level rules
 * included — and then asserts by hand the two page-level invariants jsdom stops
 * axe from checking (see note 3 in the file header).
 *
 * That the axe verdict means anything is itself asserted, by the first test
 * below: a rule set that silently stopped running would make every page here
 * "pass".
 *
 * The context itself is pinned by assertion, not by this comment: changing
 * `document` below to `document.body` (the exact regression note 1 describes)
 * makes every page-level rule inapplicable while leaving `region`, the hand
 * assertions and every other test passing. `html-has-lang`, `document-title`
 * and `bypass` only produce a result when the context IS the document, so
 * asserting they ran is what makes the context non-negotiable.
 *
 * `frames: 'skip'` is for a page holding an iframe: axe hands each frame its
 * own run over `postMessage`, which a jsdom frame cannot answer (axe throws
 * "Respondable target must be a frame in the current window"). The frame
 * element itself, its `title` included, is still graded here; only the
 * document inside it (the email preview's own markup, not the app's) is not,
 * and axe files exactly that as `frame-tested`, one node per frame, under
 * `incomplete`, which this then accepts and nothing else.
 */
async function expectNoViolations({ frames = 'grade' }: { frames?: 'grade' | 'skip' } = {}) {
  const results = await axeCore.run(document, {
    ...AXE_OPTIONS,
    ...(frames === 'skip' ? { iframes: false } : {}),
  })
  expect(results).toHaveNoViolations()

  expect(results.passes.map((result) => result.id)).toEqual(
    expect.arrayContaining(['html-has-lang', 'document-title', 'bypass'])
  )

  if (frames === 'skip') {
    const skipped = results.incomplete.find((result) => result.id === 'frame-tested')
    expect(skipped?.nodes).toHaveLength(document.querySelectorAll('iframe').length)
  }
  expect(
    unexpectedIncomplete(results).filter((id) => frames === 'grade' || id !== 'frame-tested')
  ).toEqual([])

  // `page-has-heading-one` and `landmark-one-main`, by hand.
  expect(document.querySelectorAll('main')).toHaveLength(1)
  expect(document.querySelectorAll('h1')).toHaveLength(1)
}

/**
 * The same rule set, run against ONE OPEN OVERLAY instead of the document.
 *
 * Why this exists rather than reusing `expectNoViolations` for menus: Base UI
 * portals a menu popup to `document.body`, so at document scope axe's `region`
 * rule reports "Some page content is not contained by landmarks" for every open
 * menu. That is a PAGE-STRUCTURE rule - landmarks are how a screen-reader user
 * navigates the standing regions of a page - and it does not describe a barrier
 * in a transient popup that focus has just been moved into. The dialog and
 * sheet tests above do not hit it only because axe exempts `role="dialog"`.
 *
 * No rule is disabled here. The rule set is identical; the CONTEXT is narrowed,
 * so page-structure rules simply have no page to judge and the menu's own
 * markup - `menuitem` roles, accessible names, aria-* wiring - is what gets
 * graded. The page itself is still graded at document scope by the tests above.
 *
 * The crash class this block exists for is caught before axe runs at all: a
 * `DropdownMenuLabel` outside a `Menu.Group` throws on open, so `findByRole`
 * never resolves and the test fails there.
 *
 * The context is pinned by assertion, the same way `expectNoViolations` pins
 * the document: `aria-required-children` only produces a result when axe
 * really evaluated a `role="menu"`, so asserting it ran is what stops this
 * helper from passing vacuously if the context narrows further or points at
 * an element that is not the popup.
 */
async function expectNoViolationsIn(element: HTMLElement) {
  const results = await axeCore.run(element, AXE_OPTIONS)
  expect(results).toHaveNoViolations()

  expect(results.passes.map((result) => result.id)).toContain('aria-required-children')

  expect(unexpectedIncomplete(results)).toEqual([])
}

/**
 * Picks the viewport `useIsMobile` reports.
 *
 * `tests/setup.ts`'s `matchMedia` stub answers a `max-width` query from
 * `window.innerWidth`, so the width is what decides. Every test sets it before
 * rendering, so no change event is needed.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

const realInnerWidth = window.innerWidth

/**
 * The bits of `index.html` that jsdom's blank document does not have. Without
 * them `html-has-lang` and `document-title` fail on every page for a reason
 * that belongs to the harness, not the app — index.html really does ship
 * `<html lang="en">` and `<title>Apex</title>`. Keep these two in
 * step with that file.
 */
beforeAll(() => {
  document.documentElement.lang = 'en'
  document.title = 'Apex'
})

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  useSidebarStore.setState({ isCollapsed: false })
  useCommandPaletteStore.setState({ open: false })
  server.use(
    http.get('/api/v1/tenants/platform', () =>
      ok(
        { ...PLATFORM_DETAIL_ROW, isPlatform: true, role: 'admin', access: 'member' },
        'Tenant retrieved.'
      )
    )
  )
})

afterEach(() => {
  setViewportWidth(realInnerWidth)
})

describe('the axe gate itself', () => {
  /**
   * A stray `<p>` outside every landmark is exactly what `region` is about.
   * If this test ever stops failing, the rule set below is no longer running
   * and every other test in this file is vacuous. The assertion checks the
   * rule, not merely "something failed": a planted violation only proves the
   * gate if the rule it was planted for is the one that fired.
   */
  it('reports a violation when there is one, so a green run means something', async () => {
    signOut()
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })

    const stray = document.createElement('p')
    stray.textContent = 'Not in any landmark.'
    document.body.append(stray)
    try {
      const results = await axeCore.run(document, AXE_OPTIONS)
      expect(results.violations.map((violation) => violation.id)).toContain('region')
      expect(results).not.toHaveNoViolations()
    } finally {
      stray.remove()
    }
  })

  /**
   * Same proof as above, for the narrower claim `unexpectedIncomplete` makes:
   * `aria-valid-attr-value` is accepted ONLY for `controlsWithinPopup`, so a
   * genuinely dangling reference — the `noId` messageKey, not that one — must
   * still come back as unexpected. If this ever stops failing, the narrowing
   * has widened back to accepting the whole rule id and every combobox on
   * every page could grow a broken `aria-describedby` unnoticed.
   */
  it('does not swallow a dangling aria-describedby under aria-valid-attr-value', async () => {
    const stray = document.createElement('button')
    stray.setAttribute('aria-describedby', 'does-not-exist')
    stray.textContent = 'Stray'
    document.body.append(stray)
    try {
      const results = await axeCore.run(document, {
        runOnly: { type: 'rule', values: ['aria-valid-attr-value'] },
      })
      expect(unexpectedIncomplete(results)).toContain('aria-valid-attr-value')
    } finally {
      stray.remove()
    }
  })
})

/**
 * Each routed page in its settled state — not its skeleton. Every entry waits
 * on something only the loaded page renders before axe is asked anything.
 */
describe('signed-out pages', () => {
  beforeEach(signOut)

  it.each([
    ['login', '/login', () => screen.findByRole('button', { name: 'Sign in' })],
    [
      'register, from an invitation',
      `/register?invitation=${TEST_INVITATION_TOKEN}`,
      () => screen.findByRole('button', { name: 'Create account' }),
    ],
    [
      'forgot-password',
      '/forgot-password',
      () => screen.findByRole('button', { name: 'Send reset link' }),
    ],
    [
      'reset-password',
      '/reset-password?token=a-token',
      () => screen.findByRole('button', { name: 'Reset password' }),
    ],
    [
      'verify-email',
      '/verify-email?token=a-token',
      () => screen.findByRole('button', { name: 'Verify email' }),
    ],
    [
      'invitation accept',
      `/invitations/accept?token=${TEST_INVITATION_TOKEN}`,
      () => screen.findByRole('link', { name: 'Log in' }),
    ],
    [
      'invitation accept without a token',
      '/invitations/accept',
      () => screen.findByRole('heading', { name: 'This link is incomplete' }),
    ],
  ])('%s has no axe violations', async (_name, path, ready) => {
    renderAppAt(path)
    await ready()
    await expectNoViolations()
  })

  it('register with an unusable invitation has no axe violations', async () => {
    server.use(
      http.post('/api/v1/invitations/preview', () =>
        fail('Invalid invitation', 404, 'invitation_invalid')
      )
    )
    renderAppAt(`/register?invitation=${TEST_INVITATION_TOKEN}`)
    await screen.findByRole('heading', { name: 'This invitation can’t be used', level: 1 })
    await expectNoViolations()
  })
})

/** A customer account with a tenant, a pending invitation and no password: every card has content. */
const USER_DETAIL: PlatformUserDetail = {
  id: USER_ID_2,
  email: 'cleo@example.com',
  firstName: 'Cleo',
  lastName: 'Doe',
  active: true,
  emailVerifiedAt: null,
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: null,
  membershipCount: 1,
  hasPassword: false,
  authProviders: ['email'],
  memberships: [
    {
      tenantId: TENANT_ID,
      tenantName: 'Acme Corp',
      tenantSlug: 'acme',
      lifecycleState: 'suspended',
      role: 'editor',
      joinedAt: '2026-02-01T00:00:00.000Z',
    },
  ],
  pendingInvitations: [
    {
      id: INVITATION_ID,
      tenantId: TENANT_ID_2,
      tenantName: 'Beta Ltd',
      role: 'viewer',
      expiresAt: '2026-10-01T00:00:00.000Z',
    },
  ],
}

function serveUser(overrides: Partial<PlatformUserDetail> = {}) {
  server.use(
    http.get(`/api/v1/platform/users/${USER_ID_2}`, () =>
      ok({ ...USER_DETAIL, ...overrides }, 'User retrieved.')
    )
  )
}

describe('signed-in pages', () => {
  beforeEach(() => {
    signIn()
  })

  it.each([
    [
      'overview',
      '/overview',
      // The h1 renders before the stats land; grade the loaded widgets, not their skeletons.
      async () => {
        await screen.findByRole('region', { name: 'Key figures' })
        await screen.findByRole('figure', { name: 'Sign-ups per day' })
        await screen.findByRole('figure', { name: 'Emails per day' })
      },
    ],
    ['profile', '/profile', () => screen.findByRole('button', { name: 'Change password' })],
    [
      'invitation accept',
      `/invitations/accept?token=${TEST_INVITATION_TOKEN}`,
      () => screen.findByRole('button', { name: 'Accept invitation' }),
    ],
  ])('%s has no axe violations', async (_name, path, ready) => {
    renderAppAt(path)
    await ready()
    await expectNoViolations()
  })

  it('no-access has no axe violations', async () => {
    useAuthStore.setState({ user: { ...testUser, platformRole: null } })
    renderAppAt('/no-access')
    await screen.findByRole('heading', { name: 'This account has no platform access', level: 1 })
    await expectNoViolations()
  })

  it('the shell with the sidebar collapsed has no axe violations', async () => {
    useSidebarStore.setState({ isCollapsed: true })
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    // Not vacuous: the collapsed rail, with its hidden group labels and icon tooltips, is what this grades.
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull()
    await expectNoViolations()
  })

  it('tenants with a row in every status has no axe violations', async () => {
    const rows = (
      [
        [TENANT_ID, 'Acme Corp', 'acme', 'active'],
        [TENANT_ID_2, 'Beta Ltd', 'beta', 'suspended'],
        [TENANT_ID_3, 'Gamma Inc', 'gamma', 'archived'],
      ] as const
    ).map(([id, name, slug, lifecycleState]): PlatformTenantRow => ({
      id,
      name,
      slug,
      lifecycleState,
      memberCount: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
    }))
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: rows, nextCursor: 'next', prevCursor: null }, 'Tenants retrieved.')
      )
    )
    renderAppAt('/tenants')
    // The h1 renders before the page lands; grade the table, its badges and the pager.
    const table = await screen.findByRole('table', { name: 'Tenants' })
    expect(within(table).getByText('Archived')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
    await expectNoViolations()
  })

  it('tenants filtered to archived with the admin controls has no axe violations', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      )
    )
    renderAppAt('/tenants?state=archived')
    await screen.findByText('No tenants in this state.')
    expect(screen.getByRole('button', { name: 'New tenant' })).toBeInTheDocument()
    await expectNoViolations()
  })

  it('tenants with nothing matching has no axe violations', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      )
    )
    renderAppAt('/tenants?q=zzz')
    await screen.findByText('No tenants match “zzz”.')
    await expectNoViolations()
  })

  it('tenants denied to the role has no axe violations', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => fail('Not found', 404)))
    renderAppAt('/tenants')
    await screen.findByText(/Your role can’t see this any more/)
    await expectNoViolations()
  })

  it('activity has no axe violations', async () => {
    useAuthStore.setState({ user: { ...testUser, platformRole: 'admin' } })
    const entries: PlatformAuditEntry[] = AUDIT_ENTRIES.map((entry) => ({
      ...entry,
      tenant: { id: TENANT_ID, name: 'Acme Corp', slug: 'acme' },
    }))
    server.use(
      http.get('/api/v1/platform/audit-log', () =>
        ok({ entries, nextCursor: null }, 'Audit log retrieved.')
      ),
      http.get('/api/v1/tenants/platform/members', () => ok(MEMBERS, 'Members retrieved.'))
    )
    renderAppAt('/activity')
    await screen.findByText('changed the settings (timezone)')
    await expectNoViolations()
  })

  it.each([
    ['overview', '', () => screen.findByRole('heading', { name: 'Owners', level: 2 })],
    ['members', '/members', () => screen.findByText('Cleo D')],
    [
      'invitations',
      '/invitations',
      () => screen.findByText('No invitations are waiting to be accepted.'),
    ],
    ['activity', '/activity', () => screen.findByText('Sam Staff')],
  ])('tenant detail %s has no axe violations', async (_name, suffix, ready) => {
    serveTenant('active')
    renderAppAt(`/tenants/${TENANT_ID}${suffix}`)
    await ready()
    await expectNoViolations()
  })

  it('staff has no axe violations', async () => {
    serveStaff()
    renderAppAt('/staff')
    await screen.findByText('Cleo D')
    await screen.findByText('No invitations are waiting to be accepted.')
    await expectNoViolations()
  })

  it('users with a row in every status has no axe violations', async () => {
    const base: PlatformUserRow = { ...USER_DETAIL, email: 'a@example.com' }
    const rows: PlatformUserRow[] = [
      { ...base, id: USER_ID },
      { ...base, id: USER_ID_2, email: 'b@example.com', active: false },
      { ...base, id: STAFF_USER_ID, email: 'c@example.com', platformRole: 'viewer' },
      {
        ...base,
        id: USER_ID_3,
        email: 'd@example.com',
        deletedAt: '2026-09-20T00:00:00.000Z',
        firstName: null,
        lastName: null,
      },
    ]
    server.use(
      http.get('/api/v1/platform/users', () =>
        ok({ users: rows, nextCursor: 'next', prevCursor: null }, 'Users retrieved.')
      )
    )
    renderAppAt('/users')
    // The h1 renders before the page lands; grade the table, its badges and the pager.
    const table = await screen.findByRole('table', { name: 'Users' })
    expect(within(table).getByText('Deleted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
    await expectNoViolations()
  })

  it('users with nothing matching has no axe violations', async () => {
    server.use(
      http.get('/api/v1/platform/users', () =>
        ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      )
    )
    renderAppAt('/users?q=zzz&status=deleted')
    await screen.findByText('No users match these filters.')
    await expectNoViolations()
  })

  it.each([
    [
      'a live account',
      {},
      () => screen.findByRole('heading', { name: 'Recorded actions on this account', level: 2 }),
    ],
    [
      'a deleted account',
      { deletedAt: '2026-09-29T00:00:00.000Z', active: false },
      () => screen.findByText(/This account was deleted on/),
    ],
  ])('user detail for %s has no axe violations', async (_name, overrides, ready) => {
    serveUser(overrides)
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    await ready()
    await expectNoViolations()
  })

  it('an unknown user has no axe violations', async () => {
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)))
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'User not found', level: 1 })
    await expectNoViolations()
  })

  it('emails with a row in every status and both record filters has no axe violations', async () => {
    const rows = EMAIL_MESSAGE_STATUSES.map((status, index) =>
      emailSummary({
        id: `70000000-0000-4000-8000-${String(10 + index).padStart(12, '0')}`,
        status,
        ...(index % 2 === 0 ? {} : { user: null, tenant: null }),
      })
    )
    server.use(
      http.get('/api/v1/platform/emails', () =>
        ok({ messages: rows, nextCursor: 'next', prevCursor: null }, 'Emails retrieved.')
      )
    )
    renderAppAt(`/emails?userId=${USER_ID_2}&tenantId=${TENANT_ID}&from=2026-09-01&to=2026-09-30`)
    // The h1 renders before the page lands; grade the table, every badge, the chips and the pager.
    const table = await screen.findByRole('table', { name: 'Emails' })
    expect(within(table).getByText('Suppressed')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove filter: Tenant: Acme Corp' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
    await expectNoViolations()
  })

  it('emails with nothing matching has no axe violations', async () => {
    renderAppAt('/emails?q=zzz&status=failed')
    await screen.findByText('No emails match these filters.')
    await expectNoViolations()
  })

  it('emails denied to the role has no axe violations', async () => {
    server.use(http.get('/api/v1/platform/emails', () => fail('Not found', 404)))
    renderAppAt('/emails')
    await screen.findByText(/Your role can’t see this any more/)
    await expectNoViolations()
  })

  /** Every timeline entry kind, the suppression banner and the Resend action, all on one page. */
  const BUSY_EMAIL = emailDetail({
    status: 'bounced',
    resentFromId: EMAIL_ID_2,
    resentAsIds: [EMAIL_ID_3],
    attempts: [
      {
        id: EMAIL_ATTEMPT_ID,
        status: 'failed',
        errorCode: 'ECONNECTION',
        createdAt: '2026-09-29T10:00:01.000Z',
      },
    ],
    events: [
      {
        id: EMAIL_EVENT_ID,
        provider: 'resend',
        type: 'bounced',
        bounceKind: 'hard',
        detail: 'MESSAGE_REJECTED',
        occurredAt: '2026-09-29T10:02:00.000Z',
      },
    ],
    suppression: {
      id: SUPPRESSION_ID,
      reason: 'hard_bounce',
      createdAt: '2026-09-29T10:02:01.000Z',
    },
  })

  it('email detail on the timeline tab has no axe violations', async () => {
    server.use(
      http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () => ok(BUSY_EMAIL, 'Email retrieved.'))
    )
    renderAppAt(`/emails/${EMAIL_ID}`)
    await screen.findByRole('heading', { name: 'cleo@example.com', level: 1 })
    // Not vacuous: every entry kind is on the page, and the tab list is the first route-mounted one.
    const timeline = screen.getByRole('list', { name: 'Delivery timeline' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('tablist', { name: 'Email sections' })).toBeInTheDocument()
    await expectNoViolations()
  })

  it('email detail on the preview tab has no axe violations', async () => {
    server.use(
      http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () =>
        ok({ ...BUSY_EMAIL, suppression: null }, 'Email retrieved.')
      ),
      http.get(`/api/v1/platform/emails/${EMAIL_ID}/preview`, () =>
        ok({ ...testEmailPreview, partial: true }, 'Email preview rendered.')
      )
    )
    renderAppAt(`/emails/${EMAIL_ID}?tab=preview`)
    await screen.findByRole('heading', { name: 'cleo@example.com', level: 1 })
    await screen.findByTitle('Email preview')
    expect(screen.getByText(/placeholders stand in/)).toBeInTheDocument()
    await expectNoViolations({ frames: 'skip' })
  })

  it('an unknown email has no axe violations', async () => {
    server.use(http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () => fail('Not found', 404)))
    renderAppAt(`/emails/${EMAIL_ID}`)
    await screen.findByRole('heading', { name: 'Email not found', level: 1 })
    await expectNoViolations()
  })

  it('a suspended tenant’s frozen tab has no axe violations', async () => {
    serveTenant('suspended')
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    await screen.findByText(/This tenant is suspended/)
    await expectNoViolations()
  })
})

/**
 * The accept page's other states, each one its own render: a default sweep
 * only ever sees the invited account arriving at a valid link.
 */
describe('invitation accept states', () => {
  const acceptPath = `/invitations/accept?token=${TEST_INVITATION_TOKEN}`

  beforeEach(() => {
    signIn()
  })

  it('has no violations signed in as the wrong account', async () => {
    server.use(
      http.post('/api/v1/invitations/preview', () =>
        ok(
          {
            tenant: { name: 'Acme Corp', slug: 'acme' },
            role: 'editor',
            invitedBy: { firstName: 'Ada', lastName: 'Lovelace' },
            email: 'someone@else.com',
          },
          'Invitation retrieved.'
        )
      )
    )
    renderAppAt(acceptPath)
    await screen.findByRole('button', { name: 'Sign out' })
    await expectNoViolations()
  })

  it('has no violations for an invalid invitation', async () => {
    server.use(
      http.post('/api/v1/invitations/preview', () =>
        fail('This invitation is invalid or has expired.', 404, 'invitation_invalid')
      )
    )
    renderAppAt(acceptPath)
    await screen.findByRole('heading', { name: 'This invitation can’t be used' })
    await expectNoViolations()
  })

  it('has no violations when the preview request failed', async () => {
    server.use(http.post('/api/v1/invitations/preview', () => fail('Something went wrong.', 500)))
    renderAppAt(acceptPath)
    // The preview retries a non-404 once, so the failure takes a moment.
    await screen.findByRole('alert')
    await expectNoViolations()
  })

  it('has no violations with the unverified-email refusal showing', async () => {
    server.use(
      http.post('/api/v1/invitations/accept', () =>
        fail(
          'Verify your email address before accepting this invitation.',
          403,
          'invitation_email_unverified'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(acceptPath)
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    await screen.findByRole('alert')
    await expectNoViolations()
  })
})

/**
 * The two states a default-state sweep can never see.
 *
 * A Base UI `Dialog` with no `Title` gets `aria-labelledby: null` and — unlike
 * Radix — emits NO development warning about it. The failure is invisible until
 * axe looks at the dialog while it is OPEN, which is why these drive one open
 * rather than trusting the closed markup.
 */
describe('open overlays', () => {
  it('has no violations with the New tenant dialog open', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')
    await screen.findByText('No tenants yet.')
    await user.click(screen.getByRole('button', { name: 'New tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
    expect(within(dialog).getByLabelText('Owner email')).toBeInTheDocument()
    await expectNoViolations()
  })

  beforeEach(() => {
    signIn()
  })

  it('has no violations with the mobile sidebar sheet open, and the sheet is named', async () => {
    setViewportWidth(500)
    const user = userEvent.setup()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))

    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveAccessibleName('Sidebar')
    await expectNoViolations()
  })

  /**
   * Every menu that exists is opened here: a composition error inside a
   * menu (Base UI's `Menu.GroupLabel` throws outside a `Menu.Group`) is
   * otherwise invisible until that menu is actually opened.
   */
  it.each([['the user menu', /^Account menu for/]])(
    'has no violations with %s menu open',
    async (_label, name) => {
      const user = userEvent.setup()
      renderAppAt('/overview')
      await screen.findByRole('heading', { name: 'Overview', level: 1 })

      await user.click(screen.getByRole('button', { name }))

      // Finding the menu is what makes this a real check: a trigger that fails to open asserts nothing, and axe over a closed menu is axe over no menu.
      const menu = await screen.findByRole('menu')
      // Not vacuous: a menu that opened empty would pass axe while asserting nothing about the items this block exists to grade.
      expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
      await expectNoViolationsIn(menu)
    }
  )

  /**
   * A combobox whose search box lives inside
   * the popup, so Base UI makes the popup a named `dialog` and the portaled
   * list is not page content outside every landmark. Graded at DOCUMENT scope.
   */
  it('has no violations with the activity tenant filter open', async () => {
    useAuthStore.setState({ user: { ...testUser, platformRole: 'admin' } })
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok(
          {
            tenants: [
              {
                id: TENANT_ID,
                name: 'Acme Corp',
                slug: 'acme',
                lifecycleState: 'active',
                memberCount: 2,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
          'Tenants retrieved.'
        )
      ),
      http.get('/api/v1/tenants/platform/members', () => ok(MEMBERS, 'Members retrieved.'))
    )
    const user = userEvent.setup()
    renderAppAt('/activity')
    await screen.findByRole('heading', { name: 'Activity', level: 1 })

    const trigger = screen.getByRole('combobox', { name: /filter by tenant/i })
    await user.click(trigger)

    // A popup that opened empty would pass axe while grading no list at all.
    expect(await screen.findByRole('option', { name: 'Acme Corp' })).toBeInTheDocument()
    // Enforces in code what the KNOWN_INCOMPLETE comment claims: the trigger's and the input's `aria-controls` both name a real element on the page, which is exactly why their `aria-valid-attr-value` finding is axe declining to fully resolve a reference rather than a broken one.
    const input = screen.getByLabelText('Search tenants')
    for (const element of [trigger, input]) {
      const controls = element.getAttribute('aria-controls')
      expect(controls).not.toBeNull()
      expect(document.getElementById(controls as string)).not.toBeNull()
    }
    await expectNoViolations()
    const popup = screen.getByRole('dialog', { name: 'Filter by tenant' })
    expect(within(popup).getByRole('listbox')).toBeInTheDocument()
  })

  /**
   * The ⌘K palette as the shell mounts it: a named `dialog`, so its portaled
   * list is exempt from `region` and it is graded at DOCUMENT scope.
   */
  it('has no violations with the command palette open', async () => {
    const user = userEvent.setup()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await user.click(screen.getByRole('button', { name: /Search…/ }))

    const palette = await screen.findByRole('dialog', { name: 'Command palette' })
    // A palette that opened empty would pass axe while grading no list at all.
    expect(within(palette).getAllByRole('option').length).toBeGreaterThan(0)
    await expectNoViolations()
  })

  it('has no violations with the command palette showing a user', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      ),
      http.get('/api/v1/platform/users', () =>
        ok({ users: [USER_DETAIL], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await user.click(screen.getByRole('button', { name: /Search…/ }))
    const palette = await screen.findByRole('dialog', { name: 'Command palette' })
    await user.keyboard('cleo')

    // The user group is what this grades: a palette without the row would repeat the test above.
    expect(
      await within(palette).findByRole('option', { name: /cleo@example\.com/ })
    ).toBeInTheDocument()
    await expectNoViolations()
  })

  /** The calendar popover: a named `dialog`, so it is graded at DOCUMENT scope like the palette. */
  it('has no violations with the emails date filter open', async () => {
    const user = userEvent.setup()
    renderAppAt('/emails?from=2026-09-01&to=2026-09-10')
    await screen.findByText('No emails match these filters.')
    await user.click(screen.getByRole('button', { name: /^Filter by date/ }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by date' })
    // A calendar that rendered no grid would pass axe while grading nothing.
    expect(within(popup).getByRole('grid')).toBeInTheDocument()
    expect(within(popup).getByRole('button', { name: 'Clear dates' })).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the Resend dialog open', async () => {
    const user = userEvent.setup()
    renderAppAt(`/emails/${EMAIL_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Resend' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend this email?' })
    expect(within(dialog).getByText('Sends the invitation again.')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the tenant actions menu open', async () => {
    serveTenant('active')
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })

  it('has no violations with the suspend reason dialog open', async () => {
    serveTenant('active')
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Suspend Acme Corp?' })
    expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the remove-staff dialog open', async () => {
    serveStaff()
    const user = userEvent.setup()
    renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Cleo D?' })
    expect(within(dialog).getByRole('link', { name: 'Open Cleo D in Users' })).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the leave dialog open', async () => {
    // Leave is an owner's own action, offered only while another owner remains.
    serveTenant('active')
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(
          { ...ACME_DETAIL, isPlatform: false, role: 'owner', access: 'member' },
          'Tenant retrieved.'
        )
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(
          MEMBERS.map((member) => ({
            ...member,
            membership: { ...member.membership, role: 'owner' },
          })),
          'Members retrieved.'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    expect(within(dialog).getByRole('button', { name: 'Leave' })).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the revoke-invitation dialog open', async () => {
    serveTenant('active')
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok([testInvitation], 'Invitations retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)
    await user.click(
      await screen.findByRole('button', { name: `Revoke invitation to ${testInvitation.email}` })
    )
    await screen.findByRole('alertdialog', {
      name: `Revoke the invitation to ${testInvitation.email}?`,
    })
    await expectNoViolations()
  })

  it('has no violations with the step-up dialog open', async () => {
    serveTenant('active')
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/suspend`, () =>
        fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend' }))
    const reason = await screen.findByRole('alertdialog', { name: 'Suspend Acme Corp?' })
    await user.type(within(reason).getByLabelText('Reason'), 'x')
    await user.click(within(reason).getByRole('button', { name: 'Suspend' }))
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    expect(await within(stepUp).findByLabelText('Password')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the Edit details dialog open', async () => {
    serveTenant('active')
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit details' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit details' })
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the Owner invitation dialog open', async () => {
    server.use(
      http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
        ok({ ...ACME_DETAIL, owners: [] }, 'Tenant retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Resend owner invitation' }))
    const dialog = await screen.findByRole('dialog', { name: 'Owner invitation' })
    expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the New user dialog open', async () => {
    server.use(
      http.get('/api/v1/platform/users', () =>
        ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/users')
    await user.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog', { name: 'New user' })
    expect(within(dialog).getByLabelText('Email')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the user actions menu open', async () => {
    serveUser()
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    await user.click(await screen.findByRole('button', { name: 'Actions for cleo@example.com' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })

  it('has no violations with the Delete user dialog open, typed confirmation included', async () => {
    serveUser()
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    await user.click(await screen.findByRole('button', { name: 'Actions for cleo@example.com' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete user' })
    expect(within(dialog).getByLabelText('Type cleo@example.com to confirm')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the Deactivate account dialog open', async () => {
    serveUser()
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    await user.click(await screen.findByRole('button', { name: 'Actions for cleo@example.com' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate account' })
    expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the permanent-delete dialog open on a deleted account', async () => {
    useAuthStore.setState({ user: { ...testUser, platformRole: 'owner' } })
    serveUser({ deletedAt: '2026-09-29T00:00:00.000Z', active: false })
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    await user.click(await screen.findByRole('button', { name: 'Actions for cleo@example.com' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Permanently delete this account?',
    })
    expect(within(dialog).getByLabelText('Type cleo@example.com to confirm')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the step-up dialog open for an account without a password', async () => {
    serveTenant('active')
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/suspend`, () =>
        fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
      ),
      http.get('/api/v1/auth/providers', () =>
        ok(
          {
            providers: [{ provider: 'google', linkedAt: '2026-01-01T00:00:00.000Z' }],
            hasPassword: false,
          },
          'Auth providers retrieved.'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend' }))
    const reason = await screen.findByRole('alertdialog', { name: 'Suspend Acme Corp?' })
    await user.type(within(reason).getByLabelText('Reason'), 'x')
    await user.click(within(reason).getByRole('button', { name: 'Suspend' }))
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    expect(
      await within(stepUp).findByRole('link', { name: 'Open your user page' })
    ).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the Edit name dialog open', async () => {
    serveUser()
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    await user.click(await screen.findByRole('button', { name: 'Actions for cleo@example.com' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit name' })
    expect(within(dialog).getByLabelText('First name')).toHaveValue('Cleo')
    await expectNoViolations()
  })

  it('has no violations with the theme menu open inside the mobile sheet', async () => {
    // ThemeToggle is not in the desktop shell - the mobile sheet is where it renders, so that is where it has to be opened.
    setViewportWidth(500)
    const user = userEvent.setup()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    await screen.findByRole('dialog')
    await user.click(await screen.findByRole('button', { name: /Change theme/ }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await expectNoViolationsIn(menu)
  })
})

/**
 * What axe cannot see: whether a focusable thing shows that it has focus.
 * axe has no layout and no cascade, so a removed outline with nothing in its
 * place is invisible to it. This is a class-level assertion for exactly that.
 */
describe('focus indicators', () => {
  /**
   * `Tabs` is rendered directly here, apart from the email detail and
   * onboarding pages that mount it, so the primitive's own contract is
   * checked whatever a page passes it.
   *
   * Base UI renders `Tabs.Panel` with `tabIndex: open ? 0 : -1`
   * (@base-ui/react@1.8.0, tabs/panel/TabsPanel.js:76), so an open panel is
   * reachable by keyboard. Suppressing its outline with nothing in its place
   * is a WCAG 2.4.7 failure.
   */
  it('gives the tab panel a visible focus ring, because Base UI makes it tabbable', () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Panel body</TabsContent>
      </Tabs>
    )

    const panel = screen.getByRole('tabpanel')

    expect(panel).toHaveAttribute('tabindex', '0')
    expect(panel.className).toMatch(/focus-visible:/)
  })
})

/**
 * What axe cannot see: the order focus actually moves in, and where it lands
 * when an overlay closes.
 */
describe('keyboard', () => {
  it('tabs through the login form in the order the page reads', async () => {
    signOut()
    const user = userEvent.setup()
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })

    const expected = [
      // Every layout's first Tab stop.
      screen.getByRole('link', { name: 'Skip to content' }),
      screen.getByLabelText('Email'),
      screen.getByLabelText('Password'),
      screen.getByRole('button', { name: 'Sign in' }),
      // A plain anchor to a same-origin API route, not a button with a click handler — so it is in the tab order for free.
      screen.getByRole('link', { name: 'Continue with Google' }),
      screen.getByRole('link', { name: 'Forgot password?' }),
    ]
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      GOOGLE_OAUTH_PATH
    )

    for (const element of expected) {
      await user.tab()
      expect(document.activeElement).toBe(element)
    }
  })

  it('returns focus to the theme trigger when the menu is closed with Escape', async () => {
    useThemeStore.setState({ theme: 'system' })
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const trigger = screen.getByRole('button', { name: 'Theme: system. Change theme' })
    // Opened from the keyboard, not by a click: the restoration this checks is only observable for a keyboard user.
    await user.tab()
    expect(document.activeElement).toBe(trigger)
    await user.keyboard('{Enter}')
    await screen.findByRole('menuitem', { name: 'Dark' })

    await user.keyboard('{Escape}')

    // Base UI restores focus asynchronously, after the popup unmounts.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })
})

/**
 * Deliverability, Suppressions (with the lift dialog), a tenant's Emails tab
 * and a user's Emails card. Each waits for its loaded content, never a
 * skeleton. The Emails list and an email's page are graded above.
 */
describe('deliverability, suppressions and the embedded email lists', () => {
  beforeEach(() => {
    signIn()
  })

  /** One row per status, so every badge tone is graded. */
  const EVERY_STATUS: EmailMessageSummary[] = EMAIL_MESSAGE_STATUSES.map((status, index) =>
    emailSummary({
      id: `70000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
      recipient: `r${index}@example.com`,
      status,
    })
  )

  function serveEmails(rows: EmailMessageSummary[]) {
    server.use(
      http.get('/api/v1/platform/emails', () =>
        ok({ messages: rows, nextCursor: 'next', prevCursor: null }, 'Emails retrieved.')
      )
    )
  }

  it('deliverability with provider data has no axe violations', async () => {
    renderAppAt('/deliverability')
    await screen.findByRole('region', { name: 'Deliverability figures' })
    await screen.findByRole('figure', { name: 'Emails per day' })
    await screen.findByRole('table', { name: 'By template' })
    await expectNoViolations()
  })

  it('deliverability before any provider event has no axe violations', async () => {
    const unknown = { value: null, numerator: 0, denominator: 0 }
    server.use(
      http.get('/api/v1/platform/emails/health', () =>
        ok(
          {
            ...testEmailHealth,
            totals: { ...testEmailHealth.totals, delivered: 0, complained: 0, providerEvents: 0 },
            rates: {
              ...testEmailHealth.rates,
              deliveredRate: unknown,
              bounceRate: unknown,
              complaintRate: unknown,
              openRate: unknown,
              clickRate: unknown,
            },
          },
          'Email health retrieved.'
        )
      )
    )
    renderAppAt('/deliverability')
    await screen.findByRole('note')
    expect(screen.getAllByText('No provider data')).toHaveLength(5)
    await expectNoViolations()
  })

  const SUPPRESSIONS: EmailSuppression[] = [
    emailSuppression({ id: SUPPRESSION_ID }),
    emailSuppression({
      id: SUPPRESSION_ID_2,
      address: 'complained@example.com',
      reason: 'complaint',
      sourceMessageId: null,
      liftedAt: '2026-09-29T09:00:00.000Z',
      liftedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
      liftReason: 'Asked to be mailed again',
    }),
  ]

  function serveSuppressions(rows: EmailSuppression[]) {
    server.use(
      http.get('/api/v1/platform/email-suppressions', () =>
        ok({ suppressions: rows, nextCursor: null, prevCursor: 'p' }, 'Suppressions retrieved.')
      )
    )
  }

  it('suppressions, active and lifted, with the Lift controls has no axe violations', async () => {
    serveSuppressions(SUPPRESSIONS)
    renderAppAt('/suppressions?state=all')
    const table = await screen.findByRole('table', { name: 'Suppressions' })
    expect(
      within(table).getByRole('button', { name: /^Lift suppression for / })
    ).toBeInTheDocument()
    expect(within(table).getByText(/^Lifted .+ by Sam Staff$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
    await expectNoViolations()
  })

  it('suppressions with none active has no axe violations', async () => {
    renderAppAt('/suppressions')
    await screen.findByText('No suppressed addresses.')
    await expectNoViolations()
  })

  it('the lift dialog has no axe violations', async () => {
    serveSuppressions(SUPPRESSIONS)
    const user = userEvent.setup()
    renderAppAt('/suppressions')
    await user.click(await screen.findByRole('button', { name: /^Lift suppression for / }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Lift this suppression?' })
    expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('a tenant’s Emails tab has no axe violations', async () => {
    serveTenant('active')
    serveEmails(EVERY_STATUS.slice(0, 3))
    renderAppAt(`/tenants/${TENANT_ID}/emails`)
    await screen.findByRole('table', { name: 'Emails' })
    await expectNoViolations()
  })

  it('a user’s page with its Emails card listing emails has no axe violations', async () => {
    serveUser()
    serveEmails(EVERY_STATUS.slice(0, 4))
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Emails' })
    expect(await within(card).findAllByRole('listitem')).toHaveLength(4)
    await expectNoViolations()
  })
})

/**
 * The onboarding page on every tab, with rows, its empty states, and a
 * tenant's Onboarding tab in each state that renders differently, with both
 * reason dialogs and the member disclosure open. Each waits for its loaded
 * content, never a skeleton.
 */
describe('onboarding', () => {
  beforeEach(() => {
    signIn()
  })

  it.each(ONBOARDING_LIST_STATES)(
    'onboarding on the %s tab has no axe violations',
    async (state) => {
      server.use(
        http.get('/api/v1/platform/onboarding/tenants', () =>
          ok(
            {
              tenants: [
                onboardingTenantRow({
                  state,
                  daysStuck: state === 'stuck' ? 9 : null,
                  startedAt: state === 'awaiting_owner' ? null : '2026-09-10T09:00:00.000Z',
                }),
              ],
              nextCursor: 'n1',
              prevCursor: null,
            },
            'Onboarding tenants retrieved.'
          )
        )
      )
      renderAppAt(`/onboarding?state=${state}`)
      await screen.findByRole('region', { name: 'Onboarding figures' })
      await screen.findByRole('figure', { name: 'Onboarding funnel' })
      await screen.findByRole('table', { name: 'Onboarding tenants' })
      expect(screen.getByRole('tablist', { name: 'Onboarding states' })).toBeInTheDocument()
      await expectNoViolations()
    }
  )

  it('onboarding with an empty tab has no axe violations', async () => {
    renderAppAt('/onboarding')
    await screen.findByRole('figure', { name: 'Onboarding funnel' })
    await screen.findByText('No tenant is stuck.')
    await expectNoViolations()
  })

  it('onboarding before any tenant is tracked has no axe violations', async () => {
    server.use(
      http.get('/api/v1/platform/onboarding/funnel', () =>
        ok(
          {
            ...testOnboardingFunnel,
            trackedTenants: 0,
            totals: { started: 0, inProgress: 0, stuck: 0, complete: 0, dismissed: 0 },
            completionRate: null,
          },
          'Onboarding funnel retrieved.'
        )
      )
    )
    renderAppAt('/onboarding')
    await screen.findByText('Onboarding tracking starts with tenants created after this release.')
    await expectNoViolations()
  })

  /** Acme's platform detail with the tab's own read, in `onboarding`'s state. */
  function serveOnboarding(onboarding: Parameters<typeof tenantOnboardingDetail>[0] = {}) {
    serveTenant(onboarding.tenant?.lifecycleState ?? 'active')
    server.use(
      http.get(`/api/v1/platform/tenants/${TENANT_ID}/onboarding`, () =>
        ok(tenantOnboardingDetail(onboarding), 'Tenant onboarding retrieved.')
      )
    )
  }

  it('a tenant’s Onboarding tab with every completion kind and its reminders has no axe violations', async () => {
    serveOnboarding({
      state: 'stuck',
      daysStuck: 9,
      steps: tenantOnboardingAfterStaffCompletion('teammate_joined').steps,
      reminders: [onboardingReminder(), onboardingReminder({ id: AUDIT_ID_2, sentBy: null })],
    })
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/onboarding`)
    await screen.findByRole('list', { name: 'Onboarding steps' })
    await screen.findByRole('list', { name: 'Reminders sent' })
    // Not vacuous: the disclosure is open, so the members' own statuses are graded too.
    await user.click(screen.getByText('1 of 2 members'))
    expect(screen.getByText('Evan Editor')).toBeVisible()
    await expectNoViolations()
  })

  it.each([
    [
      'not tracked',
      { state: 'not_tracked' as const },
      'Not tracked — created before onboarding tracking.',
    ],
    [
      'awaiting its owner',
      { state: 'awaiting_owner' as const, startedAt: null, lastProgressAt: null },
      'Waiting for the owner to accept their invitation.',
    ],
    [
      'suspended',
      {
        tenant: {
          id: TENANT_ID,
          name: 'Acme Corp',
          slug: 'acme',
          lifecycleState: 'suspended' as const,
        },
        reminder: {
          ...tenantOnboardingDetail().reminder,
          canSend: false,
          blockedBy: 'tenant_state_conflict' as const,
        },
      },
      'This tenant is suspended: its onboarding is read-only.',
    ],
  ])('a tenant’s Onboarding tab %s has no axe violations', async (_name, onboarding, text) => {
    serveOnboarding(onboarding)
    renderAppAt(`/tenants/${TENANT_ID}/onboarding`)
    await screen.findByText(text)
    await expectNoViolations()
  })

  it('has no violations with the Mark complete dialog open', async () => {
    serveOnboarding()
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/onboarding`)
    await user.click(
      await screen.findByRole('button', { name: 'Mark complete: Invite a teammate' })
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Mark “Invite a teammate” complete?',
    })
    expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('has no violations with the reminder dialog open', async () => {
    serveOnboarding()
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/onboarding`)
    await user.click(await screen.findByRole('button', { name: 'Send reminder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send an onboarding reminder?' })
    expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument()
    await expectNoViolations()
  })
})
