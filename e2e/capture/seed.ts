/**
 * @file The apex capture's data: a staff owner (granted through express's
 * `platform:grant`, so `E2E_API_DIR` must name the express checkout) whose
 * spent sign-in link is the dead-link shot, a customer with one tenant (rows
 * for the tenants, users and emails lists) whose session is the /no-access
 * one, a staff viewer for the role-denied shots, and a pending staff
 * invitation for /invitations/accept.
 */
import {
  apiLogin,
  apiRequest,
  createTenant,
  createUser,
  emailIdFor,
  freshEmail,
  freshSlug,
  grantPlatformRole,
  requestSignInLink,
  spendSignInLink,
  staffSession,
  tenantIdOf,
} from '../live/helpers'
import { mailedLink, mailedToken } from './mailpit'
import type { Seed } from './types'

/** The name the customer's tenant gets. */
const TENANT_NAME = 'Capture Co'

/** Creates the run's accounts and records through the API. */
export async function seedCapture(): Promise<Seed> {
  const staff = freshEmail()
  // By hand rather than `staffSession`, so the run keeps the spent link for the /auth/link shot.
  await grantPlatformRole(staff, 'owner')
  const since = await requestSignInLink(staff, 'apex')
  const spentLink = await mailedLink(staff, '/auth/link', since)
  await spendSignInLink(staff, spentLink, 'apex')
  const staffToken = await apiLogin(staff)

  const viewer = freshEmail()
  await staffSession(viewer, 'viewer')

  const customer = freshEmail()
  await createUser(customer)
  const slug = freshSlug()
  await createTenant(await apiLogin(customer), { name: TENANT_NAME, slug })
  const tenantId = await tenantIdOf(staffToken, slug)

  const users = await apiRequest(
    staffToken,
    'GET',
    `/platform/users?search=${encodeURIComponent(customer)}`
  )
  const userId = (users.body as { data?: { items?: { id: string }[] } } | null)?.data?.items?.[0]
    ?.id
  if (!userId) throw new Error(`no user row for ${customer}: ${JSON.stringify(users.body)}`)
  // The customer's own sign-in link, the first mail an account gets.
  const emailId = await emailIdFor(staffToken, customer, 'sign_in_link')

  const invitee = freshEmail()
  const invited = await apiRequest(staffToken, 'POST', '/tenants/platform/invitations', {
    email: invitee,
    role: 'viewer',
  })
  if (invited.status !== 202 && invited.status !== 201) {
    throw new Error(`staff invitation failed (${invited.status}): ${JSON.stringify(invited.body)}`)
  }
  const invitationToken = await mailedToken(invitee, '/invitations/accept')

  return {
    sessions: { staff, customer, viewer },
    params: {
      slug,
      tenantId,
      tenantName: TENANT_NAME,
      userId,
      userEmail: customer,
      emailId,
      invitationToken,
      spentLinkQuery: spentLink.search.slice(1),
    },
  }
}
