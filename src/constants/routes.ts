/**
 * The API's path prefix, fixed rather than configurable, and the one place the
 * JavaScript side writes it: the axios base and the Google OAuth anchor both
 * derive from it. nginx.conf hardcodes it too, in
 * `location /api/v1/notifications/stream`, an SSE location kept for the
 * notification stream a later sub-project adds (Apex opens no stream yet), so
 * moving the API means changing this constant and nginx.conf in one change.
 * The dev proxy forwards all of `/api`.
 */
export const API_PREFIX = '/api/v1'

export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  overview: '/overview',
  tenants: '/tenants',
  activity: '/activity',
  profile: '/profile',
  users: '/users',
  user: '/users/$userId',
  userTimeline: '/users/$userId/timeline',
  userErrors: '/users/$userId/errors',
  staff: '/staff',
  tenant: '/tenants/$tenantId',
  tenantMembers: '/tenants/$tenantId/members',
  tenantInvitations: '/tenants/$tenantId/invitations',
  tenantActivity: '/tenants/$tenantId/activity',
  tenantTimeline: '/tenants/$tenantId/timeline',
  tenantErrors: '/tenants/$tenantId/errors',
  tenantEmails: '/tenants/$tenantId/emails',
  tenantOnboarding: '/tenants/$tenantId/onboarding',
  tenantFlags: '/tenants/$tenantId/flags',
  emails: '/emails',
  email: '/emails/$emailId',
  deliverability: '/deliverability',
  suppressions: '/suppressions',
  onboarding: '/onboarding',
  flags: '/flags',
  maintenance: '/maintenance',
  noAccess: '/no-access',
  invitationAccept: '/invitations/accept',
} as const

/** The API path for the Google OAuth start. Same-origin, so a plain anchor; `app=apex` brings the callback back here. */
export const GOOGLE_OAUTH_PATH = `${API_PREFIX}/auth/google?app=apex`

/**
 * The platform tenant's slug, seeded by express migration 0016 and reserved
 * there. Its members are the staff.
 */
export const PLATFORM_TENANT_SLUG = 'platform'
