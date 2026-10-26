import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vite-plus/test'
import { auditKeys } from '@/queries/audit.queries'
import {
  billingAdminKeys,
  billingAlertsList,
  billingAlertsListOptions,
  billingSettingsQueryOptions,
  staffPlansQueryOptions,
  staffTenantBillingQueryOptions,
  useAddGrant,
  useCancelBillingByStaff,
  useCreatePrice,
  useExtendTrial,
  usePreviewPlanChange,
  useResyncBilling,
  useRevokeGrant,
  useUpdateBillingSettings,
  useUpdatePlan,
} from '@/queries/billing-admin.queries'
import { tenantAdminKeys } from '@/queries/tenant-admin.queries'
import { testBillingSettings, testPlans, testTenantBilling } from '@/tests/fixtures/billing'
import { TENANT_ID, TENANT_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A provider around `client`, so the test can read the cache a hook wrote. */
function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** A cached platform audit page and tenants list, so a test can see a write mark them stale. */
const AUDIT_KEY: QueryKey = [...auditKeys.platformAll, 'list', {}]
const TENANTS_KEY: QueryKey = [...tenantAdminKeys.all, 'list', {}]

/** A client holding every key a billing write may touch. */
function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(AUDIT_KEY, listPage([]))
  client.setQueryData(TENANTS_KEY, listPage([]))
  client.setQueryData(tenantAdminKeys.detail(TENANT_ID), { id: TENANT_ID })
  client.setQueryData(billingAdminKeys.tenant(TENANT_ID), testTenantBilling)
  client.setQueryData(billingAdminKeys.tenant(TENANT_ID_2), testTenantBilling)
  client.setQueryData(billingAdminKeys.plans, testPlans)
  client.setQueryData(billingAdminKeys.settings, testBillingSettings)
  return client
}

/** Whether the client holds `key` marked stale. */
function stale(client: QueryClient, key: QueryKey): boolean | undefined {
  return client.getQueryState(key)?.isInvalidated
}

/** The paid plan of the fixture, which every plan write targets. */
const PAID = testPlans.plans[1] ?? testPlans.plans[0]
const PAID_ID = PAID?.id ?? ''

describe('billingAdminKeys', () => {
  it('nests a tenant’s billing under its detail, so a directory refresh reaches it', () => {
    expect(billingAdminKeys.tenant(TENANT_ID)).toEqual(['platform', 'tenant', TENANT_ID, 'billing'])
    expect(billingAdminKeys.tenant(TENANT_ID).slice(0, 3)).toEqual(
      tenantAdminKeys.detail(TENANT_ID)
    )
    expect(billingAdminKeys.plans).toEqual(['platform', 'plans'])
    expect(billingAdminKeys.settings).toEqual(['platform', 'billing-settings'])
    expect(billingAdminKeys.alerts).toEqual(['platform', 'billing', 'alerts'])
  })
})

describe('billing reads', () => {
  it('reads the plans, the settings and a tenant’s billing', async () => {
    const client = new QueryClient()
    await expect(client.fetchQuery(staffPlansQueryOptions())).resolves.toEqual(testPlans)
    await expect(client.fetchQuery(billingSettingsQueryOptions())).resolves.toEqual(
      testBillingSettings
    )
    await expect(client.fetchQuery(staffTenantBillingQueryOptions(TENANT_ID))).resolves.toEqual(
      testTenantBilling
    )
  })

  it('never retries a tenant billing 404', () => {
    const { retry } = staffTenantBillingQueryOptions(TENANT_ID)
    const config = { headers: new AxiosHeaders() }
    const notFound = new AxiosError('Not found', '404', config, null, {
      data: {},
      status: 404,
      statusText: 'Not Found',
      headers: {},
      config,
    })
    expect(typeof retry === 'function' && retry(0, notFound)).toBe(false)
    expect(typeof retry === 'function' && retry(0, new Error('network'))).toBe(true)
  })

  it('sorts alerts newest first by default and pages them under the alerts key', async () => {
    expect(billingAlertsList.sorts).toEqual(['-at', 'at'])
    let asked: URLSearchParams | undefined
    server.use(
      http.get('/api/v1/platform/billing/alerts', ({ request }) => {
        asked = new URL(request.url).searchParams
        return ok(listPage([]), 'Billing alerts retrieved.')
      })
    )
    const options = billingAlertsListOptions({ limit: 5 }, { total: false })
    expect(options.queryKey.slice(0, 3)).toEqual(billingAdminKeys.alerts)
    await new QueryClient().fetchQuery(options)
    expect(asked?.get('limit')).toBe('5')
    expect(asked?.has('total')).toBe(false)
  })
})

/** A tenant billing write hook, its input type erased so one table can hold every write. */
type TenantWriteHook = () => { mutate: (input: never) => void; isSuccess: boolean }

/** Each tenant billing write: its route under the tenant's billing, its hook and an input. */
const TENANT_WRITES: [string, TenantWriteHook, object][] = [
  ['resync', () => useResyncBilling(TENANT_ID), { reason: 'Paid by bank' }],
  ['extend-trial', () => useExtendTrial(TENANT_ID), { days: 7, reason: 'Pilot' }],
  [
    'grants',
    () => useAddGrant(TENANT_ID),
    { key: 'members', value: null, expiresAt: null, reason: 'Big team' },
  ],
  ['cancel', () => useCancelBillingByStaff(TENANT_ID), { when: 'cycle_end', reason: 'Asked' }],
]

describe('tenant billing writes', () => {
  it.each(TENANT_WRITES)(
    'posts %s, caches the answered view and refreshes the tenant, the lists and the log',
    async (path, useHook, input) => {
      const answered = { ...testTenantBilling, syncedAt: '2026-10-26T10:00:00.000Z' }
      let body: unknown
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/billing/${path}`, async ({ request }) => {
          body = await request.json()
          return ok(answered, 'Done.')
        })
      )
      const client = seededClient()
      const { result } = renderHook(useHook, { wrapper: wrapperWith(client) })
      result.current.mutate(input as never)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(body).toEqual(input)
      expect(client.getQueryData(billingAdminKeys.tenant(TENANT_ID))).toEqual(answered)
      expect(stale(client, billingAdminKeys.tenant(TENANT_ID))).toBe(false)
      expect(stale(client, tenantAdminKeys.detail(TENANT_ID))).toBe(true)
      expect(stale(client, TENANTS_KEY)).toBe(true)
      expect(stale(client, AUDIT_KEY)).toBe(true)
      expect(stale(client, billingAdminKeys.plans)).toBe(true)
    }
  )

  it('invalidates the tenant’s billing and directory after a grant is revoked', async () => {
    const grantId = '92000000-0000-4000-8000-000000000001'
    let body: unknown
    server.use(
      http.post(
        `/api/v1/platform/tenants/${TENANT_ID}/billing/grants/${grantId}/revoke`,
        async ({ request }) => {
          body = await request.json()
          return ok(testTenantBilling, 'Grant revoked.')
        }
      )
    )
    const client = seededClient()
    const { result } = renderHook(() => useRevokeGrant(TENANT_ID), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ grantId, reason: 'Ended' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ reason: 'Ended' })
    expect(stale(client, tenantAdminKeys.detail(TENANT_ID))).toBe(true)
    expect(stale(client, AUDIT_KEY)).toBe(true)
  })

  it('refetches the tenant’s billing after a 409, whose cached state was stale', async () => {
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/billing/extend-trial`, () =>
        fail(
          'This tenant pays for Paid, so it has no trial to extend.',
          409,
          'TRIAL_NOT_EXTENDABLE'
        )
      )
    )
    const client = seededClient()
    const { result } = renderHook(() => useExtendTrial(TENANT_ID), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ days: 7, reason: 'Pilot' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(stale(client, billingAdminKeys.tenant(TENANT_ID))).toBe(true)
    expect(stale(client, billingAdminKeys.tenant(TENANT_ID_2))).toBe(false)
  })
})

describe('plan writes', () => {
  it('sends no reason with a preview and touches no cache', async () => {
    let body: unknown
    const preview = {
      changes: [{ key: 'members', from: 3, to: 2, direction: 'decrease' }],
      affected: { trialing: 0, active: 0, past_due: 0, free: 4 },
    }
    server.use(
      http.post(`/api/v1/platform/plans/${PAID_ID}/preview`, async ({ request }) => {
        body = await request.json()
        return ok(preview, 'Preview ready.')
      })
    )
    const client = seededClient()
    const { result } = renderHook(() => usePreviewPlanChange(PAID_ID), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ members: 2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ entitlements: { members: 2 } })
    expect(result.current.data).toEqual(preview)
    expect(stale(client, billingAdminKeys.plans)).toBe(false)
    expect(stale(client, AUDIT_KEY)).toBe(false)
  })

  it('caches a saved plan in the plans and refreshes the tenants on it and the log', async () => {
    const saved = { ...PAID, name: 'Pro', version: 2 }
    let body: unknown
    server.use(
      http.patch(`/api/v1/platform/plans/${PAID_ID}`, async ({ request }) => {
        body = await request.json()
        return ok(saved, 'Plan saved.')
      })
    )
    const client = seededClient()
    const { result } = renderHook(() => useUpdatePlan(PAID_ID), { wrapper: wrapperWith(client) })
    result.current.mutate({ version: 1, name: 'Pro', reason: 'Rename' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ version: 1, name: 'Pro', reason: 'Rename' })
    const plans = client.getQueryData<typeof testPlans>(billingAdminKeys.plans)
    expect(plans?.plans.find((plan) => plan.id === PAID_ID)?.name).toBe('Pro')
    expect(plans?.plans).toHaveLength(testPlans.plans.length)
    expect(stale(client, billingAdminKeys.plans)).toBe(true)
    expect(stale(client, billingAdminKeys.tenant(TENANT_ID))).toBe(true)
    expect(stale(client, TENANTS_KEY)).toBe(true)
    expect(stale(client, AUDIT_KEY)).toBe(true)
  })

  it('reloads the plans on a version conflict', async () => {
    server.use(
      http.patch(`/api/v1/platform/plans/${PAID_ID}`, () =>
        fail('Someone changed the plan.', 409, 'PLAN_VERSION_CONFLICT')
      )
    )
    const client = seededClient()
    const { result } = renderHook(() => useUpdatePlan(PAID_ID), { wrapper: wrapperWith(client) })
    result.current.mutate({ version: 1, name: 'Pro', reason: 'Rename' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(stale(client, billingAdminKeys.plans)).toBe(true)
  })

  it('posts a price in paise and caches the answered plan', async () => {
    const saved = { ...PAID, version: 2 }
    let body: unknown
    server.use(
      http.post(`/api/v1/platform/plans/${PAID_ID}/prices`, async ({ request }) => {
        body = await request.json()
        return ok(saved, 'Price added.')
      })
    )
    const client = seededClient()
    const { result } = renderHook(() => useCreatePrice(PAID_ID), { wrapper: wrapperWith(client) })
    result.current.mutate({ interval: 'year', amountMinor: 1_199_000, reason: 'New year price' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ interval: 'year', amountMinor: 1_199_000, reason: 'New year price' })
    expect(
      client
        .getQueryData<typeof testPlans>(billingAdminKeys.plans)
        ?.plans.find((plan) => plan.id === PAID_ID)?.version
    ).toBe(2)
    expect(stale(client, AUDIT_KEY)).toBe(true)
  })

  it('reloads the plans when another price change won the slot', async () => {
    server.use(
      http.post(`/api/v1/platform/plans/${PAID_ID}/prices`, () =>
        fail('Another price change finished first.', 409)
      )
    )
    const client = seededClient()
    const { result } = renderHook(() => useCreatePrice(PAID_ID), { wrapper: wrapperWith(client) })
    result.current.mutate({ interval: 'year', amountMinor: 1_199_000, reason: 'New year price' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(stale(client, billingAdminKeys.plans)).toBe(true)
  })
})

describe('billing settings writes', () => {
  it('caches the saved settings and refreshes every tenant’s billing and the log', async () => {
    const saved = { ...testBillingSettings, trialDays: 21, version: 2 }
    let body: unknown
    server.use(
      http.patch('/api/v1/platform/billing-settings', async ({ request }) => {
        body = await request.json()
        return ok(saved, 'Billing settings saved.')
      })
    )
    const client = seededClient()
    const { result } = renderHook(() => useUpdateBillingSettings(), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ version: 1, trialDays: 21, reason: 'Longer trials' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ version: 1, trialDays: 21, reason: 'Longer trials' })
    expect(client.getQueryData(billingAdminKeys.settings)).toEqual(saved)
    expect(stale(client, billingAdminKeys.tenant(TENANT_ID))).toBe(true)
    expect(stale(client, AUDIT_KEY)).toBe(true)
  })

  it('reloads the settings on a version conflict', async () => {
    server.use(
      http.patch('/api/v1/platform/billing-settings', () =>
        fail('Someone changed the billing settings.', 409, 'PLAN_VERSION_CONFLICT')
      )
    )
    const client = seededClient()
    const { result } = renderHook(() => useUpdateBillingSettings(), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ version: 1, trialDays: 21, reason: 'Longer trials' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(stale(client, billingAdminKeys.settings)).toBe(true)
  })
})
