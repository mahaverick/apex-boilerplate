import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES } from '@/constants/routes'

/**
 * The panel an admin-only page shows staff below admin, matching the API's
 * 404: the page never confirms it exists to someone it refuses.
 */
export function PlatformNotFound() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Page not available</h1>
        </CardTitle>
        <CardDescription>
          This page does not exist, or it is not available to your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link to={ROUTES.overview} className="text-sm underline underline-offset-4">
          Back to the overview
        </Link>
      </CardContent>
    </Card>
  )
}
