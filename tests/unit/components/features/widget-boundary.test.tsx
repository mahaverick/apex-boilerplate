import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WidgetBoundary } from '@/components/features/widget-boundary'

function Explodes(): never {
  throw new Error('chart exploded')
}

describe('WidgetBoundary', () => {
  it('contains a render error to its own widget', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <>
        <WidgetBoundary name="Sign-ups">
          <Explodes />
        </WidgetBoundary>
        <p>Sibling still here</p>
      </>
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-ups could not be shown.')
    expect(screen.getByText('Sibling still here')).toBeInTheDocument()
  })
})
