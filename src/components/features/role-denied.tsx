import { Button } from '@/components/ui/button'

/**
 * What a staff page shows when the API answers 404 for the caller's role: the
 * role changed after the page loaded. It does not sign out; reloading re-runs
 * the guards, which send a user who is no longer staff to /no-access.
 */
export function RoleDenied() {
  return (
    <div role="alert" className="grid justify-items-start gap-3 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">
        Your role can’t see this any more. If your access just changed, reload the page.
      </p>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  )
}
