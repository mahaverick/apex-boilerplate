import { IconCopy } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
import { TRAIT_WHERE_LABELS } from '@/constants/flags.constants'
import { toast } from '@/lib/toast'
import type { TraitRow } from '@/types/api.types'

/**
 * Puts a trait name on the clipboard for pasting into a PostHog release
 * condition, and says whether it worked.
 */
async function copyTrait(name: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(name)
    toast.success(`Copied ${name}`)
  } catch {
    toast.error(`Could not copy ${name}`)
  }
}

/**
 * The only properties a PostHog release condition may use, as express
 * supplies them at evaluation time. A condition on any other property makes
 * the flag unsupported, so it serves its fallback.
 */
export function TraitsPanel({ traits }: { traits: TraitRow[] }) {
  return (
    <ItemGroup className="gap-3 has-data-[size=sm]:gap-3">
      {traits.map((trait) => (
        <Item key={trait.name} variant="outline" size="sm" role="listitem">
          <ItemContent className="min-w-0">
            <ItemTitle className="line-clamp-none">
              <code className="text-sm font-medium">{trait.name}</code>
              <span className="text-xs font-normal text-muted-foreground">
                {TRAIT_WHERE_LABELS[trait.where]}
              </span>
            </ItemTitle>
            <ItemDescription className="line-clamp-none">{trait.description}</ItemDescription>
            {trait.examples.length > 0 && (
              <ItemDescription className="line-clamp-none text-xs">
                For example{' '}
                {trait.examples.map((example, index) => (
                  <span key={example}>
                    {index > 0 && ', '}
                    <code>{example}</code>
                  </span>
                ))}
              </ItemDescription>
            )}
          </ItemContent>
          <ItemActions>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Copy ${trait.name}`}
              onClick={() => void copyTrait(trait.name)}
            >
              <IconCopy aria-hidden="true" />
              Copy
            </Button>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}
