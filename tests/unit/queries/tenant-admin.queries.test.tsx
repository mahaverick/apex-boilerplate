import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vite-plus/test'
import { platformAuditListOptions } from '@/queries/audit.queries'
import { billingAdminKeys } from '@/queries/billing-admin.queries'
import {
  useArchiveTenant,
  useCreatePlatformTenant,
  usePurgeTenant,
  useReactivateTenant,
  useReissueOwnerInvitation,
  useSuspendTenant,
} from '@/queries/tenant-admin.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { userAdminKeys, usersListOptions } from '@/queries/user-admin.queries'
import { testPlans, testTenantBilling } from '@/tests/fixtures/billing'
import { TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A cached platform audit page (the Activity page's, or the tenant History card's): each write must mark it stale. */
const AUDIT_KEY = platformAuditListOptions({ tenant: TENANT_ID, access: 'platform' }).queryKey

/** A client holding the cached platform audit page. */
function clientWithHistory() {
  const client = new QueryClient()
  client.setQueryData(AUDIT_KEY, listPage([]))
  return client
}

/** A provider around `client`, so the test can read the cache a hook wrote. */
function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('tenant-admin queries', () => {
  it('re-issuing the owner invitation marks the platform audit log stale', async () => {
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/owner-invitation`, () =>
        ok({ emailSent: true }, 'Invitation sent.')
      )
    )
    const client = clientWithHistory()
    const { result } = renderHook(() => useReissueOwnerInvitation(TENANT_ID), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ email: 'owner@example.com', reason: 'Owner left' })
    await waitFor(() => expect(client.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true))
  })

  it('purging a tenant marks the platform audit log stale', async () => {
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/purge`, () =>
        ok(null, 'Tenant permanently deleted.')
      )
    )
    const client = clientWithHistory()
    const { result } = renderHook(() => usePurgeTenant(TENANT_ID, { onPurged: async () => {} }), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate('Erasure request')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true)
  })

  it('a lifecycle change refreshes the users its members appear under and the Staff list', async () => {
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/suspend`, () =>
        ok({ id: TENANT_ID, lifecycleState: 'suspended' }, 'Tenant suspended.')
      )
    )
    const client = clientWithHistory()
    const userPage = userAdminKeys.detail(USER_ID_2)
    const users = usersListOptions({ limit: 20 }).queryKey
    const staff = tenantKeys.members('platform')
    for (const key of [userPage, users, staff]) client.setQueryData(key, {})
    const { result } = renderHook(() => useSuspendTenant(TENANT_ID), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate('Billing hold')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const key of [userPage, users, staff, AUDIT_KEY]) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
  })

  it.each([
    ['suspending', 'suspend', () => useSuspendTenant(TENANT_ID), 'suspended'],
    ['reactivating', 'reactivate', () => useReactivateTenant(TENANT_ID), 'active'],
    ['archiving', 'archive', () => useArchiveTenant(TENANT_ID), 'archived'],
  ] as const)(
    '%s a tenant refreshes the plan counts and its billing view',
    async (_label, action, useHook, lifecycleState) => {
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/${action}`, () =>
          ok({ id: TENANT_ID, slug: 'acme', lifecycleState }, 'Done.')
        )
      )
      const client = clientWithBilling()
      const { result } = renderHook(useHook, { wrapper: wrapperWith(client) })
      result.current.mutate('Billing hold')
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(client.getQueryState(billingAdminKeys.plans)?.isInvalidated).toBe(true)
      expect(client.getQueryState(billingAdminKeys.tenant(TENANT_ID))?.isInvalidated).toBe(true)
    }
  )

  it('purging a tenant refreshes the plan counts', async () => {
    server.use(
      http.post(`/api/v1/platform/tenants/${TENANT_ID}/purge`, () =>
        ok(null, 'Tenant permanently deleted.')
      )
    )
    const client = clientWithBilling()
    const { result } = renderHook(() => usePurgeTenant(TENANT_ID, { onPurged: async () => {} }), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate('Erasure request')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryState(billingAdminKeys.plans)?.isInvalidated).toBe(true)
  })

  it('creating a tenant refreshes the plan counts', async () => {
    server.use(
      http.post('/api/v1/platform/tenants', () =>
        ok({ tenant: { id: TENANT_ID, slug: 'acme' }, emailSent: true }, 'Tenant created.', 201)
      )
    )
    const client = clientWithBilling()
    const { result } = renderHook(() => useCreatePlatformTenant(), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate({ name: 'Acme', slug: 'acme', ownerEmail: 'owner@acme.test' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryState(billingAdminKeys.plans)?.isInvalidated).toBe(true)
  })
})

/** A client holding the plans and one tenant's billing view, so a test can see a lifecycle write mark them stale. */
function clientWithBilling() {
  const client = clientWithHistory()
  client.setQueryData(billingAdminKeys.plans, testPlans)
  client.setQueryData(billingAdminKeys.tenant(TENANT_ID), testTenantBilling)
  return client
}
