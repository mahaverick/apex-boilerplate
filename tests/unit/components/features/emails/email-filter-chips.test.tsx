import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { TenantFilterChip, UserFilterChip } from '@/components/features/emails/email-filter-chips'

/** Renders a chip under a query client, which both chips construct their query against. */
function renderChip(chip: React.ReactElement) {
  render(<QueryClientProvider client={new QueryClient()}>{chip}</QueryClientProvider>)
}

describe('filter chips', () => {
  it('masks only the user name, not the "User: " prefix', () => {
    renderChip(<UserFilterChip userId="u1" knownName="Ada Lovelace" onRemove={() => {}} />)
    const name = screen.getByText('Ada Lovelace')
    expect(name).toHaveClass('ph-mask')
    expect(name.parentElement).not.toHaveClass('ph-mask')
    expect(name.parentElement).toHaveTextContent('User: Ada Lovelace')
  })

  it('leaves a tenant name unmasked', () => {
    renderChip(<TenantFilterChip tenantId="t1" knownName="Acme" onRemove={() => {}} />)
    expect(screen.getByText('Tenant: Acme')).not.toHaveClass('ph-mask')
  })
})
