import { useEffect } from 'react'
import type { RecentKind } from '@/components/shared/command-palette/palette-types'
import { forgetRecent, recordRecent } from '@/components/shared/command-palette/recent-items'
import { useAuthStore } from '@/states/auth.store'

/**
 * Keeps a detail page's item in the palette's recents: recorded once the
 * page has loaded it, under the label (and detail) the page shows, however
 * the page was reached; removed when the page answers 404.
 * @param kind - What the page shows.
 * @param id - The item's id, from the route.
 * @param shown - The label and detail once loaded; undefined while loading or failed.
 * @param notFound - Whether the page's read answered 404.
 */
export function useRecordRecent(
  kind: RecentKind,
  id: string,
  shown: { label: string; detail?: string } | undefined,
  notFound: boolean
): void {
  const userId = useAuthStore((state) => state.user?.id)
  const label = shown?.label
  const detail = shown?.detail
  useEffect(() => {
    if (!userId) return
    if (notFound) forgetRecent(userId, kind, id)
    else if (label !== undefined) recordRecent(userId, { kind, id, label, detail })
  }, [userId, kind, id, label, detail, notFound])
}
