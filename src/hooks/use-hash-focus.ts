import { useLocation } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

/**
 * Focuses a card's heading when the URL hash names the card, so an alert's link
 * lands on it. The heading carries `tabIndex={-1}` and takes the returned ref.
 * @param hash - The hash that names the card, without `#`.
 * @returns The ref for the heading.
 */
export function useHashFocus(hash: string) {
  const heading = useRef<HTMLHeadingElement>(null)
  const current = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    if (current === hash) heading.current?.focus()
  }, [current, hash])
  return heading
}
