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
          'We email them an invitation that expires in 3 days. When they open it, we email a sign-in link that adds them to Apex as staff.',
        submitLabel: 'Invite staff',
      })
    }
  )

  it('names the one other way in', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    renderAppAt('/settings/platform/staff')
    const card = (await screen.findByRole('heading', { name: 'Another way in', level: 2 })).closest(
      '[data-slot="card"]'
    )
    expect(card).not.toBeNull()
    expect(screen.getByText('pnpm platform:grant')).toBeInTheDocument()
    expect(card).toHaveTextContent(
      'On the server, pnpm platform:grant gives an account any platform role. It creates the account if none exists. Use it to create the first owner.'
    )
    expect(card).not.toHaveTextContent(/PLATFORM_EMAIL_DOMAINS|automatically/)
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
