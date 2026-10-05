import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layouts/app-layout'
import { isStaff } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { ensureFlags } from '@/observability/flags/flag-query'
import { PLATFORM_FLAG_SCOPE } from '@/observability/flags/flag-scope'
import { useAuthStore } from '@/states/auth.store'

/**
 * Staff only. The API is the real gate; this only keeps a signed-in non-staff
 * user out of a shell whose every request would answer 404. The loader reads
 * Apex's flags before the shell renders, so a flagged nav item never flashes;
 * a failed read resolves to the fallbacks and never blocks the page.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    const { isAuthenticated, user } = useAuthStore.getState()
    if (!isAuthenticated) {
      throw redirect({ to: ROUTES.login, search: { redirect: location.href } })
    }
    if (!isStaff(user?.platformRole)) throw redirect({ to: ROUTES.noAccess })
  },
  loader: async ({ context }) => {
    await ensureFlags(context.queryClient, PLATFORM_FLAG_SCOPE)
  },
  component: AppLayout,
})
