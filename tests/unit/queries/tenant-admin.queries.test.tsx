import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { auditKeys } from '@/queries/audit.queries'
import {
  usePurgeTenant,
  useReissueOwnerInvitation,
  useSuspendTenant,
} from '@/queries/tenant-admin.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { userAdminKeys } from '@/queries/user-admin.queries'
import { TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A cached platform audit page (the Activity page's, or the tenant History card's): each write must mark it stale. */
const AUDIT_KEY = auditKeys.platform({ tenantId: TENANT_ID, access: 'platform' })

function clientWithHistory() {
  const client = new QueryClient()
  client.setQueryData(AUDIT_KEY, { pages: [], pageParams: [] })
  return client
}

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
    const users = userAdminKeys.list({ limit: 20 })
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
})
