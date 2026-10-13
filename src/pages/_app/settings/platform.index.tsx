import { createFileRoute, redirect } from '@tanstack/react-router'

/** The Platform group's root opens Staff, keeping the query and hash. */
export const Route = createFileRoute('/_app/settings/platform/')({
  beforeLoad: () => {
    throw redirect({
      to: '/settings/platform/staff',
      search: true,
      hash: true,
      replace: true,
    })
  },
})
