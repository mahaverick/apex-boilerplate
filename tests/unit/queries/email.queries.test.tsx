import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { auditKeys } from '@/queries/audit.queries'
import {
  emailHealthQueryOptions,
  emailKeys,
  emailPreviewQueryOptions,
  emailQueryOptions,
  emailsQueryOptions,
  emailSuppressionsQueryOptions,
  useLiftSuppression,
  useResendEmail,
} from '@/queries/email.queries'
import { invalidateDirectory } from '@/queries/platform.queries'
import { useCreatePlatformTenant } from '@/queries/tenant-admin.queries'
import { tenantKeys, useInviteMember, useResendInvitation } from '@/queries/tenant.queries'
import { userAdminKeys, useSendPasswordSetup } from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import { EMAIL_ID, INVITATION_ID, SUPPRESSION_ID, TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import {
  emailDetail,
  fail,
  ok,
  testEmailHealth,
  testEmailPreview,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Every email cache a write can make stale. */
const EMAIL_KEYS: QueryKey[] = [
  emailKeys.list({ limit: 20 }),
  emailKeys.list({ userId: USER_ID_2, limit: 10 }),
  emailKeys.health('7d'),
  emailKeys.detail(EMAIL_ID),
  emailKeys.preview(EMAIL_ID),
  emailKeys.suppressions({ limit: 20 }),
]

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function seeded(keys: QueryKey[]): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const key of keys) client.setQueryData(key, {})
  return client
}

function expectStale(client: QueryClient, keys: QueryKey[]) {
  for (const key of keys) {
    expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
  }
}

beforeEach(() => {
  resetSessionForTests()
  useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
})

describe('email reads', () => {
  it('sends only the filters that are set, with the API parameter names', async () => {
    let seen: URLSearchParams | undefined
    server.use(
      http.get('/api/v1/platform/emails', ({ request }) => {
        seen = new URL(request.url).searchParams
        return ok({ messages: [], nextCursor: null, prevCursor: null }, 'Emails retrieved.')
      })
    )
    await new QueryClient().fetchQuery(
      emailsQueryOptions({
        q: '  cleo@ ',
        status: 'bounced',
        template: 'tenant_invitation',
        from: '2026-09-01',
        to: '2026-09-30',
        cursor: 'c1',
        direction: 'prev',
      })
    )
    expect(Object.fromEntries(seen!)).toEqual({
      q: 'cleo@',
      status: 'bounced',
      template: 'tenant_invitation',
      from: '2026-09-01',
      to: '2026-09-30',
      cursor: 'c1',
      direction: 'prev',
      limit: '20',
    })
  })

  it('sends no direction without a cursor, and a blank search as none', async () => {
    let seen: URLSearchParams | undefined
    server.use(
      http.get('/api/v1/platform/emails', ({ request }) => {
        seen = new URL(request.url).searchParams
        return ok({ messages: [], nextCursor: null, prevCursor: null }, 'Emails retrieved.')
      })
    )
    await new QueryClient().fetchQuery(
      emailsQueryOptions({ q: '   ', userId: USER_ID_2, direction: 'prev', limit: 10 })
    )
    expect(Object.fromEntries(seen!)).toEqual({ userId: USER_ID_2, limit: '10' })
  })

  it('answers every read from the default handlers, so a page that embeds one needs no setup', async () => {
    const client = new QueryClient()
    await expect(client.fetchQuery(emailsQueryOptions({}))).resolves.toEqual({
      messages: [],
      nextCursor: null,
      prevCursor: null,
    })
    await expect(client.fetchQuery(emailHealthQueryOptions('7d'))).resolves.toEqual(testEmailHealth)
    await expect(client.fetchQuery(emailQueryOptions(EMAIL_ID))).resolves.toEqual(
      emailDetail({ id: EMAIL_ID })
    )
    await expect(client.fetchQuery(emailPreviewQueryOptions(EMAIL_ID))).resolves.toEqual(
      testEmailPreview
    )
    await expect(client.fetchQuery(emailSuppressionsQueryOptions({}))).resolves.toEqual({
      suppressions: [],
      nextCursor: null,
      prevCursor: null,
    })
  })

  it('sends the suppression state filter and the health range', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/platform/email-suppressions', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok({ suppressions: [], nextCursor: null, prevCursor: null }, 'OK')
      }),
      http.get('/api/v1/platform/emails/health', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok({ ...testEmailHealth, range: '30d' }, 'OK')
      })
    )
    const client = new QueryClient()
    await client.fetchQuery(emailSuppressionsQueryOptions({ state: 'lifted', q: 'acme' }))
    await client.fetchQuery(emailHealthQueryOptions('30d'))
    expect(seen.map((params) => Object.fromEntries(params))).toEqual([
      { q: 'acme', state: 'lifted', limit: '20' },
      { range: '30d' },
    ])
  })

  it.each([
    ['a 404', 404, undefined],
    ['a 409 template_unavailable', 409, 'template_unavailable'],
  ])('asks for a preview once on %s', async (_name, status, code) => {
    let calls = 0
    server.use(
      http.get(`/api/v1/platform/emails/${EMAIL_ID}/preview`, () => {
        calls += 1
        return fail('No preview', status, code)
      })
    )
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    await expect(client.fetchQuery(emailPreviewQueryOptions(EMAIL_ID))).rejects.toBeDefined()
    expect(calls).toBe(1)
  })

  it('asks for a message once on a 404', async () => {
    let calls = 0
    server.use(
      http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () => {
        calls += 1
        return fail('Not found', 404)
      })
    )
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    await expect(client.fetchQuery(emailQueryOptions(EMAIL_ID))).rejects.toBeDefined()
    expect(calls).toBe(1)
  })
})

describe('email writes', () => {
  it('resends with the reason, then refreshes every email query, the logs and the tenant pages', async () => {
    let body: unknown
    server.use(
      http.post(`/api/v1/platform/emails/${EMAIL_ID}/resend`, async ({ request }) => {
        body = await request.json()
        return ok({ emailSent: false }, 'Resend requested.', 202)
      })
    )
    const others = [
      auditKeys.platform({}),
      tenantKeys.invitations('acme'),
      userAdminKeys.detail(USER_ID_2),
    ]
    const client = seeded([...EMAIL_KEYS, ...others])
    const { result } = renderHook(() => useResendEmail(), { wrapper: wrapperWith(client) })
    result.current.mutate({ id: EMAIL_ID, reason: 'Lost in spam' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ reason: 'Lost in spam' })
    expect(result.current.data).toEqual({ emailSent: false })
    expectStale(client, [...EMAIL_KEYS, ...others])
  })

  it('lifts with the reason, and refreshes the email queries even when someone lifted it first', async () => {
    let body: unknown
    server.use(
      http.post(
        `/api/v1/platform/email-suppressions/${SUPPRESSION_ID}/lift`,
        async ({ request }) => {
          body = await request.json()
          return fail('This suppression was already lifted.', 409, 'already_lifted')
        }
      )
    )
    const client = seeded([...EMAIL_KEYS, auditKeys.platform({})])
    const { result } = renderHook(() => useLiftSuppression(), { wrapper: wrapperWith(client) })
    result.current.mutate({ id: SUPPRESSION_ID, reason: 'Mailbox fixed' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(body).toEqual({ reason: 'Mailbox fixed' })
    await waitFor(() => expectStale(client, [...EMAIL_KEYS, auditKeys.platform({})]))
  })
})

describe('email queries go stale with the directory', () => {
  it('invalidateDirectory marks every email query stale', async () => {
    const client = seeded(EMAIL_KEYS)
    await invalidateDirectory(client)
    expectStale(client, EMAIL_KEYS)
  })

  it('a set-password mail refreshes the email queries and the platform log', async () => {
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/password-setup`, () =>
        ok({ emailSent: true }, 'Password setup email sent.')
      )
    )
    const client = seeded([...EMAIL_KEYS, auditKeys.platform({ targetId: USER_ID_2 })])
    const { result } = renderHook(() => useSendPasswordSetup(), { wrapper: wrapperWith(client) })
    result.current.mutate({ userId: USER_ID_2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expectStale(client, [...EMAIL_KEYS, auditKeys.platform({ targetId: USER_ID_2 })])
  })

  it('an invitation resend refreshes the email queries and both audit logs', async () => {
    server.use(
      http.post(`/api/v1/tenants/acme/invitations/${INVITATION_ID}/resend`, () =>
        ok(null, 'If that address can be invited, an invitation has been sent.', 202)
      )
    )
    const logs = [auditKeys.platform({}), auditKeys.tenant('acme', {})]
    const client = seeded([...EMAIL_KEYS, ...logs, tenantKeys.invitations('acme')])
    const { result } = renderHook(() => useResendInvitation('acme'), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate(INVITATION_ID)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await waitFor(() =>
      expectStale(client, [...EMAIL_KEYS, ...logs, tenantKeys.invitations('acme')])
    )
  })

  it('an invitation sent refreshes the email queries; a refused one does not', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', async ({ request }) => {
        const { email } = (await request.json()) as { email: string }
        return email === 'taken@acme.test'
          ? fail('Already a member.', 409, 'already_member')
          : ok(null, 'If that address can be invited, an invitation has been sent.', 202)
      })
    )
    const refused = seeded(EMAIL_KEYS)
    const first = renderHook(() => useInviteMember('acme'), { wrapper: wrapperWith(refused) })
    first.result.current.mutate({ email: 'taken@acme.test', role: 'viewer' })
    await waitFor(() => expect(first.result.current.isError).toBe(true))
    for (const key of EMAIL_KEYS) expect(refused.getQueryState(key)?.isInvalidated).toBe(false)

    const logs = [auditKeys.platform({}), auditKeys.tenant('acme', {})]
    const sent = seeded([...EMAIL_KEYS, ...logs])
    const second = renderHook(() => useInviteMember('acme'), { wrapper: wrapperWith(sent) })
    second.result.current.mutate({ email: 'new@acme.test', role: 'viewer' })
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    await waitFor(() => expectStale(sent, [...EMAIL_KEYS, ...logs]))
  })

  it('a staff-created tenant, which mails its owner an invitation, refreshes the email queries and the audit logs', async () => {
    server.use(
      http.post('/api/v1/platform/tenants', () =>
        ok(
          { tenant: { id: TENANT_ID, name: 'Acme Corp', slug: 'acme' }, emailSent: true },
          'Tenant created.',
          201
        )
      )
    )
    const logs = [auditKeys.platform({}), auditKeys.tenant('acme', {})]
    const client = seeded([...EMAIL_KEYS, ...logs])
    const { result } = renderHook(() => useCreatePlatformTenant(), { wrapper: wrapperWith(client) })
    result.current.mutate({ name: 'Acme Corp', slug: 'acme', ownerEmail: 'olive@acme.test' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expectStale(client, [...EMAIL_KEYS, ...logs])
  })
})
