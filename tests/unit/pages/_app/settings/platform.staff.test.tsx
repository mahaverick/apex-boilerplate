import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { navItemsFor } from '@/constants/navigation'
import { SETTINGS_SECTIONS } from '@/constants/settings'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { testUser } from '@/tests/mocks/handlers'

const membersProps = vi.fn()
const invitationsProps = vi.fn()

// Pins only what the page hands its two sections; staff-members.test.tsx covers the real sections.
vi.mock('@/components/features/tenant/members-card', () => ({
  MembersCard: (props: unknown) => {
    membersProps(props)
    return <p>members section</p>
  },
}))
vi.mock('@/components/features/tenant/invitations-section', () => ({
  InvitationsSection: (props: unknown) => {
    invitationsProps(props)
    return <p>invitations section</p>
  },
}))

describe('/settings/platform/staff', () => {
  beforeEach(() => {
    membersProps.mockClear()
    invitationsProps.mockClear()
  })

  it.each(['viewer', 'admin', 'owner'] as const)(
    'renders both sections on the platform tenant for a platform %s',
    async (platformRole) => {
      signIn({ ...testUser, platformRole })
      renderAppAt('/settings/platform/staff')
      expect(await screen.findByRole('heading', { name: 'Staff', level: 1 })).toBeInTheDocument()
      expect(await screen.findByText('members section')).toBeInTheDocument()
      expect(membersProps).toHaveBeenLastCalledWith({
        slug: 'platform',
        title: 'Staff members',
        description: 'Their platform role. Only an owner can change it.',
      })
      expect(invitationsProps).toHaveBeenLastCalledWith({
        slug: 'platform',
        showRoleError: false,
        inviteTitle: 'Invite staff',
        inviteDescription:
          'We email them a link to join as staff. The link opens Apex; someone without an account creates one with that address.',
      })
    }
  )

  it('names the other two ways in', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    renderAppAt('/settings/platform/staff')
    expect(await screen.findByText(/join as viewers automatically/)).toBeInTheDocument()
    expect(screen.getByText('pnpm platform:grant')).toBeInTheDocument()
  })

  it('is a Platform settings section, not a nav item', () => {
    expect(SETTINGS_SECTIONS).toContainEqual(
      expect.objectContaining({ group: 'platform', label: 'Staff' })
    )
  })

  it('is not in the sidebar nav for a viewer', () => {
    expect(navItemsFor('viewer').map((item) => item.label)).not.toContain('Staff')
  })
})
