import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '../hermetic'
import { restoreSession } from '../live/helpers'
import { settle } from '../timing'

/**
 * `restoreSession` (e2e/live/helpers.ts) against a stand-in server whose
 * `POST /api/v1/auth/refresh` holds its answer until the test releases it.
 * The refresh spends the injected cookie, so the helper must not return before
 * the rotated cookie is in the context: a page closed earlier keeps the spent
 * one, and its next use, after express's 10-second grace, is a replay that
 * revokes the session.
 */

/** The page both `/login` and `/overview` serve: it refreshes once, as the SPA's boot does. */
const BOOT_PAGE =
  '<!doctype html><title>Boot</title><script>fetch("/api/v1/auth/refresh", { method: "POST" })</script>'

/** A server whose refresh with a cookie waits for `release`, and what it saw. */
function holdingServer() {
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
        .end('{}')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(BOOT_PAGE)
  }
  const server = createServer((request, response) => void handle(request, response))
  return { server, seen, release: () => gate.open?.() }
}

test('returns only once the rotated refresh cookie has replaced the injected one', async ({
  browser,
}) => {
  const { server, seen, release } = holdingServer()
  // Bound to 127.0.0.1: on macOS a `::` bind can take a port another process holds there.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` })
  try {
    const page = await context.newPage()
    let done = false
    const restoring = restoreSession(page, {
      name: 'refreshToken',
      value: 'injected',
      path: '/api/v1/auth',
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
  } finally {
    release()
    await context.close()
    server.close()
  }
})
