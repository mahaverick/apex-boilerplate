import { usePaletteCommands } from '@/components/shared/command-palette/palette-registry'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'

/**
 * Registers a detail page's own This page commands (its tabs, Copy ID) and
 * renders nothing. A page renders it once its item has loaded, after the
 * component that registers the item's actions, so the actions always come
 * first: the registry lists sources in the order they first register, and a
 * source that registered while the page was still loading would come first.
 */
export function PagePaletteCommands({
  source,
  commands,
}: {
  /** The source's name ("tenant-page"). */
  source: string
  /** The page's commands. */
  commands: readonly PaletteCommand[]
}) {
  usePaletteCommands(source, commands)
  return null
}
