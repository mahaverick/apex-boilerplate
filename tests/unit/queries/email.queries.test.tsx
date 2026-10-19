import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { platformAuditListOptions, tenantAuditListOptions } from '@/queries/audit.queries'
import {
  emailHealthQueryOptions,
  emailKeys,
  emailPreviewQueryOptions,
  emailQueryOptions,
  emailsListOptions,
  emailsSearchSchema,
  suppressionsListOptions,
  useLiftSuppression,
  useResendEmail,
} from '@/queries/email.queries'
import { invalidateDirectory } from '@/queries/platform.queries'
import { useCreatePlatformTenant } from '@/queries/tenant-admin.queries'
import { useInviteMember, useResendInvitation } from '@/queries/tenant-writes.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { userAdminKeys, useSendSignInLink } from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import { EMAIL_ID, INVITATION_ID, SUPPRESSION_ID, TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
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
  emailsListOptions({}).queryKey,
  emailsListOptions({ user: USER_ID_2, limit: 10 }, { total: false }).queryKey,
  emailKeys.health('7d'),
  emailKeys.detail(EMAIL_ID),
  emailKeys.preview(EMAIL_ID),
  suppressionsListOptions({}).queryKey,
]

/** A provider around `client`, so the test can read the cache a hook wrote. */
function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** A client with query retry off and an empty entry cached under each of `keys`. */
function seeded(keys: QueryKey[]): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const key of keys) client.setQueryData(key, {})
  return client
}

/** Asserts each of `keys` is marked invalidated in `client`. */
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
  it('answers every read from the default handlers, so a page that embeds one needs no setup', async () => {
    const client = new QueryClient()
    await expect(client.fetchQuery(emailsListOptions({}))).resolves.toEqual(listPage([]))
    await expect(client.fetchQuery(emailHealthQueryOptions('7d'))).resolves.toEqual(testEmailHealth)
    await expect(client.fetchQuery(emailQueryOptions(EMAIL_ID))).resolves.toEqual(
      emailDetail({ id: EMAIL_ID })
    )
    await expect(client.fetchQuery(emailPreviewQueryOptions(EMAIL_ID))).resolves.toEqual(
      testEmailPreview
    )
    await expect(client.fetchQuery(suppressionsListOptions({}))).resolves.toEqual(listPage([]))
  })

  it('asks for the total on the first page unless the read opts out', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/platform/emails', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([]), 'Emails retrieved.')
      })
    )
    const client = new QueryClient()
    await client.fetchQuery(emailsListOptions({ user: USER_ID_2, limit: 10 }))
    await client.fetchQuery(emailsListOptions({ user: USER_ID_2, limit: 10 }, { total: false }))
    expect(seen.map((params) => Object.fromEntries(params))).toEqual([
      { user: USER_ID_2, limit: '10', total: '1' },
      { user: USER_ID_2, limit: '10' },
    ])
  })

  it('sends the health range', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/platform/emails/health', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok({ ...testEmailHealth, range: '30d' }, 'OK')
      })
    )
    await new QueryClient().fetchQuery(emailHealthQueryOptions('30d'))
    expect(seen.map((params) => Object.fromEntries(params))).toEqual([{ range: '30d' }])
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
      platformAuditListOptions({}).queryKey,
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

  it('a refused resend still refreshes the email queries, and leaves the platform log alone', async () => {
    server.use(
      http.post(`/api/v1/platform/emails/${EMAIL_ID}/resend`, () =>
        fail('This address is suppressed.', 409, 'recipient_suppressed')
      )
    )
    const client = seeded([...EMAIL_KEYS, platformAuditListOptions({}).queryKey])
    const { result } = renderHook(() => useResendEmail(), { wrapper: wrapperWith(client) })
    result.current.mutate({ id: EMAIL_ID, reason: 'Lost in spam' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    await waitFor(() => expectStale(client, EMAIL_KEYS))
    expect(client.getQueryState(platformAuditListOptions({}).queryKey)?.isInvalidated).toBe(false)
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
    const client = seeded([...EMAIL_KEYS, platformAuditListOptions({}).queryKey])
    const { result } = renderHook(() => useLiftSuppression(), { wrapper: wrapperWith(client) })
    result.current.mutate({ id: SUPPRESSION_ID, reason: 'Mailbox fixed' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(body).toEqual({ reason: 'Mailbox fixed' })
    await waitFor(() => expectStale(client, [...EMAIL_KEYS, platformAuditListOptions({}).queryKey]))
  })
})

describe('email queries go stale with the directory', () => {
  it('invalidateDirectory marks every email query stale', async () => {
    const client = seeded(EMAIL_KEYS)
    await invalidateDirectory(client)
    expectStale(client, EMAIL_KEYS)
  })

  it('a staff sign-in link refreshes the email queries and the platform log', async () => {
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/sign-in-link`, () =>
        ok({ emailSent: true }, 'Sign-in link sent.')
      )
    )
    const client = seeded([...EMAIL_KEYS, platformAuditListOptions({ target: USER_ID_2 }).queryKey])
    const { result } = renderHook(() => useSendSignInLink(), { wrapper: wrapperWith(client) })
    result.current.mutate({ userId: USER_ID_2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expectStale(client, [...EMAIL_KEYS, platformAuditListOptions({ target: USER_ID_2 }).queryKey])
  })

  it('an invitation resend refreshes the email queries and both audit logs', async () => {
    server.use(
      http.post(`/api/v1/tenants/acme/invitations/${INVITATION_ID}/resend`, () =>
        ok(null, 'If that address can be invited, an invitation has been sent.', 202)
      )
    )
    const logs = [
      platformAuditListOptions({}).queryKey,
      tenantAuditListOptions('acme', undefined, {}).queryKey,
    ]
    const client = seeded([...EMAIL_KEYS, ...logs, tenantKeys.invitations('acme')])
    const { result } = renderHook(() => useResendInvitation('acme'), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ invitationId: INVITATION_ID })
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

    const logs = [
      platformAuditListOptions({}).queryKey,
      tenantAuditListOptions('acme', undefined, {}).queryKey,
    ]
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
    const logs = [
      platformAuditListOptions({}).queryKey,
      tenantAuditListOptions('acme', undefined, {}).queryKey,
    ]
    const client = seeded([...EMAIL_KEYS, ...logs])
    const { result } = renderHook(() => useCreatePlatformTenant(), { wrapper: wrapperWith(client) })
    result.current.mutate({ name: 'Acme Corp', slug: 'acme', ownerEmail: 'olive@acme.test' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expectStale(client, [...EMAIL_KEYS, ...logs])
  })
})

describe('emailsSearchSchema', () => {
  it('keeps every well-formed filter', () => {
    const search = {
      search: 'cleo',
      status: 'bounced',
      template: 'sign_in_link',
      user: USER_ID_2,
      tenant: TENANT_ID,
      from: '2026-09-01',
      to: '2026-09-30',
      cursor: 'c1',
      direction: 'prev',
    }
    expect(emailsSearchSchema.parse(search)).toEqual(search)
  })

  it('drops each malformed filter on its own, keeping the rest', () => {
    expect(
      emailsSearchSchema.parse({
        search: 2026,
        status: 'lost',
        template: 'welcome_v2',
        user: 'not-a-uuid',
        tenant: 42,
        from: '2026-02-30',
        to: '30/09/2026',
        cursor: 7,
        direction: 'sideways',
      })
    ).toEqual({ search: '2026' })
  })

  it('drops an inverted day range, which the API answers with a 400, and keeps the rest', () => {
    const parsed = emailsSearchSchema.parse({
      from: '2026-09-30',
      to: '2026-09-01',
      status: 'delivered',
    })
    expect(parsed.from).toBeUndefined()
    expect(parsed.to).toBeUndefined()
    expect(parsed.status).toBe('delivered')
  })

  it.each([
    ['one day', { from: '2026-09-10', to: '2026-09-10' }],
    ['a range', { from: '2026-09-01', to: '2026-09-30' }],
    ['only from', { from: '2026-09-30' }],
    ['only to', { to: '2026-09-01' }],
  ])('keeps %s', (_name, range) => {
    expect(emailsSearchSchema.parse(range)).toEqual(range)
  })
})
