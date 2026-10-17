import {
  IconBuilding,
  IconDeviceDesktop,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSun,
  IconUser,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { MAIN_CONTENT_ID } from '@/components/features/skip-link'
import { CreateTenantDialog } from '@/components/features/tenants/create-tenant-dialog'
import { CommandPaletteShell } from '@/components/shared/command-palette/command-palette-shell'
import type {
  PaletteCommand,
  PaletteGroup,
  RecentEntry,
} from '@/components/shared/command-palette/palette-types'
import { remoteGroup } from '@/components/shared/command-palette/remote-group'
import { usePaletteTerm } from '@/components/shared/command-palette/use-palette-term'
import { navItemsFor, type NavPath } from '@/constants/navigation'
import { isStaff, platformRoleAtLeast } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { SETTINGS_SECTIONS, type SettingsPath } from '@/constants/settings'
import { fullName } from '@/lib/format'
import { useFlagValues } from '@/observability/flags/flag-hooks'
import { analyticsKey } from '@/observability/telemetry'
import { useLogout, useLogoutPending } from '@/queries/auth.queries'
import { tenantsListOptions } from '@/queries/tenant-admin.queries'
import { usersListOptions } from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import { useThemeStore, type Theme } from '@/states/theme.store'
import type { TenantLifecycleState } from '@/types/api.types'

/** How many tenants, and how many users, the palette lists for a term. */
const RESULTS_PER_GROUP = 8

/** The fixed `action` each kind of command sends. */
const ACTIONS = {
  page: analyticsKey('open_page'),
  tenant: analyticsKey('open_tenant'),
  user: analyticsKey('open_user'),
  recent: analyticsKey('open_recent'),
  theme: analyticsKey('set_theme'),
  signOut: analyticsKey('sign_out'),
  create: analyticsKey('create_tenant'),
} as const

/** The three themes, as the header's theme menu lists them. */
const THEMES: readonly { value: Theme; label: string; icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'system', label: 'System', icon: IconDeviceDesktop },
]

/** A tenant state worth saying beside a search result; an active tenant says only its slug. */
const STATE_DETAIL: Partial<Record<TenantLifecycleState, string>> = {
  suspended: 'Suspended',
  archived: 'Archived',
}

/**
 * Where focus goes when the New tenant dialog closes. The palette opened it,
 * and its close has already handed focus back, so no trigger is waiting: the
 * page's heading when it takes focus, else the main landmark.
 * @returns The heading for the dialog to focus, or false once the landmark has focus.
 */
function returnFocusToPage(): HTMLElement | false {
  const main = document.getElementById(MAIN_CONTENT_ID)
  const heading = main?.querySelector<HTMLElement>('h1[tabindex]')
  if (heading) return heading
  // Given the landmark, Base UI would focus its first tabbable child (the sidebar toggle), so it is focused here.
  main?.focus({ preventScroll: true })
  return false
}

/**
 * The ⌘K palette's commands: Go to (the pages the role can see, the
 * Settings landing page and every settings section), customer tenants and
 * users from the API, Theme, and Account (New tenant for admins, Sign out).
 * Recent lists the tenants and users opened lately; This page lists what the
 * open page's own controls registered. Tenant and user results show only for
 * the term they were fetched for, so Enter never acts on an older list.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const role = useAuthStore((state) => state.user?.platformRole)
  const flags = useFlagValues()
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const logout = useLogout()
  const signingOut = useLogoutPending()
  const [creating, setCreating] = useState(false)
  const staff = isStaff(role)
  const { current, term, ready } = usePaletteTerm()
  const request = { search: term, limit: RESULTS_PER_GROUP }
  const tenants = useQuery({
    ...tenantsListOptions(request, { total: false }),
    // The list keeps the previous term's page as a placeholder; the palette must not show it.
    placeholderData: undefined,
    enabled: staff && ready,
  })
  const users = useQuery({
    ...usersListOptions(request, { total: false }),
    placeholderData: undefined,
    enabled: staff && ready,
  })

  /** A page row. */
  const page = (
    label: string,
    to: NavPath | SettingsPath | typeof ROUTES.settings,
    icon?: PaletteCommand['icon']
  ): PaletteCommand => ({
    id: to,
    label,
    icon,
    keywords: to.startsWith(ROUTES.settings) ? ['settings'] : undefined,
    action: ACTIONS.page,
    timing: 'immediate',
    run: () => void navigate({ to }),
  })

  const groups: PaletteGroup[] = [
    {
      id: 'navigate',
      commands: [
        ...navItemsFor(role, flags).map((item) => page(item.label, item.to, item.Icon)),
        // Gated as the nav items are: a session whose platform role dropped to null gets no pages.
        ...(staff
          ? [
              page('Settings', ROUTES.settings, IconSettings),
              ...SETTINGS_SECTIONS.map((section) => page(section.label, section.to, section.Icon)),
            ]
          : []),
      ],
    },
    {
      id: 'theme',
      commands: THEMES.map(({ value, label, icon }) => ({
        id: value,
        label,
        icon,
        detail: theme === value ? 'Current' : undefined,
        keywords: ['theme', 'appearance', `${value} mode`],
        action: ACTIONS.theme,
        timing: 'immediate',
        run: () => setTheme(value),
      })),
    },
    {
      id: 'account',
      commands: [
        ...(platformRoleAtLeast(role, 'admin')
          ? [
              {
                id: 'new-tenant',
                label: 'New tenant',
                icon: IconPlus,
                keywords: ['create tenant', 'add tenant'],
                action: ACTIONS.create,
                timing: 'afterClose' as const,
                run: () => setCreating(true),
              },
            ]
          : []),
        {
          id: 'sign-out',
          label: 'Sign out',
          icon: IconLogout,
          keywords: ['log out', 'logout'],
          disabled: signingOut,
          action: ACTIONS.signOut,
          timing: 'immediate',
          run: () => logout.mutate(),
        },
      ],
    },
  ]

  const remote = [
    remoteGroup({
      id: 'tenants',
      enabled: staff,
      current,
      term,
      query: tenants,
      toCommands: (data) =>
        data.items.map((row) => ({
          id: row.id,
          label: row.name,
          detail: [row.slug, STATE_DETAIL[row.lifecycleState]].filter(Boolean).join(' · '),
          icon: IconBuilding,
          action: ACTIONS.tenant,
          timing: 'immediate',
          run: () => void navigate({ to: ROUTES.tenant, params: { tenantId: row.id } }),
        })),
    }),
    remoteGroup({
      id: 'users',
      enabled: staff,
      current,
      term,
      query: users,
      toCommands: (data) =>
        data.items.map((row) => ({
          id: row.id,
          label: row.email,
          detail: fullName(row) ?? undefined,
          icon: IconUser,
          pii: true,
          action: ACTIONS.user,
          timing: 'immediate',
          run: () => void navigate({ to: ROUTES.user, params: { userId: row.id } }),
        })),
    }),
  ]

  /** A recent tenant or user as a row that opens its page; none for a caller who is not staff. */
  const recentToCommand = (entry: RecentEntry): PaletteCommand | null => {
    if (!staff) return null
    return entry.kind === 'tenant'
      ? {
          id: entry.id,
          label: entry.label,
          detail: entry.detail,
          icon: IconBuilding,
          action: ACTIONS.recent,
          timing: 'immediate',
          run: () => void navigate({ to: ROUTES.tenant, params: { tenantId: entry.id } }),
        }
      : {
          id: entry.id,
          label: entry.label,
          icon: IconUser,
          pii: true,
          action: ACTIONS.recent,
          timing: 'immediate',
          run: () => void navigate({ to: ROUTES.user, params: { userId: entry.id } }),
        }
  }

  return (
    <>
      <CommandPaletteShell
        groups={groups}
        remote={remote}
        recentToCommand={recentToCommand}
        inputLabel="Search pages, tenants and users"
        placeholder="Search pages, tenants and users…"
        description="Go to a page, a tenant or a user, or run an action."
      />
      <CreateTenantDialog
        trigger={false}
        open={creating}
        onOpenChange={setCreating}
        finalFocus={returnFocusToPage}
        onCreated={(tenant) =>
          void navigate({ to: ROUTES.tenant, params: { tenantId: tenant.id } })
        }
      />
    </>
  )
}
