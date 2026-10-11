import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, type Page } from '@playwright/test'
import type { MembershipRole } from '@/constants/roles'

const execFile = promisify(execFileCallback)

export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4040'
const MAILPIT_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? 'http://localhost:8025'
const API_DIR = process.env.E2E_API_DIR ?? '../express-boilerplate'

/** The database that API runs on, in its compose project's postgres; a worktree's API may run on its own. */
const API_DB = process.env.E2E_API_DB ?? 'boilerplate'

/** The password every e2e account uses. Long enough for the register schema. */
export const PASSWORD = 'a very long passphrase for e2e'

/**
 * A fresh address per run, because the login limiter is keyed `ip:email`
 * (`rate-limit.middleware.ts:loginRateLimitKey`) at five attempts per fifteen
 * minutes. A fixed address would pass once and then rate-limit every rerun
 * for the rest of the window, which reads as a broken test rather than a
 * spent bucket.
 */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown }
}

/**
 * Registers an account and verifies it, so the browser can sign in.
 *
 * Verification is NOT optional here: `/auth/register` answers 202 with
 * "If that address can be registered…" and login stays 401 until the address
 * is verified. The link only exists in the email, so mailpit is a required
 * part of this stack rather than a convenience.
 */
export async function createVerifiedUser(email: string): Promise<void> {
  const registered = await json(`${API_ORIGIN}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (registered.status !== 202 && registered.status !== 201) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`)
  }

  const token = await verificationTokenFor(email)

  /**
   * BOTH fields. `verifyEmailSchema` requires `token` AND `password`, and
   * the controller deliberately rethrows a validation failure as the same
   * "Invalid or expired verification token" a bad token gets — so omitting
   * the password looks exactly like a dead token and tells you nothing.
   */
  const verified = await json(`${API_ORIGIN}/api/v1/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: PASSWORD }),
  })
  if (verified.status !== 200) {
    throw new Error(`verify failed: ${verified.status} ${JSON.stringify(verified.body)}`)
  }
}

/** The token in the newest verification email to `email`, or '' while none has arrived. */
async function verificationTokenInMailpit(email: string): Promise<string> {
  const search = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
  )
  const found = (await search.json()) as { messages?: { ID: string }[] }
  const id = found.messages?.[0]?.ID
  if (!id) return ''
  const message = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${id}`)
  const body = (await message.json()) as { Text?: string; HTML?: string }
  return /[?&]token=([a-f0-9]+)/i.exec(`${body.Text ?? ''}${body.HTML ?? ''}`)?.[1] ?? ''
}

/**
 * Polls mailpit for the verification link and returns its token. A mailpit
 * that is down fails at once: `expect.poll` does not retry a callback that
 * throws.
 */
async function verificationTokenFor(email: string): Promise<string> {
  let token = ''
  await expect
    .poll(
      async () => {
        token = await verificationTokenInMailpit(email)
        return token
      },
      {
        message: `no verification email arrived for ${email} — is mailpit up on ${MAILPIT_ORIGIN}?`,
        intervals: [500],
        timeout: 15_000,
      }
    )
    .not.toBe('')
  return token
}

/** Whether the API answers its readiness probe. */
export async function apiIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`${API_ORIGIN}/health/ready`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function waitForApi(timeoutMs = 60_000): Promise<void> {
  await expect
    .poll(apiIsReady, {
      message: `API at ${API_ORIGIN} did not become ready within ${timeoutMs}ms`,
      intervals: [500],
      timeout: timeoutMs,
    })
    .toBe(true)
}

/**
 * Signs an EXISTING, verified account in through the real UI, leaving the
 * browser with a real session and a real refresh cookie.
 */
export async function logIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  // Exact and form-scoped: a loose /email/i label also matches the dev server's router devtools.
  const form = page.locator('form')
  await form.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await form.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/login/, { timeout: 15_000 })
}

/**
 * An access token straight from the API, for requests the browser cannot
 * make for us: the SPA's token lives in memory only (CLAUDE.md).
 */
export async function apiLogin(email: string): Promise<string> {
  const response = await json(`${API_ORIGIN}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const token = (response.body as { data?: { accessToken?: string } } | null)?.data?.accessToken
  if (response.status !== 200 || !token) {
    throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return token
}

/** One authenticated API call, answered with its status and parsed body. */
export async function apiRequest(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return json(`${API_ORIGIN}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Creates a tenant owned by the token's user. */
export async function createTenant(
  token: string,
  tenant: { name: string; slug: string }
): Promise<void> {
  const created = await apiRequest(token, 'POST', '/tenants', tenant)
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create tenant failed: ${created.status} ${JSON.stringify(created.body)}`)
  }
}

/**
 * Gives a verified account a platform role through express's own bootstrap
 * script: the supported way in, and audited as `platform.member.granted`.
 * Must run BEFORE that account signs in: the role arrives with the session.
 */
export async function grantPlatformRole(email: string, role: MembershipRole): Promise<void> {
  await execFile('pnpm', ['platform:grant', email, role], { cwd: API_DIR, timeout: 60_000 })
}

/** A slug no earlier run has taken: lowercase, hyphenated, 3 to 100 characters. */
export function freshSlug(): string {
  return `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}

/** The newest `/${page}?token=` link mailed to `email`, or '' while none has arrived. */
async function linkInMailpit(email: string, page: string): Promise<string> {
  const search = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
  )
  const found = (await search.json()) as { messages?: { ID: string }[] }
  const pattern = new RegExp(`https?://[^\\s"'<>]+/${page}\\?token=[A-Za-z0-9_-]+`)
  for (const { ID } of found.messages ?? []) {
    const message = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${ID}`)
    const body = (await message.json()) as { Text?: string }
    const match = pattern.exec(body.Text ?? '')
    if (match) return match[0]
  }
  return ''
}

/**
 * Polls mailpit for the newest `/${page}?token=` link sent to `email`. The
 * whole link, not only its token, so a test can assert which frontend it
 * points at.
 * @param email - The recipient.
 * @param page - `verify-email`, `reset-password` or `invitations/accept`.
 * @returns The absolute link.
 */
export async function mailedLink(email: string, page: string): Promise<string> {
  let link = ''
  await expect
    .poll(
      async () => {
        link = await linkInMailpit(email, page)
        return link
      },
      {
        message: `no ${page} email arrived for ${email} — is mailpit up on ${MAILPIT_ORIGIN}?`,
        intervals: [500],
        timeout: 15_000,
      }
    )
    .not.toBe('')
  return link
}

/** Where express sends customer-facing links (its `WEB_URL`), locally the react app. */
export const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5173'

/** Where express sends Apex's links (its `APEX_URL`): this dev server. */
export const APEX_ORIGIN = 'http://localhost:5174'

/**
 * Redeems a mailed set-password or reset link through the API. The link
 * points at the customer app, which this suite does not run, so the token is
 * posted straight to `/auth/reset-password` as that page would.
 * @param link - The absolute `/reset-password?token=` link from the email.
 * @param password - The new password.
 */
export async function resetPasswordWith(link: string, password: string): Promise<void> {
  const token = new URL(link).searchParams.get('token')
  const response = await json(`${API_ORIGIN}/api/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  if (response.status !== 200) {
    throw new Error(`reset failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
}

/**
 * Accepts an invitation as a verified account, through the API: for a
 * customer tenant the link points at the customer app, which this suite does
 * not run.
 * @param email - The invitee, already registered and verified.
 * @param link - The absolute `/invitations/accept?token=` link from the email.
 */
export async function acceptInvitationAs(email: string, link: string): Promise<void> {
  const token = new URL(link).searchParams.get('token')
  const accepted = await apiRequest(await apiLogin(email), 'POST', '/invitations/accept', {
    token,
  })
  if (accepted.status !== 200) {
    throw new Error(`accept failed: ${accepted.status} ${JSON.stringify(accepted.body)}`)
  }
}

/**
 * Makes a user's step-up stale by moving their refresh tokens'
 * `authenticated_at` an hour back in express's database (`API_DB`). An
 * access token carries `auth_time` from that column, so the NEXT one (a full
 * page load, which refreshes) is stale. Runs psql in the compose project's
 * postgres service with the compose file's credentials.
 * @param email - The user whose sessions to age.
 */
export async function backdateStepUp(email: string): Promise<void> {
  const sql =
    "update user_tokens set authenticated_at = now() - interval '1 hour' " +
    "where purpose = 'refresh' and user_id = (select id from users where lower(email) = lower($$" +
    email.replaceAll('$', '') +
    '$$) and deleted_at is null)'
  await execFile(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'boilerplate',
      '-d',
      API_DB,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { cwd: API_DIR, timeout: 30_000 }
  )
}

/**
 * Fails before any test runs, naming the misconfiguration, when the API cannot run the
 * staff suites: express older than 1.2.0 (no `POST /auth/reauthenticate`, which answers
 * 401 without a token on 1.2.0 and 404 before it), an email worker that delivers nothing
 * to mailpit, `APEX_URL`/`WEB_URL` pointing somewhere other than `APEX_ORIGIN` and
 * `WEB_ORIGIN`, express older than 1.3.0 (no `GET /platform/emails`) or older than 1.4.0
 * (no `GET /platform/onboarding/funnel`). The origins are read from the verification links
 * two fresh registrations are mailed, one per `app`. The 1.3.0 and 1.4.0 probes need a
 * staff token, since `/platform` authenticates before it routes (an anonymous request is
 * 401 on every version), so they run last: a worker that delivers nothing is reported as
 * that, not as a failed sign-up.
 */
export async function assertApiServesApex(): Promise<void> {
  const reauthenticate = await json(`${API_ORIGIN}/api/v1/auth/reauthenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (reauthenticate.status === 404) {
    throw new Error(
      `The API at ${API_ORIGIN} has no POST /auth/reauthenticate: it is older than express 1.2.0, which the staff directory needs.`
    )
  }

  for (const [app, expected, variable] of [
    ['apex', APEX_ORIGIN, 'APEX_URL'],
    ['web', WEB_ORIGIN, 'WEB_URL'],
  ] as const) {
    const email = freshEmail()
    const registered = await json(`${API_ORIGIN}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, app }),
    })
    if (registered.status !== 202 && registered.status !== 201) {
      throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`)
    }
    let link: string
    try {
      link = await mailedLink(email, 'verify-email')
    } catch {
      throw new Error(
        `The API at ${API_ORIGIN} mailed nothing to ${MAILPIT_ORIGIN} within 15s: its email worker is not delivering (check its SMTP_* settings and that its workers started).`
      )
    }
    const origin = new URL(link).origin
    if (origin !== expected) {
      throw new Error(
        `The API at ${API_ORIGIN} links app "${app}" to ${origin}: start it with ${variable}=${expected}.`
      )
    }
  }

  const viewer = freshEmail()
  await createVerifiedUser(viewer)
  await grantPlatformRole(viewer, 'viewer')
  const viewerToken = await apiLogin(viewer)
  const emails = await apiRequest(viewerToken, 'GET', '/platform/emails?limit=1')
  if (emails.status === 404) {
    throw new Error(
      `The API at ${API_ORIGIN} has no GET /platform/emails: it is older than express 1.3.0, which message tracking needs.`
    )
  }
  if (emails.status !== 200) {
    throw new Error(
      `GET /platform/emails answered ${emails.status} for a staff viewer: ${JSON.stringify(emails.body)}`
    )
  }
  const funnel = await apiRequest(viewerToken, 'GET', '/platform/onboarding/funnel')
  if (funnel.status === 404) {
    throw new Error(
      `The API at ${API_ORIGIN} has no GET /platform/onboarding/funnel: it is older than express 1.4.0, which onboarding needs.`
    )
  }
  if (funnel.status !== 200) {
    throw new Error(
      `GET /platform/onboarding/funnel answered ${funnel.status} for a staff viewer: ${JSON.stringify(funnel.body)}`
    )
  }
}

/**
 * A tenant's id, found by its slug with a staff token.
 * @param token - A staff access token.
 * @param slug - The tenant's slug, unique among live tenants.
 */
export async function tenantIdOf(token: string, slug: string): Promise<string> {
  const found = await apiRequest(token, 'GET', `/platform/tenants?q=${encodeURIComponent(slug)}`)
  const tenants = (found.body as { data?: { tenants?: { id: string; slug: string }[] } } | null)
    ?.data?.tenants
  const tenant = tenants?.find((row) => row.slug === slug)
  if (found.status !== 200 || tenant === undefined) {
    throw new Error(`no tenant ${slug}: ${found.status} ${JSON.stringify(found.body)}`)
  }
  return tenant.id
}

/** The first link starting with `prefix` in the newest email to `email` that has one, or ''. */
async function linkStartingWith(email: string, prefix: string): Promise<string> {
  const search = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
  )
  const found = (await search.json()) as { messages?: { ID: string }[] }
  const escaped = prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  const pattern = new RegExp(`${escaped}[^\\s"'<>]*`)
  for (const { ID } of found.messages ?? []) {
    const message = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${ID}`)
    const body = (await message.json()) as { Text?: string }
    const match = pattern.exec(body.Text ?? '')
    if (match) return match[0]
  }
  return ''
}

/**
 * Polls mailpit for a link starting with `prefix` mailed to `email`: for an
 * email whose link carries no token, which `mailedLink` looks for.
 * @param email - The recipient.
 * @param prefix - The link's start, e.g. `${WEB_ORIGIN}/tenants/`.
 * @returns The absolute link.
 */
export async function mailedLinkStartingWith(email: string, prefix: string): Promise<string> {
  let link = ''
  await expect
    .poll(
      async () => {
        link = await linkStartingWith(email, prefix)
        return link
      },
      {
        message: `no email with a ${prefix} link arrived for ${email} — is mailpit up on ${MAILPIT_ORIGIN}?`,
        intervals: [500],
        timeout: 15_000,
      }
    )
    .not.toBe('')
  return link
}

/** One row of `GET /platform/emails`, as far as the suites read it. */
interface EmailRow {
  id: string
  recipient: string
  templateKey: string
  status: string
  createdAt: string
}

/**
 * Every email to `recipient` the API lists, newest first, read with a staff
 * token. `q` matches the recipient by substring, so the exact address is
 * filtered here too.
 * @param token - A staff access token.
 * @param recipient - The address the emails went to.
 */
async function emailsTo(token: string, recipient: string): Promise<EmailRow[]> {
  const found = await apiRequest(
    token,
    'GET',
    `/platform/emails?q=${encodeURIComponent(recipient)}&limit=50`
  )
  if (found.status !== 200) {
    throw new Error(`email search failed: ${found.status} ${JSON.stringify(found.body)}`)
  }
  const { messages } = (found.body as { data: { messages: EmailRow[] } }).data
  return messages.filter((email) => email.recipient.toLowerCase() === recipient.toLowerCase())
}

/**
 * Polls until an email to `recipient` from `templateKey`, other than the ones
 * in `except`, is listed, and returns its id. A fresh account already has its
 * verification email, so the template, not the position, picks the message.
 * @param token - A staff access token.
 * @param recipient - The address.
 * @param templateKey - e.g. `password_reset`.
 * @param except - Ids already accounted for, such as the original of a resend.
 */
export async function emailIdFor(
  token: string,
  recipient: string,
  templateKey: string,
  except: readonly string[] = []
): Promise<string> {
  let id = ''
  await expect
    .poll(
      async () => {
        const match = (await emailsTo(token, recipient)).find(
          (email) => email.templateKey === templateKey && !except.includes(email.id)
        )
        id = match?.id ?? ''
        return id
      },
      {
        message: `no ${templateKey} email to ${recipient} was listed by GET /platform/emails`,
        intervals: [500],
        timeout: 15_000,
      }
    )
    .not.toBe('')
  return id
}

/**
 * Fails fast when the API has no local fake webhook adapter: it is registered
 * only with `APP_ENV=local`, and every provider event this suite fires goes
 * through it. An unsigned post is refused 401 when the adapter exists and is
 * a 404 when it does not.
 */
export async function assertFakeEmailWebhook(): Promise<void> {
  const probe = await json(`${API_ORIGIN}/api/v1/webhooks/email/fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (probe.status !== 401) {
    throw new Error(
      `POST /webhooks/email/fake answered ${probe.status}, not 401: the API at ${API_ORIGIN} has no fake email webhook, which only APP_ENV=local registers.`
    )
  }
}

/**
 * Delivers one signed provider event for an email through express's own
 * `pnpm email:fire-event`, the way a provider's webhook would, to the API
 * this suite runs against.
 * @param messageId - The email's id, as `GET /platform/emails` lists it.
 * @param type - The event: `delivered`, `bounced`, `complained`, …
 * @param bounceKind - For `bounced` only: `hard` suppresses the address, `soft` defers.
 */
export async function fireEmailEvent(
  messageId: string,
  type: 'delivered' | 'deferred' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'failed',
  bounceKind?: 'hard' | 'soft'
): Promise<void> {
  await execFile(
    'pnpm',
    [
      'email:fire-event',
      messageId,
      type,
      ...(bounceKind === undefined ? [] : [bounceKind]),
      '--origin',
      API_ORIGIN,
    ],
    { cwd: API_DIR, timeout: 60_000 }
  )
}
