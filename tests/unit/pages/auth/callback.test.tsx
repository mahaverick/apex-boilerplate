import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Route } from '@/pages/auth/callback'

const navigate = vi.fn()

// The page navigates away in its first effect; a stub navigate keeps it on screen so the card can be asserted.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

describe('/auth/callback', () => {
  it('shows the signing-in card: one h1 and a status region in the main landmark', () => {
    const Page = Route.options.component
    if (!Page) throw new Error('The callback route has no component.')
    render(<Page />)

    const main = screen.getByRole('main')
    expect(screen.getByRole('heading', { name: 'Signing in', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Completing sign-in…')
    expect(main).toContainElement(screen.getByRole('status'))
    expect(navigate).toHaveBeenCalledOnce()
  })
})
