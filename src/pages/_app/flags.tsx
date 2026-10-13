import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old Feature flags page; it lives in Settings › Platform now, so bookmarks land there. */
export const Route = createFileRoute('/_app/flags')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/platform/flags', search: true, hash: true, replace: true })
  },
})
