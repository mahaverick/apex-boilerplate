/**
 * @file The apex capture's data: a staff owner (granted through express's
 * `platform:grant`, so `E2E_API_DIR` must name the express checkout), a
 * customer with one tenant (rows for the tenants, users and emails lists), a
 * signed-in non-staff account for /no-access, and a pending staff invitation
 * for /register.
 */
import {
  apiLogin,
  apiRequest,
  createTenant,
  createVerifiedUser,
  emailIdFor,
  freshEmail,
  freshSlug,
  grantPlatformRole,
  tenantIdOf,
} from '../live/helpers'
import { mailedToken } from './mailpit'
import type { Seed } from './types'

/** Creates the run's accounts and records through the API. */
export async function seedCapture(): Promise<Seed> {
  const staff = freshEmail()
  await createVerifiedUser(staff)
  await grantPlatformRole(staff, 'owner')
  const staffToken = await apiLogin(staff)

  const customer = freshEmail()
  await createVerifiedUser(customer)
  const slug = freshSlug()
  await createTenant(await apiLogin(customer), { name: 'Capture Co', slug })
  const tenantId = await tenantIdOf(staffToken, slug)

  const users = await apiRequest(
    staffToken,
    'GET',
    `/platform/users?q=${encodeURIComponent(customer)}`
  )
  const userId = (users.body as { data?: { users?: { id: string }[] } } | null)?.data?.users?.[0]
    ?.id
  if (!userId) throw new Error(`no user row for ${customer}: ${JSON.stringify(users.body)}`)
  const emailId = await emailIdFor(staffToken, customer, 'email_verification')

  let invitationToken = 'not-a-real-invitation'
  const invitee = freshEmail()
  const invited = await apiRequest(staffToken, 'POST', '/tenants/platform/invitations', {
    email: invitee,
    role: 'viewer',
  })
  if (invited.status === 202 || invited.status === 201) {
    // The mail links to /invitations/accept?token=…; /register takes the same value as `invitation`.
    invitationToken = await mailedToken(invitee, '/invitations/accept')
  }

  return {
    sessions: { staff, customer },
    params: { slug, tenantId, userId, emailId, invitationToken },
  }
}
