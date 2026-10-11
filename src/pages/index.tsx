import { createFileRoute, redirect } from '@tanstack/react-router'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

/** The root path: sends a signed-in visitor to Overview and anyone else to the login page. */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: useAuthStore.getState().isAuthenticated ? ROUTES.overview : ROUTES.login,
    })
  },
})
