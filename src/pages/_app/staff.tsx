import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old Staff page; it lives in Settings › Platform now, so bookmarks land there. */
export const Route = createFileRoute('/_app/staff')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/platform/staff', search: true, hash: true, replace: true })
  },
})
