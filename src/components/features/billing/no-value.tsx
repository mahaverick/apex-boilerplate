/**
 * An empty cell or value: a dash on screen, and words for a screen reader,
 * which would otherwise read "em dash" or nothing.
 */
export function NoValue({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
