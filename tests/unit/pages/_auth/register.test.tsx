import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderAppAt, signOut } from '@/tests/fixtures/render-app'
import { fail, TEST_INVITATION_TOKEN, testInvitationPreview } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('/register (invitation only)', () => {
  beforeEach(() => {
    signOut()
  })

  it('sends a visitor without an invitation to /login', async () => {
    const router = renderAppAt('/register')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('prefills and locks the invited address', async () => {
    renderAppAt(`/register?invitation=${TEST_INVITATION_TOKEN}`)
    const email = await screen.findByLabelText('Email')
    expect(email).toHaveValue(testInvitationPreview.email)
    expect(email).toHaveAttribute('readonly')
    expect(screen.getByText(new RegExp(testInvitationPreview.tenant.name))).toBeInTheDocument()
  })

  it('says an unusable invitation cannot be used, with no form', async () => {
    server.use(
      http.post('/api/v1/invitations/preview', () =>
        fail('Invalid invitation', 404, 'invitation_invalid')
      )
    )
    renderAppAt(`/register?invitation=${TEST_INVITATION_TOKEN}`)
    expect(
      await screen.findByRole('heading', { name: 'This invitation can’t be used', level: 1 })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('registers and shows the check-your-email card', async () => {
    const user = userEvent.setup()
    renderAppAt(`/register?invitation=${TEST_INVITATION_TOKEN}`)
    await user.type(await screen.findByLabelText('Password'), 'longenough1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/Check your email/i)).toBeInTheDocument()
  })
})
