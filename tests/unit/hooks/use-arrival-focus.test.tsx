import { render, renderHook, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useArrivalFocus, useLeavingFinalFocus } from '@/hooks/use-arrival-focus'
import { requestArrivalFocus, takeArrivalFocus } from '@/lib/arrival-focus'

/** A page heading that takes arrival focus once `ready`. */
function Page({ ready = true, record }: { ready?: boolean; record?: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useArrivalFocus(heading, ready, record)
  return (
    <h1 ref={heading} tabIndex={-1}>
      Page
    </h1>
  )
}

describe('useArrivalFocus', () => {
  // A test that fails mid-way must not leave the flag set for the next one.
  afterEach(() => void takeArrivalFocus())

  it('focuses once after a request, and not on a later mount', () => {
    requestArrivalFocus()
    const first = render(<Page />)
    expect(screen.getByRole('heading', { name: 'Page' })).toHaveFocus()
    first.unmount()

    render(<Page />)
    expect(screen.getByRole('heading', { name: 'Page' })).not.toHaveFocus()
  })

  it('does nothing without a request', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { name: 'Page' })).not.toHaveFocus()
  })

  it('keeps the request while the page is not ready, and focuses once it is', () => {
    requestArrivalFocus()
    const { rerender } = render(<Page ready={false} />)
    expect(screen.getByRole('heading', { name: 'Page' })).not.toHaveFocus()
    rerender(<Page ready />)
    expect(screen.getByRole('heading', { name: 'Page' })).toHaveFocus()
    expect(takeArrivalFocus()).toBe(false)
  })

  it('leaves a request made on the page to the next one, and takes it when the record changes', () => {
    const { rerender } = render(<Page record="a" />)
    const heading = screen.getByRole('heading', { name: 'Page' })
    requestArrivalFocus()
    rerender(<Page record="a" />)
    expect(heading).not.toHaveFocus()
    rerender(<Page record="b" />)
    expect(heading).toHaveFocus()
  })
})

describe('takeArrivalFocus', () => {
  it('returns the request once and clears it', () => {
    expect(takeArrivalFocus()).toBe(false)
    requestArrivalFocus()
    expect(takeArrivalFocus()).toBe(true)
    expect(takeArrivalFocus()).toBe(false)
  })
})

describe('useLeavingFinalFocus', () => {
  afterEach(() => void takeArrivalFocus())

  /** The hook's result for `otherwise`. */
  function capture(otherwise: Parameters<typeof useLeavingFinalFocus>[0]) {
    return renderHook(() => useLeavingFinalFocus(otherwise)).result.current
  }

  it('restores nothing after leave, once, and asks the next page for arrival focus', () => {
    const api = capture(undefined)
    expect(api.finalFocus('mouse')).toBe(true)
    api.leave()
    expect(takeArrivalFocus()).toBe(true)
    expect(api.finalFocus('mouse')).toBe(false)
    expect(api.finalFocus('mouse')).toBe(true)
  })

  it('otherwise defers to the value given: an element, a ref or a function', () => {
    const element = document.createElement('button')
    expect(capture({ current: element }).finalFocus('keyboard')).toBe(element)
    expect(capture(() => false).finalFocus('keyboard')).toBe(false)
    expect(capture(false).finalFocus('keyboard')).toBe(false)
  })
})
