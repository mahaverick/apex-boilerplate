import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  createVerifiedUser,
  freshEmail,
  grantPlatformRole,
  logIn,
  PASSWORD,
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
  await createVerifiedUser(email)
  await grantPlatformRole(email, 'viewer')
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

  // EXACTLY one: `ensureSession()` is the only caller of /auth/refresh, and its single-flight wrapper is what makes N concurrent 401s produce one refresh.
  expect(refreshes).toHaveLength(1)
})

test('the refresh cookie is scoped and flagged as the SPA assumes', async ({ request }) => {
  const email = freshEmail()
  await createVerifiedUser(email)
  await waitForApi()

  const response = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(response.status()).toBe(200)
  const cookie = response.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value
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
   * no request header can change it. Sending the header changes nothing,
   * which is what this asserts.
   *
   * TRUST_PROXY decides how much of X-Forwarded-For to believe for
   * `req.ip`, which the IP-keyed rate limiters consume. With
   * X-Forwarded-Proto it also decides `req.secure`, which only the OAuth
   * session cookie depends on: express-session silently skips a Secure
   * cookie on a non-HTTPS request.
   */
  const forwarded = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    headers: { 'X-Forwarded-Proto': 'https' },
    data: { email, password: PASSWORD },
  })
  expect(forwarded.status()).toBe(200)
  const forwardedCookie = forwarded
    .headersArray()
    .find((h) => h.name.toLowerCase() === 'set-cookie')?.value
  expect(forwardedCookie).not.toMatch(/;\s*Secure/i)

  // And neither cookie is Secure under APP_ENV=local with COOKIE_SECURE unset, which is how express's .env.example sets the live backend up. That is deliberate: a browser refuses a Secure cookie over http://, so a hard-coded true would make local cookie login impossible.
  expect(cookie).not.toMatch(/;\s*Secure/i)
})
