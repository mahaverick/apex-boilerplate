import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/constants/app'

export const Route = createFileRoute('/_app/overview')({
  head: () => ({ meta: [{ title: pageTitle('Overview') }] }),
  staticData: { crumb: 'Overview' },
  component: OverviewPage,
})

function OverviewPage() {
  return <h1 className="text-2xl font-semibold">Overview</h1>
}
