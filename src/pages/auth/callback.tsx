import { IconLoader2 } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where the API's Google callback lands. Outside `_auth`, whose guard would
 * redirect the freshly signed-in visitor before this ran. It makes no refresh
 * call: `__root`'s beforeLoad already awaited bootstrapSession(), which used
 * the cookie the API just set, so the store is settled.
 */
export const Route = createFileRoute('/auth/callback')({
  head: () => ({ meta: [{ title: pageTitle('Signing in') }] }),
  component: OAuthCallbackPage,
})

/** Goes to Overview when the store is signed in, else to the login page with `error=google_auth_failed`. */
function OAuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const { isAuthenticated } = useAuthStore.getState()
    void navigate(
      isAuthenticated
        ? { to: ROUTES.overview }
        : { to: ROUTES.login, search: { error: 'google_auth_failed' } }
    )
  }, [navigate])

  return (
    <AuthLayout>
      <AuthCard title="Signing in">
        <div
          role="status"
          className="flex items-center justify-center gap-3 text-sm text-muted-foreground"
        >
          <IconLoader2 className="size-5 animate-spin" aria-hidden="true" />
          <span>Completing sign-in…</span>
        </div>
      </AuthCard>
    </AuthLayout>
  )
}
