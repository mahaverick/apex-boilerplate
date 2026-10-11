import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

/** The layout of the signed-out pages: a signed-in visitor is sent to Overview instead. */
export const Route = createFileRoute('/_auth')({
  beforeLoad: () => {
    // __root's beforeLoad has awaited bootstrapSession(), so the store is settled.
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: ROUTES.overview })
    }
  },
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
})
