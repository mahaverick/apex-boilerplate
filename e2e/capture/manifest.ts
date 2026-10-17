/**
 * @file Every apex route and how the capture shoots it. Keyed by the route
 * tree's full paths, so a new route fails `pnpm typecheck:e2e` until it is
 * listed here. Endpoints are relative to /api/v1 (see endpoint.ts).
 */
import type { FileRoutesByFullPath } from '@/routeTree.gen'
import type { NavigationCapture, RouteCapture, Section } from './types'

const TENANT: Section = { name: 'Tenant', endpoints: ['GET /platform/tenants/:id'] }
const USER: Section = { name: 'User', endpoints: ['GET /platform/users/:id'] }

/** Each route's capture, keyed by its full path. */
export const CAPTURES: Record<keyof FileRoutesByFullPath, RouteCapture> = {
  '/': { kind: 'redirect', to: '/overview when signed in, else /login' },
  '/$': {
    kind: 'page',
    area: 'system',
    shot: 'not-found',
    url: '/no-such-page',
    as: 'staff',
    sections: [],
  },
  '/no-access': {
    kind: 'page',
    area: 'auth',
    shot: 'no-access',
    url: '/no-access',
    as: 'customer',
    sections: [],
  },
  '/reset-password': {
    kind: 'page',
    area: 'auth',
    shot: 'reset-password',
    url: '/reset-password?token=0000000000000000',
    as: 'anonymous',
    sections: [],
    empty: { url: '/reset-password' },
  },
  '/verify-email': {
    kind: 'page',
    area: 'auth',
    shot: 'verify-email',
    url: '/verify-email?token=0000000000000000',
    as: 'anonymous',
    sections: [],
    empty: { url: '/verify-email' },
  },
  '/activity': {
    kind: 'page',
    area: 'activity',
    shot: 'activity',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the platform-not-found card; no audit-log or members request.',
    },
    url: '/activity',
    as: 'staff',
    sections: [
      { name: 'Actors', endpoints: ['GET /tenants/platform/members'] },
      { name: 'Activity', endpoints: ['GET /platform/audit-log'] },
    ],
    empty: {
      stubs: [
        {
          endpoint: 'GET /platform/audit-log',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
      ],
    },
  },
  '/deliverability': {
    kind: 'page',
    area: 'deliverability',
    shot: 'deliverability',
    url: '/deliverability',
    as: 'staff',
    responsive: true,
    sections: [{ name: 'Email health', endpoints: ['GET /platform/emails/health'] }],
  },
  '/flags': { kind: 'redirect', to: '/settings/platform/flags' },
  '/maintenance': { kind: 'redirect', to: '/settings/platform/maintenance' },
  '/onboarding': {
    kind: 'page',
    area: 'onboarding',
    shot: 'onboarding',
    url: '/onboarding',
    as: 'staff',
    sections: [
      { name: 'Funnel', endpoints: ['GET /platform/onboarding/funnel'] },
      { name: 'Tenants', endpoints: ['GET /platform/onboarding/tenants'] },
    ],
    empty: { url: '/onboarding?state=dismissed' },
  },
  '/overview': {
    kind: 'page',
    area: 'overview',
    shot: 'overview',
    roleDenied: { as: 'viewer', note: 'A viewer: no system status card.' },
    url: '/overview',
    as: 'staff',
    responsive: true,
    sections: [
      { name: 'Stats (KPIs, charts)', endpoints: ['GET /platform/stats'] },
      { name: 'System status', endpoints: ['GET /platform/system/status'] },
    ],
  },
  '/profile': { kind: 'redirect', to: '/settings/account/profile' },
  '/settings': {
    kind: 'layout',
    note: 'Settings shell: NavSettings replaces the nav; h1 from the active section.',
  },
  '/staff': { kind: 'redirect', to: '/settings/platform/staff' },
  '/suppressions': {
    kind: 'page',
    area: 'suppressions',
    shot: 'suppressions',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the same list. Lifting is admin only, but this run had no suppressed addresses, so the shot shows the empty list and no row action.',
    },
    url: '/suppressions',
    as: 'staff',
    sections: [{ name: 'Suppressions', endpoints: ['GET /platform/email-suppressions'] }],
    empty: { url: '/suppressions?search=zzzz-no-match' },
  },
  '/forgot-password': {
    kind: 'page',
    area: 'auth',
    shot: 'forgot-password',
    url: '/forgot-password',
    as: 'anonymous',
    sections: [],
  },
  '/login': {
    kind: 'page',
    area: 'auth',
    shot: 'login',
    url: '/login',
    as: 'anonymous',
    sections: [],
    responsive: true,
  },
  '/register': {
    kind: 'page',
    area: 'auth',
    shot: 'register',
    url: '/register?invitation={invitationToken}',
    as: 'anonymous',
    sections: [{ name: 'Invitation preview', endpoints: ['POST /invitations/preview'] }],
    note: 'Invitation-only. If the seed could not mail a staff invitation, this shows the "cannot be used" card.',
  },
  '/auth/callback': {
    kind: 'redirect',
    to: '/overview, or /login?error=google_auth_failed (in an effect)',
  },
  '/invitations/accept': {
    kind: 'page',
    area: 'auth',
    shot: 'invitation-accept',
    url: '/invitations/accept?token={invitationToken}',
    as: 'anonymous',
    sections: [{ name: 'Invitation preview', endpoints: ['POST /invitations/preview'] }],
    empty: { url: '/invitations/accept' },
  },
  '/emails/$emailId': {
    kind: 'page',
    area: 'emails',
    shot: 'email-detail',
    roleDenied: {
      as: 'viewer',
      note: "A viewer: no Resend, which needs admin or owner. This run's email is a verification mail to a verified user, so the owner's default shows no Resend either.",
    },
    url: '/emails/{emailId}',
    as: 'staff',
    sections: [{ name: 'Email', endpoints: ['GET /platform/emails/:id'] }],
  },
  '/tenants/$tenantId': {
    kind: 'layout',
    note: 'Header + tab nav from GET /platform/tenants/:id; every tab renders nothing until it has data.',
  },
  '/users/$userId': {
    kind: 'layout',
    note: 'Bare Outlet; its loader starts GET /platform/users/:id for the crumb.',
  },
  '/emails/': {
    kind: 'page',
    area: 'emails',
    shot: 'emails',
    url: '/emails',
    as: 'staff',
    responsive: true,
    sections: [{ name: 'Emails', endpoints: ['GET /platform/emails'] }],
    empty: { url: '/emails?search=zzzz-no-match' },
  },
  '/settings/': {
    kind: 'page',
    area: 'settings',
    shot: 'settings-index',
    url: '/settings',
    as: 'staff',
    sections: [],
  },
  '/tenants/': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenants',
    roleDenied: { as: 'viewer', note: 'A viewer: no create-tenant action.' },
    url: '/tenants',
    as: 'staff',
    responsive: true,
    sections: [{ name: 'Tenants', endpoints: ['GET /platform/tenants'] }],
    empty: { url: '/tenants?search=zzzz-no-match' },
  },
  '/users/': {
    kind: 'page',
    area: 'users',
    shot: 'users',
    roleDenied: { as: 'viewer', note: 'A viewer: no create-user action.' },
    url: '/users',
    as: 'staff',
    responsive: true,
    sections: [{ name: 'Users', endpoints: ['GET /platform/users'] }],
    empty: { url: '/users?search=zzzz-no-match' },
  },
  '/settings/account/profile': {
    kind: 'page',
    area: 'settings',
    shot: 'account-profile',
    url: '/settings/account/profile',
    as: 'staff',
    sections: [],
    note: 'useProfile has initialData from the auth store and no error UI of its own.',
  },
  '/settings/account/security': {
    kind: 'page',
    area: 'settings',
    shot: 'account-security',
    url: '/settings/account/security',
    as: 'staff',
    sections: [{ name: 'Sign-in methods', endpoints: ['GET /auth/providers'] }],
  },
  '/settings/platform/flags': {
    kind: 'page',
    area: 'settings',
    shot: 'platform-flags',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the registry shows, but the evaluate panel is admin only.',
    },
    url: '/settings/platform/flags',
    as: 'staff',
    sections: [
      { name: 'Page gate and snapshot', endpoints: ['GET /platform/flags/meta'] },
      { name: 'Registered flags', endpoints: ['GET /platform/flags'] },
      { name: 'In PostHog, not registered', endpoints: ['GET /platform/flags/unregistered'] },
    ],
    empty: {
      stubs: [
        {
          endpoint: 'GET /platform/flags',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
        {
          endpoint: 'GET /platform/flags/unregistered',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
        {
          endpoint: 'GET /platform/flags/meta',
          data: { traits: [], snapshot: { enabled: true, stale: false, fetchedAt: null } },
        },
      ],
    },
  },
  '/settings/platform/maintenance': {
    kind: 'page',
    area: 'settings',
    shot: 'platform-maintenance',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the state shows with "Only a platform owner can change maintenance mode." in place of the controls. Admins see the same line.',
    },
    url: '/settings/platform/maintenance',
    as: 'staff',
    sections: [{ name: 'Maintenance mode', endpoints: ['GET /platform/maintenance-mode'] }],
  },
  '/settings/platform/staff': {
    kind: 'page',
    area: 'settings',
    shot: 'platform-staff',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the staff list with each role as plain text and Leave on their own row only; the invitations sections are replaced by "Invitations are managed by owners and admins. Your role here can’t see them."',
    },
    url: '/settings/platform/staff',
    as: 'staff',
    sections: [
      { name: 'Staff tenant', endpoints: ['GET /tenants/platform'] },
      { name: 'Staff members', endpoints: ['GET /tenants/platform/members'] },
      { name: 'Pending invitations', endpoints: ['GET /tenants/platform/invitations'] },
    ],
  },
  '/tenants/$tenantId/activity': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-activity',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: "A tenant’s activity is for owners and admins. Your role here can’t see it." in place of the log; the audit log is not requested.',
    },
    url: '/tenants/{tenantId}/activity',
    as: 'staff',
    sections: [TENANT, { name: 'Activity', endpoints: ['GET /tenants/:slug/audit-log'] }],
    empty: {
      stubs: [
        {
          endpoint: 'GET /tenants/:slug/audit-log',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
      ],
    },
  },
  '/tenants/$tenantId/emails': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-emails',
    url: '/tenants/{tenantId}/emails',
    as: 'staff',
    sections: [TENANT, { name: 'Emails', endpoints: ['GET /platform/emails'] }],
    empty: {
      stubs: [
        {
          endpoint: 'GET /platform/emails',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
      ],
    },
  },
  '/tenants/$tenantId/flags': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-flags',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the tab is hidden from the nav; by URL the role-denied card replaces the flags panel.',
    },
    url: '/tenants/{tenantId}/flags',
    as: 'staff',
    sections: [
      TENANT,
      { name: 'Members', endpoints: ['GET /tenants/:slug/members'] },
      { name: 'Flags', endpoints: ['GET /platform/flags'] },
    ],
  },
  '/tenants/$tenantId/invitations': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-invitations',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: "Invitations are managed by owners and admins. Your role here can’t see them." in place of the invite form and the list; the invitations are not requested.',
    },
    url: '/tenants/{tenantId}/invitations',
    as: 'staff',
    sections: [
      TENANT,
      { name: 'Pending invitations', endpoints: ['GET /tenants/:slug/invitations'] },
    ],
    empty: {
      stubs: [
        {
          endpoint: 'GET /tenants/:slug/invitations',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
      ],
    },
  },
  '/tenants/$tenantId/members': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-members',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the same member list, with each role as plain text and no Remove buttons.',
    },
    url: '/tenants/{tenantId}/members',
    as: 'staff',
    sections: [TENANT, { name: 'Members', endpoints: ['GET /tenants/:slug/members'] }],
    empty: {
      stubs: [
        {
          endpoint: 'GET /tenants/:slug/members',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
      ],
    },
  },
  '/tenants/$tenantId/onboarding': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-onboarding',
    roleDenied: {
      as: 'viewer',
      note: 'A viewer: the state and reminders are read-only; the complete-step and send-reminder actions are absent.',
    },
    url: '/tenants/{tenantId}/onboarding',
    as: 'staff',
    sections: [TENANT, { name: 'Onboarding', endpoints: ['GET /platform/tenants/:id/onboarding'] }],
  },
  '/settings/account/': { kind: 'redirect', to: '/settings/account/profile' },
  '/settings/platform/': { kind: 'redirect', to: '/settings/platform/staff' },
  '/tenants/$tenantId/': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-overview',
    roleDenied: { as: 'viewer', note: 'A viewer: no History card.' },
    url: '/tenants/{tenantId}',
    as: 'staff',
    responsive: true,
    sections: [TENANT, { name: 'History', endpoints: ['GET /platform/audit-log'] }],
    empty: {
      stubs: [
        {
          endpoint: 'GET /platform/audit-log',
          data: {
            items: [],
            page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
          },
        },
      ],
    },
  },
  '/users/$userId/': {
    kind: 'page',
    area: 'users',
    shot: 'user-overview',
    roleDenied: { as: 'viewer', note: 'A viewer: no action buttons and no History card.' },
    url: '/users/{userId}',
    as: 'staff',
    responsive: true,
    sections: [
      USER,
      { name: 'Emails', endpoints: ['GET /platform/emails'] },
      { name: 'History', endpoints: ['GET /platform/audit-log'] },
    ],
  },
}

/** The in-app navigations the capture shoots mid-flight: the route template, then the section skeletons. */
export const NAVIGATIONS: readonly NavigationCapture[] = [
  {
    area: 'deliverability',
    shot: 'deliverability',
    as: 'staff',
    from: '/overview',
    link: 'Deliverability',
    template: { variant: 'dashboard', nested: false },
    endpoints: ['GET /platform/emails/health'],
  },
  {
    area: 'tenants',
    shot: 'tenant-overview',
    as: 'staff',
    from: '/tenants',
    link: '{tenantName}',
    template: { variant: 'detail', nested: false },
    endpoints: ['GET /platform/tenants/:id'],
  },
  {
    area: 'users',
    shot: 'user',
    as: 'staff',
    from: '/users?search={userEmail}',
    link: '{userEmail}',
    template: { variant: 'detail', nested: false },
    endpoints: ['GET /platform/users/:id'],
  },
]
