import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/constants/app'

export const Route = createFileRoute('/_app/tenants')({
  head: () => ({ meta: [{ title: pageTitle('Tenants') }] }),
  staticData: { crumb: 'Tenants' },
  component: TenantsPage,
})

function TenantsPage() {
  return <h1 className="text-2xl font-semibold">Tenants</h1>
}
