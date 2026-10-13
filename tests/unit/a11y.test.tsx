/**
 * @file The accessibility gate: axe-core over the whole `document` for every routed page and the open
 * overlays, rendered through a real `RouterProvider` on a memory history. Pages call `Route.useSearch()`,
 * `useNavigate()` and `useMatches()`, and the app shell holds the landmarks, breadcrumbs and nav, so a page
 * rendered alone would grade a fragment nobody sees. A rule that trips is fixed in the markup; only colour
 * contrast is off, which jsdom cannot compute and `pnpm test:contrast` checks in a browser.
 */
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
import { byContent } from '@/tests/fixtures/content'
import { errorIssue, errorsPage, issueId } from '@/tests/fixtures/errors'
import { flagsEvaluation, flagsList } from '@/tests/fixtures/flags'
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
import {
  fullMaintenanceView,
  maintenanceModeView,
  maintenanceStatus,
  PAUSED_QUEUES,
} from '@/tests/fixtures/maintenance-mode'
import { renderAppAt } from '@/tests/fixtures/render-app'
import {
  at,
  eventId,
  SESSION_ID_2,
  timelinePage,
  timelineRow,
  TRACE_ID,
} from '@/tests/fixtures/timeline'
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
  testSystemStatus,
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
    user: { id: USER_ID, email: 'a.b@example.com', firstName: 'A', lastName: 'B' },
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
    user: { id: USER_ID_2, email: 'cleo.d@example.com', firstName: 'Cleo', lastName: 'D' },
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
    actor: { id: USER_ID, name: 'A B', email: 'a.b@example.com' },
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
  owners: [
    {
      userId: USER_ID_2,
      email: 'cleo.d@example.com',
      firstName: 'Cleo',
      lastName: 'D',
      active: true,
    },
  ],
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
 * jest-axe's default rule set: every `cat.color` rule off, because contrast needs a layout and a
 * cascade that jsdom lacks. axe-core runs directly because jest-axe's `axe()` takes only an element
 * or an HTML string, so it cannot take `document`. A green run therefore says nothing about contrast.
 */
const AXE_OPTIONS: axeCore.RunOptions = {
  rules: Object.fromEntries(
    axeCore.getRules(['cat.color']).map(({ ruleId }) => [ruleId, { enabled: false }])
  ),
}

/**
 * The rules axe files under `incomplete` for reasons that belong to jsdom, not to the markup. Pinned as
 * a set so another cannot appear unnoticed: `toHaveNoViolations` reads only `violations`, so a rule
 * that quietly stops being evaluable would otherwise look like a pass.
 *
 * - `page-has-heading-one`, `landmark-one-main`: axe's modal check (`isModalOpen`) calls
 *   `document.elementsFromPoint`, which axe polyfills over `document.elementFromPoint`; jsdom
 *   implements neither, so the check throws and axe files both rules under `incomplete`.
 *   `expectNoViolations` asserts them by hand.
 * - `heading-order`: "Unable to determine previous heading" for the first heading in the tree.
 * - `aria-hidden-focus`: Base UI marks the background `aria-hidden` and inert while a modal is open;
 *   whether its contents are still tabbable is a layout question jsdom cannot answer.
 * - `aria-valid-attr-value`: axe's `controlsWithinPopup` check cannot tell whether an `aria-controls`
 *   target exists while `aria-haspopup` is set. The combobox trigger and input both carry that pair, and
 *   the "activity tenant filter open" test asserts both targets exist. The rule is not accepted
 *   outright: `isOnlyControlsWithinPopup` still fails a genuinely dangling reference.
 */
const KNOWN_INCOMPLETE = new Set([
  'page-has-heading-one',
  'landmark-one-main',
  'heading-order',
  'aria-hidden-focus',
  'aria-valid-attr-value',
])

/**
 * Whether every check on every flagged node of an `aria-valid-attr-value` result is
 * `controlsWithinPopup`. axe files the same rule id for a genuinely dangling
 * `aria-describedby`/`aria-labelledby` (`messageKey: 'noId'`) or an invalid value such as
 * `aria-current="bogus"`, so accepting the id outright would swallow those too.
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
 * The ids in `results.incomplete` that `KNOWN_INCOMPLETE` does not explain.
 * @returns The unexplained rule ids; empty when the run is fully accounted for.
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
 * Asserts the whole document is clean, portals, landmarks and page-level rules included, and then
 * asserts by hand the exactly-one-`<main>` and exactly-one-`<h1>` invariants that axe skips under jsdom.
 *
 * The context is `document` because axe's page-level rules (`page-has-heading-one`, `landmark-one-main`,
 * `bypass`, `html-has-lang`, `document-title`) select on `html` and are inapplicable for anything
 * smaller; with `document.body` as the context they all came back inapplicable. The assertion that
 * `html-has-lang`, `document-title` and `bypass` ran pins that, since narrowing the context would
 * otherwise leave every other check passing. `region` stays on: it exempts a `button` but not an `a`, so the sidebar footer's buttons pass and the brand link passes only because it sits inside the `header` banner.
 *
 * `frames: 'skip'` is for a page holding an iframe: axe hands each frame its own run over `postMessage`,
 * which a jsdom frame cannot answer (axe throws "Respondable target must be a frame in the current
 * window"). The frame element, its `title` included, is still graded; the document inside it is not, and
 * axe files exactly that as `frame-tested`, one node per frame, under `incomplete`.
 * @param options - `frames`: `'skip'` for a page holding an iframe.
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

  // Stands in for `page-has-heading-one` and `landmark-one-main`, which axe skips here.
  expect(document.querySelectorAll('main')).toHaveLength(1)
  expect(document.querySelectorAll('h1')).toHaveLength(1)
}

/**
 * The same rule set as `expectNoViolations`, run against one open overlay instead of the document.
 *
 * Base UI portals a menu popup to `document.body`, so at document scope axe's `region` rule reports
 * content outside landmarks for every open menu. That is a page-structure rule and does not describe a
 * barrier in a transient popup that focus has just moved into; dialogs and sheets avoid it only because
 * axe exempts `role="dialog"`. No rule is disabled: narrowing the context leaves the menu's own markup
 * (`menuitem` roles, accessible names, aria wiring) to be graded, and pages stay graded at document scope.
 *
 * `aria-required-children` only produces a result when axe evaluated a `role="menu"`, so asserting it ran
 * stops the helper passing vacuously if the context points at something that is not the popup.
 */
async function expectNoViolationsIn(element: HTMLElement) {
  const results = await axeCore.run(element, AXE_OPTIONS)
  expect(results).toHaveNoViolations()

  expect(results.passes.map((result) => result.id)).toContain('aria-required-children')

  expect(unexpectedIncomplete(results)).toEqual([])
}

/**
 * Picks the viewport `useIsMobile` reports. The `matchMedia` stub in `tests/setup.ts` answers a
 * `max-width` query from `window.innerWidth`, and no change event is needed because each test sets the
 * width before rendering.
 * @param width - The viewport width in pixels.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

const realInnerWidth = window.innerWidth

// jsdom's blank document has no `lang` or `<title>`, which index.html ships; keep these two in step with it.

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
   * A stray `<p>` outside every landmark is what `region` reports. If this stops failing, the rule set has
   * stopped running and every other test here is vacuous; it checks that `region` fired, not merely that
   * something failed.
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
   * The same proof for `unexpectedIncomplete`: `aria-valid-attr-value` is accepted only for
   * `controlsWithinPopup`, so a dangling reference (the `noId` messageKey) must still come back as
   * unexpected. If this stops failing, a broken `aria-describedby` could go unnoticed on any page.
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

/** Each routed page in its settled state, not its skeleton: every entry waits on something only the loaded page renders. */
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

/** Answers the user detail read for `USER_ID_2` with `USER_DETAIL`, `overrides` applied. */
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
        await screen.findByText(testSystemStatus.release)
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

  /** A session holding a two-event request, a staff action outside it, and a second session. */
  const TIMELINE_ROWS = [
    timelineRow({
      uuid: eventId(1),
      event: '$autocapture',
      timestamp: at(50),
      elementText: 'Save',
      actor: { id: USER_ID_2, displayName: 'Cleo Doe' },
    }),
    timelineRow({
      uuid: eventId(2),
      event: 'user_signed_in',
      timestamp: at(40),
      verified: true,
      source: 'product',
      app: 'api',
      traceId: TRACE_ID,
      path: null,
      props: { method: 'google' },
      actor: { id: USER_ID_2, displayName: 'Cleo Doe' },
    }),
    timelineRow({
      uuid: eventId(3),
      event: 'auth_reauthenticated',
      timestamp: at(39),
      verified: true,
      source: 'audit',
      app: 'api',
      traceId: TRACE_ID,
      path: null,
      actor: { id: USER_ID_2, displayName: 'Cleo Doe' },
    }),
    timelineRow({
      uuid: eventId(4),
      event: 'user_deactivated',
      timestamp: at(30),
      distinctId: STAFF_USER_ID,
      verified: true,
      source: 'audit',
      access: 'platform',
      app: 'api',
      sessionId: null,
      path: null,
      actor: { id: STAFF_USER_ID, displayName: null },
    }),
    timelineRow({ uuid: eventId(5), timestamp: at(20), sessionId: SESSION_ID_2, app: 'apex' }),
  ]

  it.each([
    [
      'a user’s timeline',
      `/users/${USER_ID_2}/timeline`,
      `/api/v1/platform/users/${USER_ID_2}/timeline`,
    ],
    [
      'a tenant’s timeline',
      `/tenants/${TENANT_ID}/timeline`,
      `/api/v1/platform/tenants/${TENANT_ID}/timeline`,
    ],
  ])(
    '%s with sessions, a request and a staff action has no axe violations',
    async (_name, path, api) => {
      serveUser()
      serveTenant('active')
      server.use(
        http.get(api, () => ok(timelinePage(TIMELINE_ROWS, 'next'), 'Timeline retrieved.'))
      )
      const user = userEvent.setup()
      renderAppAt(path)
      await user.click(await screen.findByRole('button', { name: '+1 related' }))
      expect(screen.getByRole('button', { name: 'Load more events' })).toBeInTheDocument()
      await expectNoViolations()
    }
  )

  it.each([
    [
      'not set up',
      () => ok({ configured: false }, 'Timeline retrieved.'),
      () => screen.findByText('PostHog timelines are not set up for this environment.'),
    ],
    [
      'empty',
      () => ok(timelinePage([]), 'Timeline retrieved.'),
      () => screen.findByText('No events in the last 7 days.'),
    ],
    [
      'unreachable',
      () => fail('PostHog unavailable', 502, 'TIMELINE_UNAVAILABLE'),
      () => screen.findByRole('button', { name: 'Try again' }),
    ],
  ])('a user’s timeline that is %s has no axe violations', async (_name, answer, ready) => {
    serveUser()
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}/timeline`, answer))
    renderAppAt(`/users/${USER_ID_2}/timeline`)
    await ready()
    await expectNoViolations()
  })

  /** A browser crash, a signed server error, and a server row express did not sign. */
  const ERROR_ISSUES = [
    errorIssue(),
    errorIssue({ issueId: issueId(2), source: 'server', app: 'api', verified: true }),
    errorIssue({ issueId: issueId(3), source: 'server', app: 'api', verified: false }),
  ]

  it.each([
    ['a user’s errors', `/users/${USER_ID_2}/errors`, `/api/v1/platform/users/${USER_ID_2}/errors`],
    [
      'a tenant’s errors',
      `/tenants/${TENANT_ID}/errors`,
      `/api/v1/platform/tenants/${TENANT_ID}/errors`,
    ],
  ])('%s with every badge has no axe violations', async (_name, path, api) => {
    serveUser()
    serveTenant('active')
    server.use(http.get(api, () => ok(errorsPage(ERROR_ISSUES), 'Errors retrieved.')))
    renderAppAt(path)
    await screen.findByRole('table', { name: 'Errors' })
    await expectNoViolations()
  })

  it.each([
    [
      'not set up',
      () => ok({ configured: false }, 'Errors retrieved.'),
      () => screen.findByText('PostHog error tracking is not set up for this environment.'),
    ],
    [
      'empty',
      () => ok(errorsPage([]), 'Errors retrieved.'),
      () => screen.findByText('No errors in the last 30 days.'),
    ],
    [
      'unreachable',
      () => fail('PostHog unavailable', 502, 'TIMELINE_UNAVAILABLE'),
      () => screen.findByRole('button', { name: 'Try again' }),
    ],
  ])('a user’s errors that are %s have no axe violations', async (_name, answer, ready) => {
    serveUser()
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}/errors`, answer))
    renderAppAt(`/users/${USER_ID_2}/errors`)
    await ready()
    await expectNoViolations()
  })

  it('the flags page with every table, the traits and an evaluation has no axe violations', async () => {
    serveUser()
    server.use(
      http.get('/api/v1/platform/flags', () => ok(flagsList(), 'Flags retrieved.')),
      http.get('/api/v1/platform/flags/evaluate', () => ok(flagsEvaluation(), 'Flags evaluated.'))
    )
    renderAppAt(`/flags?userId=${USER_ID_2}`)
    await screen.findByRole('table', { name: 'Evaluation' })
    await screen.findByRole('table', { name: 'Unregistered flags' })
    await expectNoViolations()
  })

  it('the flags page when flags are not set up has no axe violations', async () => {
    server.use(
      http.get('/api/v1/platform/flags', () =>
        ok(
          flagsList({
            unregistered: [],
            snapshot: { enabled: false, fetchedAt: null, stale: false },
          }),
          'Flags retrieved.'
        )
      )
    )
    renderAppAt('/flags')
    await screen.findByText(
      'Feature flags are not set up for this environment, so every flag serves its fallback.'
    )
    await screen.findByRole('searchbox', { name: 'Find a user' })
    await expectNoViolations()
  })

  it('a tenant’s flags with a member picked has no axe violations', async () => {
    serveTenant('active')
    server.use(
      http.get('/api/v1/platform/flags', () => ok(flagsList(), 'Flags retrieved.')),
      http.get('/api/v1/platform/flags/evaluate', () => ok(flagsEvaluation(), 'Flags evaluated.'))
    )
    renderAppAt(`/tenants/${TENANT_ID}/flags?userId=${USER_ID}`)
    await screen.findByRole('table', { name: 'Evaluation' })
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

/** The accept page's other states, each its own render, because a default sweep only sees the invited account arriving at a valid link. */
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
            email: 'someone-else@example.com',
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
    // The preview query retries a non-404 once, so the alert appears after the retry.
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
 * Open overlays, a state a default sweep never sees. A Base UI `Dialog` with no `Title` gets
 * `aria-labelledby: null` and, unlike Radix, emits no development warning, so the failure is invisible
 * until axe looks at the dialog while it is open.
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

  /** Every menu is opened, because a composition error inside one (Base UI's `Menu.GroupLabel` throws outside a `Menu.Group`) only shows on open. */
  it.each([['the user menu', /^Account menu for/]])(
    'has no violations with %s menu open',
    async (_label, name) => {
      const user = userEvent.setup()
      renderAppAt('/overview')
      await screen.findByRole('heading', { name: 'Overview', level: 1 })

      await user.click(screen.getByRole('button', { name }))

      // Axe over a closed menu grades no menu, so a trigger that fails to open must fail here.
      const menu = await screen.findByRole('menu')
      // A menu that opened empty would pass axe while grading no items.
      expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
      await expectNoViolationsIn(menu)
    }
  )

  /** A combobox whose search box lives inside the popup, so Base UI makes the popup a named `dialog` and the portaled list is exempt from `region`; graded at document scope. */
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

    // A popup that opened empty would pass axe while grading no list.
    expect(await screen.findByRole('option', { name: 'Acme Corp' })).toBeInTheDocument()
    // `KNOWN_INCOMPLETE` accepts `aria-valid-attr-value` here because both `aria-controls` targets exist; this asserts that.
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

  /** The ⌘K palette as the shell mounts it: a named `dialog`, so its portaled list is exempt from `region` and it is graded at document scope. */
  it('has no violations with the command palette open', async () => {
    const user = userEvent.setup()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await user.click(screen.getByRole('button', { name: /Search…/ }))

    const palette = await screen.findByRole('dialog', { name: 'Command palette' })
    // A palette that opened empty would pass axe while grading no list.
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

    // The user group is what this grades; without the row it would repeat the test above.
    expect(
      await within(palette).findByRole('option', { name: /cleo@example\.com/ })
    ).toBeInTheDocument()
    await expectNoViolations()
  })

  /** The calendar popover: a named `dialog`, so it is graded at document scope like the palette. */
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
    // Every member here is an owner, so the signed-in owner can leave while another owner remains.
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
    // Staff on a customer tenant act through platform access, so Revoke asks for a reason.
    await screen.findByRole('alertdialog', { name: 'Revoke this invitation?' })
    await expectNoViolations()
  })

  it('has no violations with the staff role-change dialog open', async () => {
    serveTenant('active')
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(
          { ...ACME_DETAIL, isPlatform: false, role: 'owner', access: 'platform' },
          'Tenant retrieved.'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    await user.click(await screen.findByRole('combobox', { name: 'Role for Cleo D' }))
    await user.click(await screen.findByRole('option', { name: 'Viewer' }))
    await screen.findByRole('alertdialog', { name: 'Change this member’s role?' })
    await expectNoViolations()
  })

  it('has no violations with a member’s revoke-invitation dialog open, on the Staff page', async () => {
    serveStaff()
    server.use(
      http.get('/api/v1/tenants/platform/invitations', () =>
        ok([testInvitation], 'Invitations retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/staff')
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
    // The sidebar footer's theme menu, opened from inside the modal sheet.
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

/** What axe cannot see: whether a focusable element shows focus. A removed outline with nothing in its place is invisible without a layout and cascade, so this asserts the class. */
describe('focus indicators', () => {
  /**
   * `Tabs` is rendered directly, apart from the email detail and onboarding pages that mount it, so the
   * primitive's own contract holds whatever a page passes it. Base UI renders `Tabs.Panel` with
   * `tabIndex: open ? 0 : -1` (@base-ui/react@1.8.0, tabs/panel/TabsPanel.js), so an open panel is
   * reachable by keyboard, and suppressing its outline with nothing in its place fails WCAG 2.4.7.
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

/** What axe cannot see: the order focus moves in, and where it lands when an overlay closes. */
describe('keyboard', () => {
  it('tabs through the login form in the order the page reads', async () => {
    signOut()
    const user = userEvent.setup()
    renderAppAt('/login')
    await screen.findByRole('button', { name: 'Sign in' })

    const expected = [
      // The skip link is every layout's first Tab stop.
      screen.getByRole('link', { name: 'Skip to content' }),
      screen.getByLabelText('Email'),
      screen.getByLabelText('Password'),
      screen.getByRole('button', { name: 'Sign in' }),
      // A plain anchor to a same-origin API route, so it is in the tab order without a handler.
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
    // Opened from the keyboard: focus restoration only matters to a keyboard user.
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

/** Deliverability, Suppressions (with the lift dialog), a tenant's Emails tab and a user's Emails card, each waiting for loaded content; the Emails list and an email's page are graded above. */
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

  /** Answers the emails list with `rows` and a next-page cursor, so the pager's Next button is enabled. */
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

  /** Answers the suppressions list with `rows`, a previous-page cursor and no next one. */
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
    expect(within(table).getByText(byContent(/^Lifted .+ by Sam Staff$/))).toBeInTheDocument()
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

/** The onboarding page on every tab, with rows and its empty states, and a tenant's Onboarding tab in each state that renders differently, with both reason dialogs and the member disclosure open. */
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

/** The Maintenance page for an owner in full maintenance, where every fact and control shows, and its two dialogs open. */
describe('maintenance', () => {
  beforeEach(() => {
    signIn()
    useAuthStore.setState({ user: { ...testUser, platformRole: 'owner' } })
  })

  /** Answers the platform maintenance state with `view`, full maintenance by default. */
  function serveMaintenance(view = fullMaintenanceView()) {
    server.use(
      http.get('/api/v1/platform/maintenance-mode', () => ok(view, 'Maintenance mode retrieved.'))
    )
  }

  it('the page in full maintenance has no axe violations', async () => {
    serveMaintenance()
    renderAppAt('/maintenance')
    await screen.findByRole('list', { name: 'Queues' })
    await screen.findByRole('button', { name: 'Turn off…' })
    await expectNoViolations()
  })

  it('has no violations with the switch-on dialog open, its preview and confirm showing', async () => {
    serveMaintenance(maintenanceModeView())
    const user = userEvent.setup()
    renderAppAt('/maintenance')
    await user.click(await screen.findByRole('button', { name: 'Turn on maintenance…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on maintenance' })
    await user.type(within(dialog).getByLabelText('Message for customers'), 'Back soon.')
    expect(within(dialog).getByLabelText('Type staging to confirm')).toBeInTheDocument()
    await expectNoViolations()
  })

  it('the banner on another page, and the status card’s section, have no axe violations', async () => {
    serveMaintenance()
    server.use(
      http.get('/api/v1/platform/system/status', () =>
        ok(
          {
            ...testSystemStatus,
            maintenance: maintenanceStatus({
              mode: 'full',
              queuesPaused: true,
              queues: PAUSED_QUEUES,
              noticesPending: true,
            }),
          },
          'System status retrieved.'
        )
      )
    )
    renderAppAt('/overview')
    await screen.findByText(/^Customers are in FULL maintenance/)
    await screen.findByRole('heading', { name: 'Maintenance mode', level: 3 })
    await screen.findByRole('figure', { name: 'Sign-ups per day' })
    await expectNoViolations()
  })

  it('has no violations with the switch-off dialog open', async () => {
    serveMaintenance()
    const user = userEvent.setup()
    renderAppAt('/maintenance')
    await user.click(await screen.findByRole('button', { name: 'Turn off…' }))
    await screen.findByRole('alertdialog', { name: 'Turn off maintenance?' })
    await expectNoViolations()
  })
})
