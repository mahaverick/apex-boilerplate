import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { auditKeys } from '@/queries/audit.queries'
import { emailKeys } from '@/queries/email.queries'
import {
  onboardingFunnelQueryOptions,
  onboardingKeys,
  onboardingTenantsQueryOptions,
  tenantOnboardingQueryOptions,
  useCompleteOnboardingStep,
  useSendOnboardingReminder,
} from '@/queries/onboarding.queries'
import { invalidateDirectory, platformKeys } from '@/queries/platform.queries'
import { useCreatePlatformTenant } from '@/queries/tenant-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import {
  fail,
  ok,
  tenantOnboardingAfterStaffCompletion,
  tenantOnboardingDetail,
  testOnboardingFunnel,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Every onboarding cache a staff write can make stale. */
const ONBOARDING_KEYS: QueryKey[] = [
  onboardingKeys.funnel('30d'),
  onboardingKeys.tenants({ state: 'stuck', limit: 20 }),
  onboardingKeys.tenant(TENANT_ID),
]

/** What else a staff onboarding write refreshes: the Overview's stuck count and both logs. */
const AROUND: QueryKey[] = [
  platformKeys.stats('7d'),
  auditKeys.tenant('acme', {}, TENANT_ID),
  auditKeys.platform({ tenantId: TENANT_ID, access: 'platform' }),
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

describe('onboarding reads', () => {
  it('asks for the funnel by window, and answers it from the default handler', async () => {
    const seen: string[] = []
    server.use(
      http.get('/api/v1/platform/onboarding/funnel', ({ request }) => {
        seen.push(new URL(request.url).searchParams.toString())
        return ok({ ...testOnboardingFunnel, range: '90d' }, 'Onboarding funnel retrieved.')
      })
    )
    const funnel = await new QueryClient().fetchQuery(onboardingFunnelQueryOptions('90d'))
    expect(seen).toEqual(['range=90d'])
    expect(funnel.totals).toEqual(testOnboardingFunnel.totals)
  })

  it('sends the state, a cursor with its direction, and the page size', async () => {
    const seen: Record<string, string>[] = []
    server.use(
      http.get('/api/v1/platform/onboarding/tenants', ({ request }) => {
        seen.push(Object.fromEntries(new URL(request.url).searchParams))
        return ok({ tenants: [], nextCursor: null, prevCursor: null }, 'OK')
      })
    )
    const client = new QueryClient()
    await client.fetchQuery(
      onboardingTenantsQueryOptions({ state: 'complete', cursor: 'c1', direction: 'prev' })
    )
    await client.fetchQuery(onboardingTenantsQueryOptions({ state: 'stuck', direction: 'prev' }))
    expect(seen).toEqual([
      { state: 'complete', cursor: 'c1', direction: 'prev', limit: '20' },
      { state: 'stuck', limit: '20' },
    ])
  })

  it('answers every read from the default handlers, so a page that embeds one needs no setup', async () => {
    const client = new QueryClient()
    await expect(
      client.fetchQuery(onboardingTenantsQueryOptions({ state: 'stuck' }))
    ).resolves.toEqual({ tenants: [], nextCursor: null, prevCursor: null })
    await expect(client.fetchQuery(tenantOnboardingQueryOptions(TENANT_ID))).resolves.toEqual(
      tenantOnboardingDetail()
    )
  })

  it('asks for a tenant’s onboarding once on a 404', async () => {
    let calls = 0
    server.use(
      http.get(`/api/v1/platform/tenants/${TENANT_ID}/onboarding`, () => {
        calls += 1
        return fail('Not found', 404)
      })
    )
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    await expect(client.fetchQuery(tenantOnboardingQueryOptions(TENANT_ID))).rejects.toBeDefined()
    expect(calls).toBe(1)
  })
})

describe('onboarding writes', () => {
  it('marks a step complete with the reason, caches the answer, and refreshes the rest', async () => {
    let body: unknown
    server.use(
      http.post(
        `/api/v1/platform/tenants/${TENANT_ID}/onboarding/steps/invite_teammate/complete`,
        async ({ request }) => {
          body = await request.json()
          return ok(
            tenantOnboardingAfterStaffCompletion('invite_teammate'),
            'Onboarding step completed.'
          )
        }
      )
    )
    const client = seeded([...ONBOARDING_KEYS, ...AROUND, emailKeys.list({ limit: 20 })])
    const { result } = renderHook(() => useCompleteOnboardingStep(TENANT_ID, 'acme'), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ stepKey: 'invite_teammate', reason: 'Done on the call' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ reason: 'Done on the call' })
    // The tenant's detail is the write's own answer, so it is replaced, not refetched.
    expect(client.getQueryData(onboardingKeys.tenant(TENANT_ID))).toEqual(
      tenantOnboardingAfterStaffCompletion('invite_teammate')
    )
    expect(client.getQueryState(onboardingKeys.tenant(TENANT_ID))?.isInvalidated).toBe(false)
    expectStale(client, [
      onboardingKeys.funnel('30d'),
      onboardingKeys.tenants({ state: 'stuck', limit: 20 }),
      ...AROUND,
    ])
    expect(client.getQueryState(emailKeys.list({ limit: 20 }))?.isInvalidated).toBe(false)
  })

  it('refreshes the same after a refusal, since the cached state was stale', async () => {
    server.use(
      http.post(
        `/api/v1/platform/tenants/${TENANT_ID}/onboarding/steps/invite_teammate/complete`,
        () => fail('That step is already complete.', 409, 'already_complete')
      )
    )
    const client = seeded([...ONBOARDING_KEYS, ...AROUND])
    const { result } = renderHook(() => useCompleteOnboardingStep(TENANT_ID, 'acme'), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ stepKey: 'invite_teammate', reason: 'Done on the call' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    await waitFor(() => expectStale(client, [...ONBOARDING_KEYS, ...AROUND]))
  })

  it('sends a reminder with the reason, answers what the API queued, and refreshes the emails too', async () => {
    let body: unknown
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/onboarding/remind`, async ({ request }) => {
        body = await request.json()
        return ok({ emailSent: false, recipientCount: 2 }, 'Reminder sent.', 202)
      })
    )
    const emails = [emailKeys.list({ tenantId: TENANT_ID, limit: 20 }), emailKeys.detail('x')]
    const client = seeded([...ONBOARDING_KEYS, ...AROUND, ...emails])
    const { result } = renderHook(() => useSendOnboardingReminder(TENANT_ID, 'acme'), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate('Stalled since the call')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ reason: 'Stalled since the call' })
    expect(result.current.data).toEqual({ emailSent: false, recipientCount: 2 })
    expectStale(client, [...ONBOARDING_KEYS, ...AROUND, ...emails])
  })

  it('a refused reminder refreshes everything a sent one would', async () => {
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/onboarding/remind`, () =>
        fail('A reminder went out less than 24 hours ago.', 409, 'reminded_recently')
      )
    )
    const client = seeded([...ONBOARDING_KEYS, ...AROUND, emailKeys.list({ limit: 20 })])
    const { result } = renderHook(() => useSendOnboardingReminder(TENANT_ID, 'acme'), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate('Stalled since the call')
    await waitFor(() => expect(result.current.isError).toBe(true))
    await waitFor(() =>
      expectStale(client, [...ONBOARDING_KEYS, ...AROUND, emailKeys.list({ limit: 20 })])
    )
  })
})

describe('onboarding goes stale with the directory', () => {
  it('invalidateDirectory, which every lifecycle change calls, marks every onboarding query stale', async () => {
    const client = seeded(ONBOARDING_KEYS)
    await invalidateDirectory(client)
    expectStale(client, ONBOARDING_KEYS)
  })

  it('a staff-created tenant refreshes the onboarding lists, where it now awaits its owner', async () => {
    server.use(
      http.post('/api/v1/platform/tenants', () =>
        ok(
          { tenant: { id: TENANT_ID, name: 'Acme Corp', slug: 'acme' }, emailSent: true },
          'Tenant created.',
          201
        )
      )
    )
    const client = seeded(ONBOARDING_KEYS)
    const { result } = renderHook(() => useCreatePlatformTenant(), { wrapper: wrapperWith(client) })
    result.current.mutate({ name: 'Acme Corp', slug: 'acme', ownerEmail: 'olive@acme.test' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expectStale(client, ONBOARDING_KEYS)
  })
})
