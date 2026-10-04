import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES } from '@/constants/routes'

/** What a user's pages show when `GET /platform/users/:id` answers 404: unknown, or purged. */
export function UserNotFound() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h1>User not found</h1>
        </CardTitle>
        <CardDescription>This user does not exist, or was permanently deleted.</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to={ROUTES.users} className="text-sm underline underline-offset-4">
          Back to users
        </Link>
      </CardContent>
    </Card>
  )
}
