import { describe, expect, it } from 'vitest'
import { AuthPagePending, AuthPending } from '@/components/shared/pending-templates'
import { Route as authRoute } from '@/pages/_auth'
import { Route as login } from '@/pages/_auth/login'
import { Route as callback } from '@/pages/auth/callback'
import { Route as confirm } from '@/pages/auth/confirm'
import { Route as authLink } from '@/pages/auth/link'
import { Route as accept } from '@/pages/invitations/accept'
import { Route as invitationConfirm } from '@/pages/invitations/confirm'
import { Route as noAccess } from '@/pages/no-access'

describe('the auth routes name their own pending template', () => {
  it('login, inside the _auth layout, uses the card alone', () => {
    expect(login.options.pendingComponent).toBe(AuthPending)
  })

  it.each([
    ['_auth', authRoute],
    ['invitations/accept', accept],
    ['invitations/confirm', invitationConfirm],
    ['no-access', noAccess],
    ['auth/callback', callback],
    ['auth/confirm', confirm],
    ['auth/link', authLink],
  ])('%s, which draws its own frame, uses the framed template', (_name, route) => {
    expect(route.options.pendingComponent).toBe(AuthPagePending)
  })
})
