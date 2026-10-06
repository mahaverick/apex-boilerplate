import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { Pii } from '@/components/shared/pii'
import { ROUTES } from '@/constants/routes'
import { bannerSentence } from '@/lib/maintenance-mode'
import { maintenanceModeQueryOptions } from '@/queries/maintenance-mode.queries'

/**
 * The red banner on every staff page while customers are in maintenance:
 * the mode, since when and who set it, and a link to the Maintenance page.
 * It reads the platform state (polled every 30 seconds while on), never the
 * `Maintenance-Mode` response header, and shows nothing while the mode is
 * `off`, before the first answer, or when the API answers 404. A failed poll
 * keeps the last answer up.
 */
export function MaintenanceBanner() {
  const state = useQuery(maintenanceModeQueryOptions())
  const view = state.data
  if (view === undefined || view.mode === 'off') return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
      <Pii className="font-medium">{bannerSentence(view)}</Pii>
      <Link to={ROUTES.maintenance} className="underline underline-offset-4">
        Manage
      </Link>
    </div>
  )
}
