import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { isStaff } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

/**
 * Staff only. The API is the real gate; this only keeps a signed-in non-staff
 * user out of a shell whose every request would answer 404.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    const { isAuthenticated, user } = useAuthStore.getState()
    if (!isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: location.href } })
    }
    if (!isStaff(user?.platformRole)) throw redirect({ to: ROUTES.noAccess })
  },
  component: AppLayout,
})
