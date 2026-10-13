import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old Maintenance page; it lives in Settings › Platform now, so bookmarks land there. */
export const Route = createFileRoute('/_app/maintenance')({
  beforeLoad: () => {
    throw redirect({
      to: '/settings/platform/maintenance',
      search: true,
      hash: true,
      replace: true,
    })
  },
})
