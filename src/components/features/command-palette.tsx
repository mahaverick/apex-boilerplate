import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Building2, UserRound } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Pii } from '@/components/shared/pii'
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
import { isStaff } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { analyticsKey, track } from '@/observability/analytics'
import { isRoleDenied, SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { platformTenantsQueryOptions } from '@/queries/tenant-admin.queries'
import { platformUsersQueryOptions } from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'

/** How many tenants, and how many users, the palette lists for a term. */
const RESULTS_PER_GROUP = 8

/** What choosing each kind of item does, as `command_palette_action_run` names it. */
const PALETTE_ACTIONS = {
  page: analyticsKey('open_page'),
  tenant: analyticsKey('open_tenant'),
  user: analyticsKey('open_user'),
} as const

type PaletteItem =
  | { kind: 'page'; value: string; label: string; to: NavPath }
  | { kind: 'tenant'; value: string; label: string }
  | { kind: 'user'; value: string; label: string; detail: string | null }

interface PaletteGroup {
  value: string
  items: PaletteItem[]
}

/**
 * The ⌘K / Ctrl+K palette: the pages the user's role can see, filtered here,
 * and customer tenants and users, filtered by the API. Choosing a tenant or a
 * user opens its detail page. Tenant and user results are each shown only for
 * the term they were fetched for, so Enter can never act on an older term's
 * list. Every close
 * clears the search, however it closed: the shortcut and the header flip the
 * store's `open` directly, and Base UI fires no `onOpenChange` for that.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const open = useCommandPaletteStore((state) => state.open)
  const setOpen = useCommandPaletteStore((state) => state.setOpen)
  const toggle = useCommandPaletteStore((state) => state.toggle)
  const role = useAuthStore((state) => state.user?.platformRole)
  const shortcutsId = useId()
  const [query, setQuery] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  // Base UI reports no change when `open` is flipped from outside, so reset here.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setQuery('')
  }
  const staff = isStaff(role)
  const current = query.trim()
  const term = useDebouncedValue(current, SEARCH_DEBOUNCE_MS)
  const tenants = useQuery({
    ...platformTenantsQueryOptions({ q: term, limit: RESULTS_PER_GROUP }),
    enabled: open && staff && term !== '',
  })
  const users = useQuery({
    ...platformUsersQueryOptions({ q: term, limit: RESULTS_PER_GROUP }),
    // The users query keeps the previous term's page as placeholder; the palette must not show it.
    placeholderData: undefined,
    enabled: open && staff && term !== '',
  })

  useEffect(() => {
    if (open) track('command_palette_opened')
  }, [open])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || event.defaultPrevented) return
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      // The physical key, so the shortcut works on non-Latin layouts too.
      if (event.code !== 'KeyK') return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  const needle = current.toLowerCase()
  const pages: PaletteItem[] = navItemsFor(role)
    .filter((item) => needle === '' || item.label.toLowerCase().includes(needle))
    .map((item) => ({ kind: 'page', value: item.to, label: item.label, to: item.to }))
  // Only the current term's results: a stale list must never take the Enter.
  const tenantsCurrent = term === current && tenants.data !== undefined && !tenants.isFetching
  const usersCurrent = term === current && users.data !== undefined && !users.isFetching
  const tenantItems: PaletteItem[] = tenantsCurrent
    ? tenants.data.tenants.map((row) => ({ kind: 'tenant', value: row.id, label: row.name }))
    : []
  const userItems: PaletteItem[] = usersCurrent
    ? users.data.users.map((row) => ({
        kind: 'user',
        value: row.id,
        label: row.email,
        detail: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
      }))
    : []
  const groups: PaletteGroup[] = [
    ...(pages.length > 0 ? [{ value: 'Pages', items: pages }] : []),
    ...(tenantItems.length > 0 ? [{ value: 'Tenants', items: tenantItems }] : []),
    ...(userItems.length > 0 ? [{ value: 'Users', items: userItems }] : []),
  ]

  function choose(item: PaletteItem) {
    track('command_palette_action_run', { action: PALETTE_ACTIONS[item.kind] })
    setOpen(false)
    if (item.kind === 'page') void navigate({ to: item.to })
    else if (item.kind === 'tenant') {
      void navigate({ to: ROUTES.tenant, params: { tenantId: item.value } })
    } else void navigate({ to: ROUTES.user, params: { userId: item.value } })
  }

  const searching =
    staff && current !== '' && (term !== current || tenants.isFetching || users.isFetching)
  // An error belongs to `term`, so it is shown only once `term` is what is typed.
  const failed =
    term === current &&
    ((tenants.isError && !isRoleDenied(tenants.error)) ||
      (users.isError && !isRoleDenied(users.error)))
  const searchStatus =
    !staff || current === ''
      ? null
      : searching
        ? 'Searching…'
        : failed
          ? 'Some results could not be loaded.'
          : null

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
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
          aria-label="Search pages, tenants and users"
          aria-describedby={shortcutsId}
          placeholder="Search pages, tenants and users…"
        />
        <p role="status" aria-live="polite" className="px-3 pt-2 text-xs text-muted-foreground">
          {searchStatus}
        </p>
        <CommandEmpty>{searching ? null : 'No results.'}</CommandEmpty>
        <CommandList>
          {(group: PaletteGroup) => (
            <CommandGroup key={group.value} items={group.items}>
              <CommandGroupLabel>{group.value}</CommandGroupLabel>
              <CommandCollection>
                {(item: PaletteItem) => (
                  <CommandItem key={item.value} value={item} onClick={() => choose(item)}>
                    {item.kind === 'tenant' && <Building2 aria-hidden />}
                    {item.kind === 'user' && <UserRound aria-hidden />}
                    {item.kind === 'user' ? (
                      <Pii className="truncate">{item.label}</Pii>
                    ) : (
                      <span className="truncate">{item.label}</span>
                    )}
                    {item.kind === 'user' && item.detail && (
                      <Pii className="ml-auto truncate text-xs text-muted-foreground">
                        {item.detail}
                      </Pii>
                    )}
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
