import type { Page, Route } from '@playwright/test'
import { afterPageTask } from '../timing'

/** The policy nginx.conf sends, character for character. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

/** Every security header nginx.conf adds when the response does not already carry it, with its exact value. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
}

/**
 * Collects every CSP violation on `page` from now on, across navigations. The
 * listener is an init script, so it is in place before any of a document's own
 * scripts run. Console errors naming the policy are collected as well, so a
 * violation can appear in the list twice.
 * @returns The live list, which fills as violations arrive.
 */
export async function watchCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(message.text())
    }
  })
  await page.exposeFunction('reportCspViolation', (violation: string) => {
    violations.push(violation)
  })
  await page.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        const report = (window as unknown as { reportCspViolation: (v: string) => Promise<void> })
          .reportCspViolation
        void report(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`)
      },
      true
    )
  })
  return violations
}

/** Where the nginx project's container is expected to be serving. */
const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

/**
 * Fails fast, with the command to run, when no container is serving. Suites
 * register it with `beforeEach`, not `beforeAll`: under `fullyParallel`,
 * Playwright batches a file's tests that share a `beforeAll` into one chunk
 * per worker, which ran the slowest analytics tests back to back on one
 * worker while the others sat idle.
 */
export async function requireServedApp(): Promise<void> {
  const served = await fetch(APP_ORIGIN).catch(() => null)
  if (!served?.ok) {
    throw new Error(
      `No app at ${APP_ORIGIN}. Build and run the image: docker build -t apex-boilerplate:e2e . && docker run -d --name apex-e2e -p 8088:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 -e POSTHOG_KEY=phc_test_key_not_real -e APP_ENVIRONMENT=ci -e ANALYTICS_HANDOFF_ORIGINS=https://www.example.test apex-boilerplate:e2e`
    )
  }
}

/**
 * Waits for one task to run in the page, so a violation the page reported
 * earlier has reached the collected list. Call it before asserting on the list.
 */
export async function flushCspReports(page: Page): Promise<void> {
  await afterPageTask(page)
}

/**
 * Answers the sign-in link page's route chunk (`/auth/link`) with `answer`,
 * and every other script as the server does. The chunk is found by its text,
 * not its name: the build also emits the router's own `link-<hash>.js`, which
 * every page needs.
 * @param page - The page whose script requests are routed.
 * @param answer - What to do with the route chunk's request.
 */
export async function routeSignInLinkChunk(
  page: Page,
  answer: (route: Route) => Promise<void>
): Promise<void> {
  await page.route(/\/assets\/link-[\w-]+\.js$/, async (route) => {
    const response = await route.fetch()
    if ((await response.text()).includes('Signing you in')) {
      await answer(route)
      return
    }
    await route.fulfill({ response })
  })
}
