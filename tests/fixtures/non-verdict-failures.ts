import { HttpResponse } from 'msw'
import { fail } from '@/tests/mocks/handlers'

/**
 * Every way `POST /auth/refresh` can fail without judging the caller's
 * credentials. None of these may end a session; `isAuthVerdict`
 * (`src/http/session.ts`) accepts a 401 and a session-identity change, and
 * nothing else.
 *
 * One table serves both halves of that rule: `session.test.ts` asserts none
 * of these clears the store, and `interceptors.test.ts` asserts none of them
 * redirects to /login. A session left intact by `session.ts` but bounced to
 * the login page from the interceptor is signed out just the same, so a case
 * added here must be pinned on both sides at once.
 *
 * Why each entry is not a verdict:
 * - **502 / 503**: nginx through a rolling restart or a dead upstream. A
 *   logout here would sign out every user whose tab refreshed its session
 *   during a deploy.
 * - **429**: `/auth/refresh` is rate limited (`auth.routes.ts`), and every
 *   open tab refreshes on its own — so ordinary traffic can manufacture the
 *   429 that would end the session.
 * - **A 200 carrying HTML**: `rejectMalformedJsonResponse`
 *   (`src/http/interceptors.ts`) throws an `AxiosError` that CARRIES a
 *   response, so a poisoned cache entry or a misrouted proxy response would
 *   look exactly like an auth verdict to any predicate that only checks
 *   `response !== undefined`.
 */
export const NON_VERDICT_FAILURES: [string, () => Response][] = [
  ['a 502 from an upstream gateway mid-deploy', () => fail('Bad Gateway', 502)],
  ['a 503 from a restarting upstream', () => fail('Service Unavailable', 503)],
  ['a 429 from the refresh rate limiter', () => fail('Too Many Requests', 429)],
  [
    'a malformed 200 carrying HTML',
    () =>
      new HttpResponse('<!doctype html><title>nope</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  ],
]
