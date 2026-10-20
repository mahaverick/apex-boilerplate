import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { pageTitle } from '@/constants/app'
import { isStaff } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useLogout } from '@/queries/auth.queries'
import { useAuthStore } from '@/states/auth.store'

/** Where a signed-in user without a platform role lands; staff go to Overview and signed-out visitors to login. */
export const Route = createFileRoute('/no-access')({
  beforeLoad: () => {
    const { isAuthenticated, user } = useAuthStore.getState()
    if (!isAuthenticated) throw redirect({ to: ROUTES.login })
    if (isStaff(user?.platformRole)) throw redirect({ to: ROUTES.overview })
  },
  head: () => ({ meta: [{ title: pageTitle('No access') }] }),
  component: NoAccessPage,
  pendingComponent: AuthPagePending,
})

/**
 * Signed in, but not platform staff. It names the account, since the fix is
 * often "you signed in with the wrong one", and lists the ways in: staff join
 * only by invitation.
 */
function NoAccessPage() {
  const email = useAuthStore((state) => state.user?.email)
  const logout = useLogout()

  return (
    <AuthLayout>
      <AuthCard
        title="This account has no platform access"
        description={
          <>
            Signed in as <Pii>{email}</Pii>.
          </>
        }
      >
        <ul className="grid list-disc gap-2 pl-5 text-sm text-muted-foreground">
          <li>If you were invited, open the invitation email and select Join.</li>
          <li>Otherwise, ask a platform admin to invite you.</li>
        </ul>
        <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
          Sign out
        </Button>
      </AuthCard>
    </AuthLayout>
  )
}
