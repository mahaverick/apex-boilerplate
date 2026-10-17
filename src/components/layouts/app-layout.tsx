import { IconSearch } from '@tabler/icons-react'
import { Link, Outlet, useLocation, useMatches, type LinkProps } from '@tanstack/react-router'
import { Fragment, useEffect, type ReactNode } from 'react'
import { MaintenanceBanner } from '@/components/features/maintenance/maintenance-banner'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { UserMenu } from '@/components/features/user-menu'
import { NavMain } from '@/components/layouts/nav-main'
import { NavSecondary } from '@/components/layouts/nav-secondary'
import { NavSettings } from '@/components/layouts/nav-settings'
import { AppMark } from '@/components/shared/app-mark'
import { CommandPaletteHost } from '@/components/shared/command-palette/command-palette-host'
import { prefetchPalette } from '@/components/shared/command-palette/palette-loader'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { APP_NAME } from '@/constants/app'
import { navGroupsFor } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { isSettingsPath } from '@/constants/settings'
import { useIsMobile } from '@/hooks/use-mobile'
import { isApplePlatform, paletteShortcutHint } from '@/lib/shortcut'
import { useFeaturePropertiesSync, useFlagValues } from '@/observability/flags/flag-hooks'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'

/** One link in the breadcrumb trail. */
interface Crumb {
  /** Stable across renders: one crumb per matched route, and one per parent crumb. */
  key: string
  label: ReactNode
  /** The resolved path of that match, with its params filled in. */
  to: LinkProps['to']
}

/**
 * The trail for the current location, in route order, read off each match's
 * `staticData.crumb` and `crumbParent` (see the augmentation in `@/router`).
 * Pathless layout matches (`__root__`, `/_app`) declare no crumb and drop
 * out. An index match's trailing slash is trimmed, so `/tenants/` and the
 * nav's `/tenants` are one href.
 */
function useBreadcrumbs(): Crumb[] {
  const matches = useMatches()
  return matches.flatMap((match) => {
    const { crumb: Label, crumbParent } = match.staticData
    if (Label === undefined) return []
    const params = match.params as Record<string, string>
    const path = match.pathname.replace(/(.)\/+$/, '$1')
    const own: Crumb = {
      key: match.routeId,
      label: typeof Label === 'string' ? Label : <Label params={params} />,
      to: path as LinkProps['to'],
    }
    return crumbParent === undefined
      ? [own]
      : [{ key: `${match.routeId}:parent`, label: crumbParent.label, to: crumbParent.to }, own]
  })
}

/**
 * The sidebar's header: the Apex mark, name and a caption, styled like
 * sidebar-07's team switcher but a plain link to Overview, since staff have
 * no tenant to switch. It sits in a `header` (the banner), since axe's
 * `region` rule exempts buttons but not links. Collapsed to icons, only the
 * mark shows and the tooltip names it.
 */
function SidebarBrand() {
  return (
    <header>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip={APP_NAME} render={<Link to={ROUTES.overview} />}>
            <AppMark className="size-8 bg-sidebar-primary text-sm text-sidebar-primary-foreground" />
            <span className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{APP_NAME}</span>
              {/* A grid drops this whitespace from the layout, but it keeps the link's name "Apex Staff console", not "ApexStaff console". */}{' '}
              <span className="truncate text-xs text-muted-foreground">Staff console</span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </header>
  )
}

/**
 * The staff shell, after shadcn's sidebar-07 block: a sidebar that collapses
 * to icons (with a rail to toggle it) holding the brand, the sectioned
 * navigation (`NavMain`) and the account menu; a header with breadcrumbs, the
 * ⌘K search and, from `md` up, the theme toggle; and the page. Navigation comes from `navGroupsFor(role, flags)`, so an
 * item above the user's role, or behind a flag that is off, is absent, not
 * disabled. On `/settings/*` the sidebar's content swaps to `NavSettings`;
 * elsewhere it is `NavMain` plus the bottom group (`NavSecondary`). The brand
 * header and the account menu never change.
 *
 * The palette's host (its shortcut, and its code fetched once the shell is
 * idle or the header's Search… is hovered or focused), the theme listener and
 * the one mount of the `$feature/*` super-property sync
 * (`useFeaturePropertiesSync`) live here, not in the sidebar: below `md` the
 * `Sidebar` renders into a `Sheet` whose content unmounts while closed. The
 * theme toggle sits in the header from `md` up and in the drawer's footer
 * below it, where the header has no room left
 * beside a full breadcrumb trail; it is never an item in the account menu,
 * which unmounts its content whenever the menu closes. `SidebarInset` is the
 * `main` element, so its own `header` is not a second banner.
 * `StepUpProvider` wraps the shell once, so every staff page's destructive
 * action shares one step-up dialog. `MaintenanceBanner` sits under the
 * header, so every staff page says when customers are in maintenance.
 */
export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setCollapsed = useSidebarStore((s) => s.setCollapsed)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const openPalette = useCommandPaletteStore((s) => s.setOpen)
  const isMobile = useIsMobile()
  const crumbs = useBreadcrumbs()
  const pathname = useLocation({ select: (location) => location.pathname })
  const groups = navGroupsFor(user?.platformRole, useFlagValues())

  useFeaturePropertiesSync()

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    /** Re-applies the system theme when the OS preference changes. */
    const onChange = () => setTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme, setTheme])

  return (
    <StepUpProvider>
      <SidebarProvider open={!isCollapsed} onOpenChange={(open) => setCollapsed(!open)}>
        <SkipLink />
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarBrand />
          </SidebarHeader>
          <SidebarContent>
            {isSettingsPath(pathname) ? (
              <NavSettings pathname={pathname} />
            ) : (
              <>
                <NavMain sections={groups} pathname={pathname} />
                <NavSecondary className="mt-auto" />
              </>
            )}
          </SidebarContent>
          <SidebarFooter>
            <UserMenu user={user} />
            {isMobile && (
              <div className="flex justify-center">
                <ThemeToggle />
              </div>
            )}
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <SidebarTrigger aria-label="Toggle sidebar" className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap">
                {crumbs.map((crumb, index) => (
                  <Fragment key={crumb.key}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem className="min-w-0">
                      {index === crumbs.length - 1 ? (
                        <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink className="truncate" render={<Link to={crumb.to} />}>
                          {crumb.label}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0 justify-between font-normal text-muted-foreground sm:w-56"
              aria-keyshortcuts={isApplePlatform() ? 'Meta+K' : 'Control+K'}
              onClick={() => openPalette(true)}
              onPointerEnter={prefetchPalette}
              onFocus={prefetchPalette}
            >
              <span className="flex items-center gap-2">
                <IconSearch aria-hidden="true" className="size-4" />
                <span className="max-sm:sr-only">Search…</span>
              </span>
              <Kbd aria-hidden="true" className="max-sm:hidden">
                {paletteShortcutHint()}
              </Kbd>
            </Button>
            {!isMobile && <ThemeToggle />}
          </header>
          <MaintenanceBanner />
          <div className="flex-1 overflow-auto p-4 md:p-6">
            <Outlet />
          </div>
        </SidebarInset>
        <CommandPaletteHost />
      </SidebarProvider>
    </StepUpProvider>
  )
}
