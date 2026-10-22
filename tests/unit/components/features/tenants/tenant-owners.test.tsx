import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { TenantOwners } from '@/components/features/tenants/tenant-owners'
import type { MembershipRole } from '@/constants/roles'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { signIn } from '@/tests/fixtures/render-app'
import { testUser } from '@/tests/mocks/handlers'
import type { PlatformTenantDetail } from '@/types/api.types'

/** An ownerless tenant in `lifecycleState`, with no pending owner invitation. */
function ownerless(lifecycleState: PlatformTenantDetail['lifecycleState']): PlatformTenantDetail {
  return {
    id: TENANT_ID,
    name: 'Acme Corp',
    slug: 'acme',
    description: null,
    website: null,
    logo: null,
    lifecycleState,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: lifecycleState === 'archived' ? '2026-09-01T00:00:00.000Z' : null,
    settings: { timezone: 'UTC', locale: 'en' },
    memberCount: 0,
    owners: [],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
  }
}

describe('TenantOwners', () => {
  it.each([
    ['active', 'admin', 'Send an owner invitation from the Actions menu.'],
    ['active', 'viewer', 'An admin can send an owner invitation.'],
    [
      'suspended',
      'admin',
      'Reactivate the tenant from the Actions menu, then send an owner invitation.',
    ],
    ['suspended', 'viewer', 'An admin can reactivate the tenant and send an owner invitation.'],
    ['archived', 'admin', 'An archived tenant can’t get a new owner.'],
    ['archived', 'viewer', 'An archived tenant can’t get a new owner.'],
  ] as const satisfies readonly [PlatformTenantDetail['lifecycleState'], MembershipRole, string][])(
    'names the next step for an ownerless tenant, state %s, role %s: %s',
    (state, role, sentence) => {
      signIn({ ...testUser, platformRole: role })
      render(<TenantOwners tenant={ownerless(state)} />)
      expect(screen.getByText('No owner yet.')).toBeInTheDocument()
      expect(screen.getByText(sentence)).toBeInTheDocument()
    }
  )

  it('counts an owner as admin for the next step', () => {
    signIn({ ...testUser, platformRole: 'owner' })
    render(<TenantOwners tenant={ownerless('active')} />)
    expect(screen.getByText('Send an owner invitation from the Actions menu.')).toBeInTheDocument()
  })
})

describe('FrozenTenant', () => {
  it.each([
    ['suspended', true, 'Reactivate it from the Actions menu to manage them again.'],
    ['suspended', false, 'An admin can reactivate it to manage them again.'],
    ['archived', true, 'Archiving can’t be undone. The Overview tab shows what the tenant held.'],
    ['archived', false, 'Archiving can’t be undone. The Overview tab shows what the tenant held.'],
  ] as const)(
    'names the next step for a frozen tenant, state %s, can reactivate %s',
    (state, can, text) => {
      render(<FrozenTenant state={state} canReactivate={can} />)
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  )
})
