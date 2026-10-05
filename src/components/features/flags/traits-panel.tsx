import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TRAIT_WHERE_LABELS } from '@/constants/flags.constants'
import type { TraitRow } from '@/types/api.types'

/**
 * Puts a trait name on the clipboard for pasting into a PostHog release
 * condition, and says whether it worked.
 * @param name - The trait name.
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
    <ul className="grid gap-3">
      {traits.map((trait) => (
        <li key={trait.name} className="grid gap-1 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-sm font-medium">{trait.name}</code>
              <span className="text-xs text-muted-foreground">
                {TRAIT_WHERE_LABELS[trait.where]}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Copy ${trait.name}`}
              onClick={() => void copyTrait(trait.name)}
            >
              <Copy aria-hidden="true" />
              Copy
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{trait.description}</p>
          {trait.examples.length > 0 && (
            <p className="text-xs text-muted-foreground">
              For example{' '}
              {trait.examples.map((example, index) => (
                <span key={example}>
                  {index > 0 && ', '}
                  <code>{example}</code>
                </span>
              ))}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
