/**
 * @file Helpers for the `live` e2e project: accounts made through a real
 * express's API and Mailpit, staff signed in by emailed link through the API
 * or the UI, "Confirm it's you" by link in the same browser, and the commands
 * that run in the express checkout.
 */
import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { promisify } from 'node:util'
import { expect, type Page } from '@playwright/test'
import type { MembershipRole } from '@/constants/roles'
import { apiDirPlan } from '../../scripts/api-dir-guard.mjs'
import { mailedLink } from '../capture/mailpit'
import { settle } from '../timing'

const execFile = promisify(execFileCallback)

/** Where the API under test listens: `E2E_API_ORIGIN`, which the dev server's `/api` proxy follows too. */
export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4040'
const MAILPIT_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? 'http://localhost:8025'

/**
 * The express checkout the helpers run commands in: `E2E_API_DIR`, which has no
 * default. It may be the main checkout, since the helpers send no signals.
 * @param use - What the helper runs there, for the error.
 * @param script - The `package.json` script the helper runs, if any.
 * @returns The resolved directory.
 * @throws When `E2E_API_DIR` is unset, missing, or lacks the script.
 */
function apiDir(use: string, script?: string): string {
  const plan = apiDirPlan({
    apiDir: process.env.E2E_API_DIR,
    use,
    script,
    realpath: realpathSync,
    readJson: (file) => {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as { scripts?: unknown }
      } catch {
        return null
      }
    },
  })
  if ('refusal' in plan) throw new Error(plan.refusal)
  return plan.dir
}

/** The database that API runs on, in its compose project's postgres; a worktree's API may run on its own. */
const API_DB = process.env.E2E_API_DB ?? 'boilerplate'

/**
 * A unique e2e address per call. Express mails one address at most one
 * sign-in link a minute (`SIGN_IN_LINK_MAIL_COOLDOWN`) and ten a day
 * (`SIGN_IN_LINK_RECIPIENT_DAILY_LIMIT`), answering 202 either way, so a fixed
 * address would leave reruns waiting on links that never arrive. The per-IP
 * limiter (ten link requests per fifteen minutes) holds whatever the address;
 * `RATE_LIMIT_SCALE` on the API under test widens it.
 */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`
}

/** A `fetch` that answers with the status and the parsed JSON body, or `null` when the body is not JSON. */
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown }
}

/** A session the API issued: its access token and the refresh cookie it set. */
interface LiveSession {
  accessToken: string
  refreshCookie: { name: string; value: string; path: string }
}

/**
 * Which app a link opens: `apex` for staff, mailed only to an address with a
 * platform role, and `web`, the customer app, for anyone.
 */
type LinkApp = 'apex' | 'web'

/**
 * The session each address was signed in with through the API, and the app
 * its link opened, kept for one browser: `logIn` hands its refresh cookie to
 * a page once, since the cookie rotates on its first use and a second holder
 * would be refused.
 */
const keptSessions = new Map<string, { session: LiveSession; app: LinkApp; used: boolean }>()

/**
 * Express's default `SIGN_IN_LINK_MAIL_COOLDOWN` (one minute), with a second
 * of margin: inside it, a second link request to the same address is
 * answered 202 and mails nothing.
 */
const MAIL_COOLDOWN_MS = 61_000

/** When these helpers last had a link request for each address answered. */
const lastLinkRequest = new Map<string, number>()

/**
 * Waits out the mail cooldown for `email` when these helpers had a link sent
 * to it less than a minute ago. Call `linkRequested` once the request is
 * answered.
 * @returns The time to pass to `mailedLink` as `since`, read before the request.
 */
async function linkRequestSlot(email: string): Promise<number> {
  const last = lastLinkRequest.get(email)
  const wait = last === undefined ? 0 : last + MAIL_COOLDOWN_MS - Date.now()
  if (wait > 0) await settle(wait, 'express mails one sign-in link per address per minute')
  return Date.now()
}

/**
 * Records that a link request for `email` was answered. Read after the 202:
 * express starts the cooldown after it replies, so a time read before the
 * request would end the wait early by the request's own latency.
 */
function linkRequested(email: string): void {
  lastLinkRequest.set(email, Date.now())
}

/** What a 429 from `/auth/link/request` means here: express allows ten per fifteen minutes per IP. */
const RATE_LIMITED = 'sign-in link rate limit hit: set RATE_LIMIT_SCALE on the API under test'

/**
 * Asks the API to mail `email` a sign-in link, as a sign-in page does. An
 * `apex` request for an address with no platform role is answered 202 and
 * mails nothing, so grant the role first.
 * @param email - The address.
 * @param app - The app the link opens.
 * @returns The time to pass to `mailedLink` as `since`.
 * @throws On a 429, naming `RATE_LIMIT_SCALE`, and on any answer but 202.
 */
export async function requestSignInLink(email: string, app: LinkApp): Promise<number> {
  const since = await linkRequestSlot(email)
  const requested = await json(`${API_ORIGIN}/api/v1/auth/link/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, app }),
  })
  if (requested.status === 429) throw new Error(RATE_LIMITED)
  if (requested.status !== 202) {
    throw new Error(`link request failed: ${requested.status} ${JSON.stringify(requested.body)}`)
  }
  linkRequested(email)
  return since
}

/**
 * express's refresh cookie names: plain, or with the `__Host-` or `__Secure-`
 * prefix it takes when `COOKIE_SECURE` is on.
 */
export const REFRESH_COOKIE_NAME = /^(__Host-|__Secure-)?refreshToken$/

/**
 * The refresh cookie in a response's `Set-Cookie` headers, or `null`.
 * @param headers - The response headers.
 */
function refreshCookieFrom(headers: Headers): LiveSession['refreshCookie'] | null {
  for (const cookie of headers.getSetCookie()) {
    const [pair = '', ...attributes] = cookie.split(';').map((part) => part.trim())
    const split = pair.indexOf('=')
    const name = pair.slice(0, split)
    if (split < 1 || !REFRESH_COOKIE_NAME.test(name)) continue
    const path = attributes.find((attribute) => /^path=/i.test(attribute))?.slice(5) ?? '/'
    return { name, value: pair.slice(split + 1), path }
  }
  return null
}

/**
 * Posts a mailed link's token, with the link's address, to the endpoint that
 * spends it, as the page that opens the link does.
 * @param endpoint - `/auth/link/verify` or `/invitations/confirm`, under /api/v1.
 * @param link - The mailed link.
 * @returns The session it signed in.
 */
async function spendLink(endpoint: string, link: URL): Promise<LiveSession> {
  const response = await fetch(`${API_ORIGIN}/api/v1${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: link.searchParams.get('token'),
      email: link.searchParams.get('email') ?? undefined,
    }),
  })
  const body = (await response.json().catch(() => null)) as {
    data?: { accessToken?: string }
  } | null
  const accessToken = body?.data?.accessToken
  const refreshCookie = refreshCookieFrom(response.headers)
  if (response.status !== 200 || !accessToken || !refreshCookie) {
    throw new Error(`${endpoint} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return { accessToken, refreshCookie }
}

/**
 * Signs `email` in through the API the way a person does: request a link,
 * read it from Mailpit, post its token. The session is kept, unused, for
 * `logIn` and `apiLogin`. Mailpit is a required part of this stack: the link
 * only exists in the email.
 * @param email - The address.
 * @param app - The app the link opens.
 */
async function signInByLink(email: string, app: LinkApp): Promise<LiveSession> {
  const since = await requestSignInLink(email, app)
  const session = await spendLink('/auth/link/verify', await mailedLink(email, '/auth/link', since))
  keptSessions.set(email, { session, app, used: false })
  return session
}

/**
 * Signs `email` in with a link it was mailed, such as the welcome email a
 * staff-created account gets, and keeps the session for `logIn` and
 * `apiLogin`.
 * @param email - The address the link was mailed to.
 * @param link - The mailed `/auth/link` link.
 * @param app - The app the link opens: `web` unless the address is staff.
 */
export async function spendSignInLink(email: string, link: URL, app: LinkApp): Promise<void> {
  keptSessions.set(email, { session: await spendLink('/auth/link/verify', link), app, used: false })
}

/**
 * Makes a customer account at `email`, signed in through a customer-app
 * link: the click creates the account when the address has none. Apex never
 * creates one, so every account that is not staff starts here.
 * @param email - A fresh address.
 */
export async function createUser(email: string): Promise<void> {
  await signInByLink(email, 'web')
}

/**
 * Makes `email` staff at `role` and signs it in through an Apex link. The
 * grant comes first: it creates the account when there is none, and an Apex
 * request for an address with no platform role mails nothing.
 * @param email - The address, fresh or an existing account.
 * @param role - The platform role.
 */
export async function staffSession(email: string, role: MembershipRole): Promise<void> {
  await grantPlatformRole(email, role)
  await signInByLink(email, 'apex')
}

/**
 * Joins `email` to a staff invitation the way the accept page does when it is
 * signed out: the verify answers 202 and mails a confirmation link, which is
 * then followed. The confirm signs the account in, creating it when there is
 * none, and that session replaces any kept one.
 * @param email - The invited address.
 * @param invitationToken - The token from the invitation email.
 */
export async function joinByConfirmation(email: string, invitationToken: string): Promise<void> {
  const since = Date.now()
  const verified = await json(`${API_ORIGIN}/api/v1/invitations/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invitationToken }),
  })
  if (verified.status !== 202) {
    throw new Error(
      `invitation verify did not ask to confirm: ${verified.status} ${JSON.stringify(verified.body)}`
    )
  }
  const session = await spendLink(
    '/invitations/confirm',
    await mailedLink(email, '/invitations/confirm', since)
  )
  keptSessions.set(email, { session, app: 'apex', used: false })
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

/** Polls until the API is ready, failing the test after `timeoutMs`. */
export async function waitForApi(timeoutMs = 60_000): Promise<void> {
  await expect
    .poll(apiIsReady, {
      message: `API at ${API_ORIGIN} did not become ready within ${timeoutMs}ms`,
      intervals: [500],
      timeout: timeoutMs,
    })
    .toBe(true)
}

/** A path that is still part of signing in: the browser has not landed yet. */
const SIGNING_IN = /\/(login|auth\/link)(\?|$)/

/**
 * Signs staff in through the real UI: the email on `/login`, then the mailed
 * link opened in this page, on the page's own origin. The browser itself
 * posts `/auth/link/verify`, so its trace and analytics are the sign-in's.
 * @param page - The page to sign in.
 * @param email - A staff address: an Apex link goes only to one.
 * @throws On a 429, naming `RATE_LIMIT_SCALE`.
 */
export async function logInThroughPage(page: Page, email: string): Promise<void> {
  const since = await linkRequestSlot(email)
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/link/request'
  )
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  const status = (await requested).status()
  if (status === 429) throw new Error(RATE_LIMITED)
  if (status !== 202) throw new Error(`link request failed: ${status}`)
  linkRequested(email)
  await expect(page.getByRole('heading', { name: 'Check your inbox', level: 1 })).toBeVisible()
  const link = await mailedLink(email, '/auth/link', since)
  await page.goto(`${link.pathname}${link.search}`)
  await expect(page).not.toHaveURL(SIGNING_IN, { timeout: 15_000 })
}

/**
 * Leaves `page` signed in as `email`, with a real session and a real refresh
 * cookie. The session `staffSession` or `createUser` kept is used once: its
 * refresh cookie goes into the page's context, and a load restores it, so no
 * second link waits out the mail cooldown. After that, staff sign in through
 * the UI (`logInThroughPage`). A customer gets no Apex link, so a fresh
 * customer-app session through the API stands in for the UI; it lands on
 * `/no-access`.
 * @param page - The page to sign in.
 * @param email - The address.
 */
export async function logIn(page: Page, email: string): Promise<void> {
  let kept = keptSessions.get(email)
  if (kept?.used && kept.app === 'web') {
    await signInByLink(email, 'web')
    kept = keptSessions.get(email)
  }
  if (!kept || kept.used) {
    await logInThroughPage(page, email)
    return
  }
  kept.used = true
  // The origin is the page's own, which may be the dev server or the production image.
  await page.goto('/login')
  const { hostname } = new URL(page.url())
  const { name, value, path } = kept.session.refreshCookie
  await page.context().addCookies([
    {
      name,
      value,
      domain: hostname,
      path,
      httpOnly: true,
      sameSite: 'Strict',
      // A prefixed cookie is dropped without `Secure`.
      secure: name.startsWith('__'),
    },
  ])
  await page.goto('/overview')
  await expect(page).not.toHaveURL(SIGNING_IN, { timeout: 15_000 })
}

/**
 * An access token straight from the API, for requests the browser cannot
 * make for us: the SPA's token lives in memory only (CLAUDE.md). The kept
 * session's, or a new Apex sign-in when there is none.
 * @param email - The address; a staff one when nothing was kept for it.
 */
export async function apiLogin(email: string): Promise<string> {
  const kept = keptSessions.get(email)
  if (kept) return kept.session.accessToken
  return (await signInByLink(email, 'apex')).accessToken
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
 * Gives an address a platform role through express's own bootstrap script:
 * the supported way in, and audited as `platform.member.granted`. It creates
 * the account when the address has none. A session signed in before the
 * grant gets the role at its next refresh.
 */
export async function grantPlatformRole(email: string, role: MembershipRole): Promise<void> {
  await execFile('pnpm', ['platform:grant', email, role], {
    cwd: apiDir('grantPlatformRole (pnpm platform:grant)', 'platform:grant'),
    timeout: 60_000,
  })
}

/** A lowercase, hyphenated slug no earlier run has taken. */
export function freshSlug(): string {
  return `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}

/** Where express sends customer-facing links (its `WEB_URL`), locally the react app. */
export const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5173'

/** Where express sends Apex's links (its `APEX_URL`): this dev server. */
export const APEX_ORIGIN = 'http://localhost:5174'

/**
 * Accepts a customer invitation as an existing account, through the API with
 * its bearer, as the accept page does signed in: the link points at the
 * customer app, which this suite does not run.
 * @param email - The invitee, with a kept session.
 * @param link - The mailed `/invitations/accept?token=` link.
 */
export async function acceptInvitationAs(email: string, link: URL): Promise<void> {
  const accepted = await apiRequest(await apiLogin(email), 'POST', '/invitations/accept', {
    token: link.searchParams.get('token'),
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
    { cwd: apiDir('backdateStepUp (docker compose exec)'), timeout: 30_000 }
  )
}

/**
 * Confirms "Confirm it's you" by email link in the same browser, as staff do:
 * Email me a link in `page`'s open dialog, then the mailed `/auth/confirm`
 * link opened in a second page of `page.context()`, which restores the same
 * session and so may spend the link. That page reports the waiting tab, and
 * the dialog in `page` closes once it has retried the action.
 * @param page - The page whose step-up dialog is open on its choices.
 * @param email - The signed-in staff address the link is mailed to.
 */
export async function confirmStepUpByLink(page: Page, email: string): Promise<void> {
  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  const since = Date.now()
  await stepUp.getByRole('button', { name: 'Email me a link' }).click()
  await expect(stepUp.getByText('We sent the link to', { exact: false })).toBeVisible()
  const link = await mailedLink(email, '/auth/confirm', since)
  const second = await page.context().newPage()
  try {
    await second.goto(`${link.pathname}${link.search}`)
    await expect(second.getByRole('heading', { name: 'Confirmed', level: 1 })).toBeVisible({
      timeout: 15_000,
    })
    await expect(second.getByText('You can close this tab.')).toBeVisible()
  } finally {
    await second.close()
  }
  await expect(stepUp).toBeHidden({ timeout: 15_000 })
}

/**
 * Fails before any test runs, naming the misconfiguration, when the API cannot
 * run the staff suites:
 * - express older than 6.0.0, which has no `POST /auth/step-up/link/request`
 *   (401 without a bearer from 6.0.0, the unknown path's 404 before it);
 * - an email worker that delivers nothing to Mailpit;
 * - `APEX_URL` or `WEB_URL` pointing somewhere other than `APEX_ORIGIN` and
 *   `WEB_ORIGIN`, read from the sign-in links mailed for each `app`;
 * - express older than 1.3.0 (no `GET /platform/emails`) or 1.4.0 (no
 *   `GET /platform/onboarding/funnel`), asked with the Apex leg's staff viewer;
 * - express older than 6.1.0, whose user list drops the `signedIn` filter
 *   unread: the viewer has just signed in, so `signedIn=false` must not list it.
 */
export async function assertApiServesApex(): Promise<void> {
  const stepUp = await json(`${API_ORIGIN}/api/v1/auth/step-up/link/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (stepUp.status === 404) {
    throw new Error(
      `The API at ${API_ORIGIN} has no POST /auth/step-up/link/request: it is older than express 6.0.0, which link sign-in and "Confirm it's you" need.`
    )
  }

  // An Apex link goes only to staff, so the Apex leg's address is granted first; it becomes the viewer below.
  const viewer = freshEmail()
  await grantPlatformRole(viewer, 'viewer')
  let viewerToken = ''
  for (const [app, email, expected, variable] of [
    ['apex', viewer, APEX_ORIGIN, 'APEX_URL'],
    ['web', freshEmail(), WEB_ORIGIN, 'WEB_URL'],
  ] as const) {
    const since = await requestSignInLink(email, app)
    let link: URL
    try {
      link = await mailedLink(email, '/auth/link', since)
    } catch {
      throw new Error(
        `The API at ${API_ORIGIN} mailed nothing to ${MAILPIT_ORIGIN} within 15s: its email worker is not delivering (check its SMTP_* settings and that its workers started).`
      )
    }
    if (link.origin !== expected) {
      throw new Error(
        `The API at ${API_ORIGIN} links app "${app}" to ${link.origin}: start it with ${variable}=${expected}.`
      )
    }
    if (app === 'apex') {
      const session = await spendLink('/auth/link/verify', link)
      keptSessions.set(email, { session, app, used: false })
      viewerToken = session.accessToken
    }
  }

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
  const neverSignedIn = await apiRequest(
    viewerToken,
    'GET',
    `/platform/users?signedIn=false&search=${encodeURIComponent(viewer)}`
  )
  const rows = (neverSignedIn.body as { data?: { items?: unknown[] } } | null)?.data?.items
  if (neverSignedIn.status !== 200 || rows === undefined || rows.length !== 0) {
    throw new Error(
      `The API at ${API_ORIGIN} ignores GET /platform/users?signedIn: it is older than express 6.1.0, which the Users page's "Signed in" filter needs.`
    )
  }
}

/**
 * A tenant's id, found by its slug with a staff token.
 * @param token - A staff access token.
 * @param slug - The tenant's slug, unique among live tenants.
 */
export async function tenantIdOf(token: string, slug: string): Promise<string> {
  const found = await apiRequest(
    token,
    'GET',
    `/platform/tenants?search=${encodeURIComponent(slug)}`
  )
  const tenants = (found.body as { data?: { items?: { id: string; slug: string }[] } } | null)?.data
    ?.items
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
 * email whose link carries no token, such as an onboarding reminder's.
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
 * token. `search` matches the recipient by substring, so the exact address is
 * filtered here too.
 * @param token - A staff access token.
 * @param recipient - The address the emails went to.
 */
async function emailsTo(token: string, recipient: string): Promise<EmailRow[]> {
  const found = await apiRequest(
    token,
    'GET',
    `/platform/emails?search=${encodeURIComponent(recipient)}&limit=50`
  )
  if (found.status !== 200) {
    throw new Error(`email search failed: ${found.status} ${JSON.stringify(found.body)}`)
  }
  const { items } = (found.body as { data: { items: EmailRow[] } }).data
  return items.filter((email) => email.recipient.toLowerCase() === recipient.toLowerCase())
}

/**
 * Polls until an email to `recipient` from `templateKey`, other than the ones
 * in `except`, is listed, and returns its id. A fresh account already has the
 * sign-in link it was made with, so the template, not the position, picks the message.
 * @param token - A staff access token.
 * @param recipient - The address.
 * @param templateKey - e.g. `sign_in_link`.
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
    { cwd: apiDir('fireEmailEvent (pnpm email:fire-event)', 'email:fire-event'), timeout: 60_000 }
  )
}
