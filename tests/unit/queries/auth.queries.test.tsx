import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  useForgotPassword,
  useRegister,
  useResendVerification,
  useRevokeOtherSessions,
} from '@/queries/auth.queries'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  )
}

/** Record the JSON body of the next POST to `path`. */
function captureBody(path: string): { body?: unknown } {
  const seen: { body?: unknown } = {}
  server.use(
    http.post(`/api/v1${path}`, async ({ request }) => {
      seen.body = await request.json()
      return ok(null, 'Accepted.', 202)
    })
  )
  return seen
}

describe('Apex auth mutations send app: "apex"', () => {
  it('on register', async () => {
    const seen = captureBody('/auth/register')
    const { result } = renderHook(() => useRegister(), { wrapper })
    await act(() => result.current.mutateAsync({ email: 'a@b.com', password: 'longenough1' }))
    expect(seen.body).toMatchObject({ email: 'a@b.com', app: 'apex' })
  })

  it('on forgot-password', async () => {
    const seen = captureBody('/auth/forgot-password')
    const { result } = renderHook(() => useForgotPassword(), { wrapper })
    await act(() => result.current.mutateAsync({ email: 'a@b.com' }))
    expect(seen.body).toEqual({ email: 'a@b.com', app: 'apex' })
  })

  it('on resend-verification', async () => {
    const seen = captureBody('/auth/resend-verification')
    const { result } = renderHook(() => useResendVerification(), { wrapper })
    await act(() => result.current.mutateAsync({ email: 'a@b.com' }))
    expect(seen.body).toEqual({ email: 'a@b.com', app: 'apex' })
  })
})

describe('useRevokeOtherSessions', () => {
  // The API spares only the chain its refresh cookie names: without the cookie it keeps the whole session, the caller's other tabs' siblings included.
  it('posts an empty JSON body with credentials, so the refresh cookie travels, and answers the count', async () => {
    const seen: { body?: string; contentType?: string | null; credentials?: string } = {}
    server.use(
      http.post('/api/v1/auth/sessions/revoke-others', async ({ request }) => {
        seen.body = await request.text()
        seen.contentType = request.headers.get('content-type')
        seen.credentials = request.credentials
        return ok({ revoked: 2 }, 'Other sessions signed out.')
      })
    )
    const { result } = renderHook(() => useRevokeOtherSessions(), { wrapper })
    const answer = await act(() => result.current.mutateAsync())
    expect(answer).toEqual({ revoked: 2 })
    expect(seen).toEqual({
      body: '{}',
      contentType: 'application/json',
      credentials: 'include',
    })
  })
})
