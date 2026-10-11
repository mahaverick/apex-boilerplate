/**
 * @file The multi-frontend seam: a second frontend on another origin calling
 * this API through the container, not this SPA's own traffic, which is
 * same-origin and sends no preflight.
 */
import { expect, test } from '@playwright/test'
import { API_ORIGIN, apiIsReady } from '../live/helpers'

/** Where the container serves the app: `E2E_NGINX_ORIGIN`, default :8088. */
const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

test.skip(process.env.E2E_LIVE !== '1', 'needs the nginx container — run pnpm test:e2e:nginx')

test.beforeAll(async () => {
  if (!(await apiIsReady())) throw new Error(`No API at ${API_ORIGIN}`)
})

test('withholds the grant header from an origin that is not allowed', async ({ request }) => {
  const response = await request.fetch(`${APP_ORIGIN}/api/v1/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'POST' },
  })
  expect(response.headers()['access-control-allow-origin']).toBeUndefined()
})
