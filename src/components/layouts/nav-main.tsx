import { IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import type { NavGroup, NavItem } from '@/constants/navigation'

/** Whether `to` is the current location or one of its ancestors. */
function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

/** One sidebar section: its label and the items visible to this user. */
interface NavSection {
  group: NavGroup
  items: NavItem[]
}

/**
 * The sidebar's primary navigation, after shadcn's sidebar-07 `NavMain`, in
 * the labelled sections `navGroupsFor` returns. It sits in its own `nav`
 * landmark, since `Sidebar` renders plain divs. Each item renders as the
 * anchor itself, so it is keyboard-reachable and opens in a new tab, and
 * names itself in a tooltip shown only while the sidebar is collapsed to
 * icons. The highlight reads `pathname`, so a deep page keeps its item lit.
 *
 * Each section's label is a disclosure button that folds the section away.
 * Every section starts open. The one holding the current page stays open,
 * its toggle `aria-disabled` (Base UI keeps it focusable), so the lit item is
 * never hidden. Collapsed to icons, the sidebar hides the labels, so each
 * renders as plain text, not a button no one can see, and every item shows,
 * whatever was folded. The folded set lives here, so it resets when the
 * phone drawer, which unmounts its content, closes.
 */
export function NavMain({
  sections,
  pathname,
}: {
  sections: readonly NavSection[]
  pathname: string
}) {
  const { state, isMobile } = useSidebar()
  const [folded, setFolded] = useState<ReadonlySet<NavGroup>>(() => new Set())
  const isIconMode = state === 'collapsed' && !isMobile

  /** Folds or unfolds one section. */
  const setSectionOpen = (group: NavGroup, open: boolean) => {
    setFolded((current) => {
      const next = new Set(current)
      if (open) next.delete(group)
      else next.add(group)
      return next
    })
  }

  return (
    <nav aria-label="Main">
      {sections.map(({ group, items }) => {
        const holdsCurrent = items.some((item) => isActive(pathname, item.to))
        const open = isIconMode || holdsCurrent || !folded.has(group)
        return (
          <Collapsible
            key={group}
            open={open}
            onOpenChange={(next) => setSectionOpen(group, next)}
            disabled={holdsCurrent}
            className="group/collapsible"
            render={<SidebarGroup />}
          >
            <SidebarGroupLabel
              render={isIconMode ? undefined : <CollapsibleTrigger />}
              className="w-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-disabled:cursor-default data-disabled:hover:bg-transparent data-disabled:hover:text-sidebar-foreground/70"
            >
              {group}
              <IconChevronRight
                aria-hidden="true"
                className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90"
              />
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map(({ to, label, Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        isActive={isActive(pathname, to)}
                        tooltip={label}
                        render={<Link to={to} />}
                      >
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </nav>
  )
}
