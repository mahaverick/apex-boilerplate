import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { isStaff } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useLogout } from '@/queries/auth.queries'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/no-access')({
  beforeLoad: () => {
    const { isAuthenticated, user } = useAuthStore.getState()
    if (!isAuthenticated) throw redirect({ to: ROUTES.login })
    if (isStaff(user?.platformRole)) throw redirect({ to: ROUTES.overview })
  },
  head: () => ({ meta: [{ title: pageTitle('No access') }] }),
  component: NoAccessPage,
})

/**
 * Signed in, but not platform staff. It names the account, since the fix is
 * often "you signed in with the wrong one", and lists the ways in.
 */
function NoAccessPage() {
  const email = useAuthStore((state) => state.user?.email)
  const logout = useLogout()

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>This account has no platform access</h1>
          </CardTitle>
          <CardDescription>
            <Pii>Signed in as {email}.</Pii>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <ul className="grid list-disc gap-2 pl-5 text-muted-foreground">
            <li>If you were invited, open the invitation link again while signed in.</li>
            <li>Otherwise, ask a platform admin to invite you.</li>
            <li>
              If your organisation uses an allow-listed email domain, verify that address, then sign
              in again: access is granted at sign-in.
            </li>
          </ul>
          <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
