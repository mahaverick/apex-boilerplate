import { IconSettings } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'

/**
 * The sidebar's bottom group: Settings. Apex has no notifications inbox, so
 * unlike the customer app's this holds one item. Its link closes the phone drawer.
 */
export function NavSecondary({ className }: { className?: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  /** Closes the drawer after a tap on a phone. */
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  return (
    <nav aria-label="Secondary" className={cn(className)}>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              render={<Link to={ROUTES.settings} onClick={close} />}
            >
              <IconSettings aria-hidden="true" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </nav>
  )
}
