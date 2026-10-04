import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Pii } from '@/components/shared/pii'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { fullName } from '@/lib/format'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'

export const Route = createFileRoute('/_app/users/$userId')({
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(platformUserQueryOptions(params.userId))
  },
  head: () => ({ meta: [{ title: pageTitle('User') }] }),
  staticData: { crumb: UserCrumb, crumbParent: { label: 'Users', to: ROUTES.users } },
  component: Outlet,
})

/** The user's name, else their email, in the trail once their detail has loaded. */
function UserCrumb({ params }: { params: Record<string, string> }) {
  const { data } = useQuery(platformUserQueryOptions(params.userId ?? ''))
  return data === undefined ? 'User' : <Pii>{fullName(data) ?? data.email}</Pii>
}
