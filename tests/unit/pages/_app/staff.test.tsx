import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { navItemsFor } from '@/constants/navigation'
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

describe('/staff', () => {
  beforeEach(() => {
    membersProps.mockClear()
    invitationsProps.mockClear()
  })

  it.each(['viewer', 'admin', 'owner'] as const)(
    'renders both sections on the platform tenant for a platform %s',
    async (platformRole) => {
      signIn({ ...testUser, platformRole })
      renderAppAt('/staff')
      expect(await screen.findByRole('heading', { name: 'Staff', level: 1 })).toBeInTheDocument()
      expect(await screen.findByText('members section')).toBeInTheDocument()
      expect(membersProps).toHaveBeenLastCalledWith({
        slug: 'platform',
        title: 'Staff members',
        description: 'Everyone with platform access, and their platform role.',
      })
      expect(invitationsProps).toHaveBeenLastCalledWith({
        slug: 'platform',
        inviteTitle: 'Invite staff',
        inviteDescription:
          'We email them a link to join as staff. The link opens Apex; someone without an account creates one with that address.',
      })
    }
  )

  it('names the other two ways in', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    renderAppAt('/staff')
    expect(await screen.findByText(/join as viewers automatically/)).toBeInTheDocument()
    expect(screen.getByText('pnpm platform:grant')).toBeInTheDocument()
  })

  it('is in the Directory nav for every staff role, after Users', () => {
    const directory = navItemsFor('viewer').filter((item) => item.group === 'Directory')
    expect(directory.map((item) => item.label)).toEqual(['Tenants', 'Users', 'Staff'])
  })
})
