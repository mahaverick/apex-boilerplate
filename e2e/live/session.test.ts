import { expect, test, type APIRequestContext } from '@playwright/test'
import { mailedLink } from '../capture/mailpit'
import {
  API_ORIGIN,
  apiIsReady,
  freshEmail,
  logIn,
  REFRESH_COOKIE_NAME,
  requestSignInLink,
  staffSession,
  waitForApi,
} from './helpers'

/**
 * Session behaviours that need a real server, a real cookie jar and a real
 * reload to verify — each is also unit-tested, but a real reload is
 * something no unit-test harness can provide.
 *
 * Requires a live express-boilerplate on :4040 plus its docker services, so
 * the whole file is skipped unless `E2E_LIVE=1`. Run it with
 * `pnpm test:e2e:live`.
 */

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start it first: cd ../express-boilerplate && docker compose up -d && pnpm db:migrate && pnpm dev`
    )
  }
})

/**
 * The access token is memory-only by design (CLAUDE.md), so a reload starts
 * unauthenticated and the root route's beforeLoad has to restore the
 * session from the refresh cookie before any guard runs. If that ordering
 * is wrong the reader is bounced to /login. The user is staff so that the
 * test can assert the overview itself: a non-staff user lands on /no-access
 * either way, which says less.
 */
test('a reload keeps a staff user signed in on the overview, and refreshes exactly once', async ({
  page,
}) => {
  const email = freshEmail()
  await staffSession(email, 'viewer')
  await logIn(page, email)
  await expect(page).toHaveURL(/\/overview(\?|$)/)

  const refreshes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/auth/refresh')) refreshes.push(request.url())
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page).toHaveURL(/\/overview(\?|$)/)

  // Exactly one: `ensureSession()` is the only caller of /auth/refresh, and its single-flight wrapper turns N concurrent 401s into one refresh.
  expect(refreshes).toHaveLength(1)
})

/**
 * Signs a fresh address in by its mailed customer-app link, posting the
 * verify from `request` with `headers`, and returns the refresh cookie's raw
 * `Set-Cookie` line. A fresh address each time: express mails one address one
 * link a minute.
 */
async function signInCookie(
  request: APIRequestContext,
  headers: Record<string, string> = {}
): Promise<string | undefined> {
  const email = freshEmail()
  const link = await mailedLink(email, '/auth/link', await requestSignInLink(email, 'web'))
  const response = await request.post(`${API_ORIGIN}/api/v1/auth/link/verify`, {
    headers,
    data: { token: link.searchParams.get('token'), email },
  })
  expect(response.status()).toBe(200)
  return response
    .headersArray()
    .find(
      (h) =>
        h.name.toLowerCase() === 'set-cookie' &&
        REFRESH_COOKIE_NAME.test(h.value.split('=', 1)[0] ?? '')
    )?.value
}

test('the refresh cookie is scoped and flagged as the SPA assumes', async ({ request }) => {
  await waitForApi()

  const cookie = await signInCookie(request)
  expect(cookie).toBeTruthy()

  // Path is the one the SPA depends on surviving the proxy.
  expect(cookie).toMatch(/refreshToken=/)
  expect(cookie).toMatch(/Path=\/api\/v1\/auth/)
  expect(cookie).toMatch(/HttpOnly/i)
  expect(cookie).toMatch(/SameSite=Strict/i)

  /**
   * `X-Forwarded-Proto` does NOT drive this cookie's Secure flag: express's
   * `isCookieSecure(env)` (env.config.ts) returns
   * `COOKIE_SECURE ?? APP_ENV !== 'local'` and never reads `req.secure`, so
   * no request header can change it.
   *
   * TRUST_PROXY decides how much of X-Forwarded-For to believe for
   * `req.ip`, which the IP-keyed rate limiters consume. With
   * X-Forwarded-Proto it also decides `req.secure`, which only the OAuth
   * session cookie depends on: express-session silently skips a Secure
   * cookie on a non-HTTPS request.
   */
  const forwardedCookie = await signInCookie(request, { 'X-Forwarded-Proto': 'https' })
  expect(forwardedCookie).toBeTruthy()
  expect(forwardedCookie).not.toMatch(/;\s*Secure/i)

  // Neither cookie is Secure under APP_ENV=local with COOKIE_SECURE unset, which is how express's .env.example sets up the live backend: a browser refuses a Secure cookie over http://, so a hard-coded true would make local cookie sign-in impossible.
  expect(cookie).not.toMatch(/;\s*Secure/i)
})
