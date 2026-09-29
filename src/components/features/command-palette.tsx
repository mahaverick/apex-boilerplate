import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Building2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { navItemsFor, type NavPath } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { platformTenantsQueryOptions, SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'

/** How many tenants the palette lists for a term. */
const TENANT_RESULTS = 8

type PaletteItem =
  | { kind: 'page'; value: string; label: string; to: NavPath }
  | { kind: 'tenant'; value: string; label: string; slug: string }

interface PaletteGroup {
  value: string
  items: PaletteItem[]
}

/**
 * The ⌘K / Ctrl+K palette: the pages the user's role can see, filtered here,
 * and customer tenants, filtered by the API. Tenant results are shown only for
 * the term they were fetched for, so Enter can never act on an older term's
 * list. Choosing a tenant opens the Tenants page filtered to it.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const open = useCommandPaletteStore((state) => state.open)
  const setOpen = useCommandPaletteStore((state) => state.setOpen)
  const toggle = useCommandPaletteStore((state) => state.toggle)
  const role = useAuthStore((state) => state.user?.platformRole)
  const shortcutsId = useId()
  const [query, setQuery] = useState('')
  const term = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const tenants = useQuery({
    ...platformTenantsQueryOptions(term, undefined, TENANT_RESULTS),
    enabled: open && term !== '',
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  const needle = query.trim().toLowerCase()
  const pages: PaletteItem[] = navItemsFor(role)
    .filter((item) => needle === '' || item.label.toLowerCase().includes(needle))
    .map((item) => ({ kind: 'page', value: item.to, label: item.label, to: item.to }))
  // Only the current term's results: a stale list must never take the Enter.
  const isCurrent = term === query.trim() && tenants.data !== undefined && !tenants.isFetching
  const tenantItems: PaletteItem[] = isCurrent
    ? tenants.data.tenants.map((row) => ({
        kind: 'tenant',
        value: row.id,
        label: row.name,
        slug: row.slug,
      }))
    : []
  const groups: PaletteGroup[] = [
    ...(pages.length > 0 ? [{ value: 'Pages', items: pages }] : []),
    ...(tenantItems.length > 0 ? [{ value: 'Tenants', items: tenantItems }] : []),
  ]

  function close() {
    setOpen(false)
    setQuery('')
  }

  function choose(item: PaletteItem) {
    close()
    if (item.kind === 'page') {
      void navigate({ to: item.to })
    } else {
      void navigate({ to: ROUTES.tenants, search: { q: item.label } as never })
    }
  }

  const tenantStatus =
    term === ''
      ? null
      : tenants.isError
        ? 'Tenants could not be searched.'
        : tenants.isFetching || term !== query.trim()
          ? 'Searching tenants…'
          : null

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
        else setOpen(true)
      }}
    >
      <Command
        open
        inline
        items={groups}
        filteredItems={groups}
        value={query}
        onValueChange={(next) => setQuery(next)}
        autoHighlight="always"
        keepHighlight
      >
        <CommandInput
          aria-label="Search pages and tenants"
          aria-describedby={shortcutsId}
          placeholder="Search pages and tenants…"
        />
        <p role="status" aria-live="polite" className="px-3 pt-2 text-xs text-muted-foreground">
          {tenantStatus}
        </p>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandList>
          {(group: PaletteGroup) => (
            <CommandGroup key={group.value} items={group.items}>
              <CommandGroupLabel>{group.value}</CommandGroupLabel>
              <CommandCollection>
                {(item: PaletteItem) => (
                  <CommandItem key={item.value} value={item} onClick={() => choose(item)}>
                    {item.kind === 'page' ? null : <Building2 aria-hidden />}
                    <span className="truncate">{item.label}</span>
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
          )}
        </CommandList>
        <p id={shortcutsId} className="sr-only">
          Use the arrow keys to move and Enter to open the highlighted item.
        </p>
      </Command>
    </CommandDialog>
  )
}
