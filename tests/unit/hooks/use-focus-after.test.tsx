import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { useFocusAfter } from '@/hooks/use-focus-after'

type Key = 'row' | 'heading'
type Api = ReturnType<typeof useFocusAfter<Key>>

/** A trigger that can be taken away, two landmarks, and an input to move focus to; the hook's api goes to the test, which has no other way to reach it. */
function Harness({
  hasTrigger,
  hasRow,
  hasExtra = false,
  onApi,
}: {
  hasTrigger: boolean
  hasRow: boolean
  hasExtra?: boolean
  onApi: (api: Api) => void
}) {
  const focus = useFocusAfter<Key>()
  useEffect(() => {
    onApi(focus)
  }, [focus, onApi])
  return (
    <div>
      <h2 ref={focus.target('heading')} tabIndex={-1}>
        Heading
      </h2>
      {hasRow && (
        <div ref={focus.target('row')} tabIndex={-1} data-testid="row">
          Row
        </div>
      )}
      {hasTrigger && <button>Act</button>}
      <input aria-label="Elsewhere" />
      {hasExtra && <p>Unrelated</p>}
    </div>
  )
}

describe('useFocusAfter', () => {
  let api: Api
  const take = (value: Api) => {
    api = value
  }

  /** Focuses the trigger and requests the move, as an action's success path does. */
  function succeed(keys: Key | Key[]) {
    const trigger = screen.getByRole('button', { name: 'Act' })
    trigger.focus()
    act(() => {
      api.focusAfter(keys, trigger)
    })
    return trigger
  }

  it('moves focus to the first target present once the trigger is gone', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    succeed(['row', 'heading'])
    expect(screen.getByRole('button', { name: 'Act' })).toHaveFocus()

    rerender(<Harness hasTrigger={false} hasRow onApi={take} />)
    await act(async () => {})
    expect(screen.getByTestId('row')).toHaveFocus()
  })

  it('falls back to the next target when the first is gone with the trigger', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    succeed(['row', 'heading'])
    rerender(<Harness hasTrigger={false} hasRow={false} onApi={take} />)
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Heading' })).toHaveFocus()
  })

  it('leaves focus on a trigger that stays', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    const trigger = succeed('heading')
    rerender(<Harness hasTrigger hasRow={false} onApi={take} />)
    await act(async () => {})
    expect(trigger).toHaveFocus()
  })

  it('does not take focus from somewhere the reader has gone since', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    succeed('heading')
    await user.click(screen.getByLabelText('Elsewhere'))
    rerender(<Harness hasTrigger={false} hasRow onApi={take} />)
    await act(async () => {})
    expect(screen.getByLabelText('Elsewhere')).toHaveFocus()
  })

  it('drops a request whose targets are not there, so a later mount does not take focus', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow={false} onApi={take} />)
    succeed('row')
    rerender(<Harness hasTrigger={false} hasRow={false} onApi={take} />)
    await act(async () => {})
    expect(document.body).toHaveFocus()

    rerender(<Harness hasTrigger={false} hasRow onApi={take} />)
    await act(async () => {})
    expect(document.body).toHaveFocus()
  })

  it('lets a newer request supersede one still waiting', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    succeed('row')
    succeed('heading')
    rerender(<Harness hasTrigger={false} hasRow onApi={take} />)
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Heading' })).toHaveFocus()
  })

  it('ends a request when the reader moved on, so a later unrelated change does not move focus', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    succeed('heading')
    await user.click(screen.getByLabelText('Elsewhere'))
    rerender(<Harness hasTrigger={false} hasRow onApi={take} />)
    await act(async () => {})
    screen.getByLabelText('Elsewhere').blur()
    expect(document.body).toHaveFocus()

    rerender(<Harness hasTrigger={false} hasRow hasExtra onApi={take} />)
    await act(async () => {})
    expect(document.body).toHaveFocus()
  })

  it('ends a request when the button stays, so a later removal does not move focus', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    const trigger = succeed('heading')
    expect(api.finalFocus(trigger)).toBe(true)
    expect(trigger).toHaveFocus()

    trigger.blur()
    rerender(<Harness hasTrigger={false} hasRow hasExtra onApi={take} />)
    await act(async () => {})
    expect(document.body).toHaveFocus()
  })

  it('does not leave a landed target for the next dialog to consume', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    const trigger = succeed('heading')
    expect(api.finalFocus(trigger)).toBe(true)
    rerender(<Harness hasTrigger={false} hasRow onApi={take} />)
    await act(async () => {})

    const other = document.createElement('button')
    document.body.append(other)
    expect(api.finalFocus(other)).toBe(true)
    other.remove()
  })

  it('does not leave a landed target when the move comes after the dialog closed', async () => {
    const { rerender } = render(<Harness hasTrigger hasRow onApi={take} />)
    const trigger = succeed('heading')
    trigger.blur()
    act(() => {
      api.focusAfter('heading')
    })
    expect(api.finalFocus()).toBe(false)
    rerender(<Harness hasTrigger={false} hasRow onApi={take} />)
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Heading' })).toHaveFocus()

    expect(api.finalFocus(screen.getByLabelText('Elsewhere'))).toBe(true)
  })
})
