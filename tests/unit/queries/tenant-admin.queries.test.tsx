import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { auditKeys } from '@/queries/audit.queries'
import { usePurgeTenant, useReissueOwnerInvitation } from '@/queries/tenant-admin.queries'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** The tenant's History card page: each write adds an entry, so it goes stale. */
const AUDIT_KEY = auditKeys.platform({ targetId: TENANT_ID })

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
    const { result } = renderHook(() => usePurgeTenant(TENANT_ID), {
      wrapper: wrapperWith(client),
    })
    result.current.mutate('Erasure request')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true)
  })
})
