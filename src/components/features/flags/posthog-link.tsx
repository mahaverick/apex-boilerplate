/** A link to a flag in PostHog, opening in a new tab; nothing when the API has no URL for it. */
export function PosthogLink({ href, flagKey }: { href: string | null; flagKey: string }) {
  if (href === null) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sm whitespace-nowrap underline-offset-4 hover:underline"
    >
      Open in PostHog <span aria-hidden="true">↗</span>
      <span className="sr-only"> ({flagKey}, opens in a new tab)</span>
    </a>
  )
}
