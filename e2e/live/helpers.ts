import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, type Page } from '@playwright/test'
import type { MembershipRole } from '@/constants/roles'

const execFile = promisify(execFileCallback)

export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4040'
export const MAILPIT_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? 'http://localhost:8025'
export const API_DIR = process.env.E2E_API_DIR ?? '../express-boilerplate'

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
 * `authenticated_at` an hour back in express's database. An access token
 * carries `auth_time` from that column, so the NEXT one (a full page load,
 * which refreshes) is stale. Runs psql in the compose project's postgres
 * service with the compose file's credentials.
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
      'boilerplate',
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
 * staff directory suite: express older than 1.2.0 (no
 * `POST /auth/reauthenticate`, which answers 401 without a token on 1.2.0 and
 * 404 before it), an email worker that delivers nothing to mailpit, or
 * `APEX_URL`/`WEB_URL` pointing somewhere other than `APEX_ORIGIN` and
 * `WEB_ORIGIN`. The origins are read from the verification links two fresh
 * registrations are mailed, one per `app`.
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
}
