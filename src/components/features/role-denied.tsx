import { IconLock } from '@tabler/icons-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * What a staff page shows when the API answers 404 for the caller's role: the
 * role changed after the page loaded. It does not sign out; reloading re-runs
 * the guards, which send a user who is not staff to /no-access. A destructive
 * alert (`role="alert"`) announces the denial.
 */
export function RoleDenied() {
  return (
    <Alert variant="destructive">
      <IconLock aria-hidden="true" />
      <AlertTitle>Your role can’t see this any more.</AlertTitle>
      <AlertDescription>If your access just changed, reload the page.</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </AlertAction>
    </Alert>
  )
}
