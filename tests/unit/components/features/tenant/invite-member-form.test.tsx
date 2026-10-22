import '@/lib/zod-jitless'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vite-plus/test'
import { InviteMemberForm } from '@/components/features/tenant/invite-member-form'
import { StepUpContext, type StepUp } from '@/hooks/use-step-up'
import { markRefusedAfterConfirm } from '@/lib/step-up'
import { fail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED } from '@/types/api.types'

/** A step-up runner whose confirmed retry is refused again, as `useStepUp().run` marks it. */
const REFUSED_AFTER_CONFIRM: StepUp['run'] = async (action) => {
  try {
    return await action()
  } catch (error) {
    markRefusedAfterConfirm(error)
    throw error
  }
}

/** Mounts the invite form for acme as a member owner, on a router of its own. */
function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <StepUpContext.Provider value={{ run: REFUSED_AFTER_CONFIRM }}>
          <InviteMemberForm slug="acme" myRole="owner" />
        </StepUpContext.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('InviteMemberForm', () => {
  it('says the confirmation did not take when the retry after it is refused again', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail("Confirm it's you to continue.", 401, REAUTH_REQUIRED)
      )
    )
    const user = userEvent.setup()
    renderForm()
    await user.type(await screen.findByLabelText('Email'), 'new-member@example.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    expect(
      await screen.findByText('We couldn’t confirm it’s you. Try the action again.')
    ).toBeInTheDocument()
    expect(screen.queryByText("Confirm it's you to continue.")).not.toBeInTheDocument()
  })
})
