import '@/lib/zod-jitless'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { Spinner } from '@/components/ui/spinner'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { safeRedirect } from '@/lib/safe-redirect'
import { track } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where the API's Google callback lands, with the `redirect` the start
 * stored. Apex Google never creates an account, so the API's `new=1` never
 * arrives, and an unknown key is dropped.
 *
 * It sits outside `_auth`, whose guard would bounce the freshly signed-in
 * visitor before this ran. It makes no refresh call: `__root`'s beforeLoad
 * already awaited bootstrapSession(), which used the cookie the API just set,
 * so the store is settled.
 */
export const Route = createFileRoute('/auth/callback')({
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: pageTitle('Signing in') }] }),
  component: OAuthCallbackPage,
  pendingComponent: AuthPagePending,
})

/**
 * Lands a signed-in visitor on the safe redirect, or else Overview, whose
 * guard sends a non-staff user to /no-access. A signed-out visitor goes to
 * sign-in with the Google failure code. Every landing replaces this page in
 * history. The ref keeps StrictMode's second effect run from tracking the
 * sign-in twice.
 */
function OAuthCallbackPage() {
  const navigate = useNavigate()
  const { redirect } = Route.useSearch()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    if (!useAuthStore.getState().isAuthenticated) {
      void navigate({ to: ROUTES.login, search: { error: 'google_auth_failed' }, replace: true })
      return
    }
    track('sign_in_completed', { method: 'google' })
    const target = safeRedirect(redirect)
    void (target
      ? navigate({ href: target, replace: true })
      : navigate({ to: ROUTES.overview, replace: true }))
  }, [navigate, redirect])

  return (
    <AuthLayout>
      <AuthCard title="Signing in">
        <div
          role="status"
          className="flex items-center justify-center gap-3 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden="true" />
          <span>Completing sign-in…</span>
        </div>
      </AuthCard>
    </AuthLayout>
  )
}
