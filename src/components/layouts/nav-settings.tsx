import { IconArrowLeft } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsActiveSection } from '@/constants/settings'

/**
 * The sidebar's content on settings pages, after Pulse's settings nav: Back
 * to console, then one labelled group per `SETTINGS_GROUPS` entry. Every
 * section is listed for every staff role; each page gates its own controls.
 * Every item names itself in a tooltip while the sidebar is collapsed to
 * icons, and every link closes the phone drawer.
 */
export function NavSettings({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const active = settingsActiveSection(pathname)
  /** Closes the drawer after a tap on a phone. */
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  return (
    <nav aria-label="Settings">
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to console"
              render={<Link to={ROUTES.overview} onClick={close} />}
            >
              <IconArrowLeft aria-hidden="true" />
              <span>Back to console</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {SETTINGS_GROUPS.map((group) => (
        <SidebarGroup key={group.id}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {SETTINGS_SECTIONS.filter((section) => section.group === group.id).map((section) => (
              <SidebarMenuItem key={section.to}>
                <SidebarMenuButton
                  tooltip={section.label}
                  isActive={active?.to === section.to}
                  render={<Link to={section.to} onClick={close} />}
                >
                  <section.Icon aria-hidden="true" />
                  <span>{section.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  )
}
