import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser } from '@playwright/test'
import { expect, test } from '../hermetic'
import { restoreSession } from '../live/helpers'
import { settle } from '../timing'

/**
 * `restoreSession` (e2e/live/helpers.ts) against a stand-in server whose
 * `POST /api/v1/auth/refresh` holds its answer until the test releases it.
 * The refresh spends the injected cookie, so the helper must not return before
 * the rotated cookie is in the context: a page closed earlier keeps the spent
 * one, and its next use, after express's 10-second grace, is a replay that
 * revokes the session. The refreshed session must also be the restored
 * session's own user.
 */

/** The page both `/login` and `/overview` serve: it refreshes once, as the SPA's boot does. */
const BOOT_PAGE =
  '<!doctype html><title>Boot</title><script>fetch("/api/v1/auth/refresh", { method: "POST" })</script>'

/** The cookie the tests inject. */
const INJECTED = { name: 'refreshToken', value: 'injected', path: '/api/v1/auth' }

/**
 * An unsigned JWT-shaped token for `sub`: `restoreSession` reads the claim, never the signature.
 * @param sub - The user it names.
 */
function tokenFor(sub: string): string {
  return `${base64urlJson({ alg: 'none' })}.${base64urlJson({ sub })}.`
}

/**
 * One JWT segment: `value` as base64url JSON.
 * @param value - The segment's object.
 */
function base64urlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/**
 * A server whose refresh with a cookie waits for `release`, then answers a
 * token for `refreshedSub`, and the `Cookie` headers it saw.
 * @param refreshedSub - The user the rotated session belongs to.
 */
function holdingServer(refreshedSub: string) {
  const gate: { open?: () => void } = {}
  const released = new Promise<void>((resolve) => {
    gate.open = resolve
  })
  const seen: string[] = []
  /** Answers one request. */
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'POST' && request.url === '/api/v1/auth/refresh') {
      const cookie = request.headers.cookie ?? ''
      seen.push(cookie)
      if (!cookie) {
        response.writeHead(401, { 'Content-Type': 'application/json' }).end('{}')
        return
      }
      await released
      response
        .writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'refreshToken=rotated; Path=/api/v1/auth; HttpOnly; SameSite=Strict',
        })
        .end(JSON.stringify({ data: { accessToken: tokenFor(refreshedSub) } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(BOOT_PAGE)
  }
  const server = createServer((request, response) => void handle(request, response))
  return { server, seen, release: () => gate.open?.() }
}

/**
 * Runs `body` against a started `holdingServer` in a fresh context, then
 * releases the server, closes the context and stops the server.
 */
async function withServer(
  browser: Browser,
  refreshedSub: string,
  body: (
    held: ReturnType<typeof holdingServer>,
    context: Awaited<ReturnType<Browser['newContext']>>
  ) => Promise<void>
): Promise<void> {
  const held = holdingServer(refreshedSub)
  // Bound to 127.0.0.1: on macOS a `::` bind can take a port another process holds there.
  await new Promise<void>((resolve) => held.server.listen(0, '127.0.0.1', resolve))
  const { port } = held.server.address() as AddressInfo
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` })
  try {
    await body(held, context)
  } finally {
    held.release()
    await context.close()
    held.server.close()
  }
}

test('returns only once the rotated refresh cookie has replaced the injected one', async ({
  browser,
}) => {
  await withServer(browser, 'user-1', async ({ seen, release }, context) => {
    const page = await context.newPage()
    let done = false
    const restoring = restoreSession(page, {
      accessToken: tokenFor('user-1'),
      refreshCookie: INJECTED,
    }).finally(() => {
      done = true
    })

    await expect.poll(() => seen).toContain('refreshToken=injected')
    await settle(500, 'a promise that stays pending has no event to wait on')
    expect(done, 'returned while the refresh that spent the cookie was unanswered').toBe(false)

    release()
    await restoring
    const cookies = await context.cookies()
    expect(cookies.find((cookie) => cookie.name === 'refreshToken')?.value).toBe('rotated')
  })
})

test('fails when the refresh signs in a different user than the restored session', async ({
  browser,
}) => {
  await withServer(browser, 'someone-else', async ({ release }, context) => {
    const page = await context.newPage()
    release()
    await expect(
      restoreSession(page, { accessToken: tokenFor('user-1'), refreshCookie: INJECTED })
    ).rejects.toThrow('the refresh signed in a different user than the session it restored')
  })
})
