/**
 * @file Whether a failed read was refused for the caller's role, which
 * `QueryState` shows as `RoleDenied` rather than a retryable error.
 */
import { statusFrom } from '@/lib/api-error'

/**
 * Whether a platform endpoint refused the caller's role. `/platform/*` answers
 * 404, not 403, to non-staff and to staff below the route's role, so a 404 here
 * means "not available to you", never "missing". A route an older express
 * lacks 404s too (`/platform/stats` before 1.1.0, `/platform/users` and
 * `/platform/tenants/:id` before 1.2.0, `/platform/emails*` and
 * `/platform/email-suppressions` before 1.3.0, `/platform/onboarding/*` and
 * `/platform/tenants/:id/onboarding` before 1.4.0,
 * `/platform/system/status` before 1.7.0, `/platform/flags*` before 1.8.0,
 * `/platform/maintenance-mode` before 1.9.0, the tax routes under
 * `/platform/tenants/:id/billing/tax-*` and `/platform/billing/tax-export`
 * before 10.0.0), so it reads as role-denied.
 * @param error - A query or mutation error.
 * @returns True for a 404.
 */
export function isRoleDenied(error: unknown): boolean {
  return statusFrom(error) === 404
}
