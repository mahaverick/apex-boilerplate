import { render } from '@testing-library/react'
import { toast } from 'sonner'
import { expect } from 'vitest'

/**
 * A `getByText` matcher for a sentence whose value sits in its own `<Pii>` element, which splits the
 * text across nodes. It matches the deepest element whose whole text content matches, so a test
 * still names the sentence rather than a fragment of it.
 * @param text - A string (the element's full text) or a pattern (tested against it).
 */
export function byContent(text: string | RegExp) {
  /** Whether `content` reads `text`. */
  const matches = (content: string | null) =>
    typeof text === 'string' ? content?.trim() === text : text.test(content ?? '')
  /** Whether `element` is the deepest one reading `text`. */
  const deepest = (_: string, element: Element | null) =>
    element !== null &&
    matches(element.textContent) &&
    ![...element.children].some((child) => matches(child.textContent))
  return deepest
}

/**
 * Renders a toast's content, which a test captured from a spied `toast.success`, and checks that it
 * reads `sentence` with only `value` masked.
 * @param content - The first argument the toast was called with.
 * @param sentence - The text it reads.
 * @param value - The person's value, the only masked text.
 */
export function expectMaskedToast(
  content: Parameters<typeof toast.success>[0],
  sentence: string,
  value: string
) {
  const { container, unmount } = render(<>{typeof content === 'function' ? null : content}</>)
  expect(container).toHaveTextContent(sentence)
  const masked = container.querySelectorAll('.ph-sensitive.ph-mask')
  expect(masked).toHaveLength(1)
  expect(masked[0]).toHaveTextContent(new RegExp(`^${value.replaceAll('.', '\\.')}$`))
  unmount()
}
