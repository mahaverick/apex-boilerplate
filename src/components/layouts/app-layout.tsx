import { Link, Outlet, useLocation, useMatches, type LinkProps } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { Fragment, useEffect } from 'react'
import { CommandPalette } from '@/components/features/command-palette'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { UserMenu } from '@/components/features/user-menu'
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
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { APP_NAME } from '@/constants/app'
import { navGroupsFor } from '@/constants/navigation'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'

interface Crumb {
  /** Stable across renders: one crumb per matched route. */
  key: string
  label: string
  /** The resolved path of that match, with its params filled in. */
  to: LinkProps['to']
}

/**
 * The trail for the current location, in route order, read off each match's
 * `staticData.crumb` (see the augmentation in `@/router`). Pathless layout
 * matches (`__root__`, `/_app`) declare no crumb and drop out. An index
 * match's trailing slash is trimmed, so `/tenants/` and the nav's `/tenants`
 * are one href.
 */
function useBreadcrumbs(): Crumb[] {
  const matches = useMatches()
  return matches.flatMap((match) => {
    const crumb = match.staticData.crumb
    if (crumb === undefined) return []
    const params = match.params as Record<string, string>
    const path = match.pathname.replace(/(.)\/+$/, '$1')
    return [
      {
        key: match.routeId,
        label: typeof crumb === 'function' ? crumb(params) : crumb,
        to: path as LinkProps['to'],
      },
    ]
  })
}

/** Whether a nav item's route contains the current location. */
function isNavActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * The staff shell: a grouped sidebar, a header with breadcrumbs and the ⌘K
 * search, and the page. Navigation comes from `navGroupsFor(role)`, so an item
 * above the user's role is absent, not disabled.
 *
 * The palette and the theme listener live here, not in the sidebar: below
 * `md` the `Sidebar` renders into a `Sheet` whose content unmounts while
 * closed. The primary navigation sits in its own `nav` landmark, since
 * `Sidebar` renders plain divs, and the brand link in a `header` (the banner),
 * since axe's `region` rule exempts buttons but not links. `SidebarInset` is
 * the `main` element, so its own `header` is not a second banner.
 */
export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setCollapsed = useSidebarStore((s) => s.setCollapsed)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const openPalette = useCommandPaletteStore((s) => s.setOpen)
  const crumbs = useBreadcrumbs()
  const pathname = useLocation({ select: (location) => location.pathname })
  const groups = navGroupsFor(user?.platformRole)

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme, setTheme])

  return (
    <SidebarProvider open={!isCollapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <SkipLink />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <header>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" render={<Link to="/overview" />}>
                  <span
                    aria-hidden
                    className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
                  >
                    A
                  </span>
                  <span className="font-semibold">{APP_NAME}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </header>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Main">
            {groups.map(({ group, items }) => (
              <SidebarGroup key={group}>
                <SidebarGroupLabel>{group}</SidebarGroupLabel>
                <SidebarMenu>
                  {items.map(({ to, label, Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        isActive={isNavActive(pathname, to)}
                        tooltip={label}
                        render={<Link to={to} />}
                      >
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <UserMenu user={user} />
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.key}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {index === crumbs.length - 1 ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto w-56 justify-between font-normal text-muted-foreground"
            onClick={() => openPalette(true)}
          >
            <span className="flex items-center gap-2">
              <Search aria-hidden className="size-4" />
              Search…
            </span>
            <Kbd>⌘K</Kbd>
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  )
}
