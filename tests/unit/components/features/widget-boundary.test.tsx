import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { WidgetBoundary } from '@/components/features/widget-boundary'
import { rootErrorOptions } from '@/observability/errors'
import { report } from '@/observability/errors/report'

vi.mock('@/observability/errors/report', () => ({ report: vi.fn() }))

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

  it("is reported once, as handled, origin react, through the root's onCaughtError", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container, rootErrorOptions)
    act(() => {
      root.render(
        <WidgetBoundary name="Sign-ups">
          <Explodes />
        </WidgetBoundary>
      )
    })
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    const [error, origin, handled] = vi.mocked(report).mock.calls[0] ?? []
    expect((error as Error).message).toBe('chart exploded')
    expect(origin).toBe('react')
    expect(handled).toBe(true)
    expect(container.textContent).toContain('Sign-ups could not be shown.')
    act(() => root.unmount())
    container.remove()
  })
})
