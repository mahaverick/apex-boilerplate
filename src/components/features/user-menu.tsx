import { Link } from '@tanstack/react-router'
import { LogOut, User as UserIcon } from 'lucide-react'
import { Pii } from '@/components/shared/pii'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { fullName } from '@/lib/format'
import { useLogout } from '@/queries/auth.queries'
import type { User } from '@/types/api.types'

/**
 * "Ada Lovelace", or the email when the profile carries no name yet. Not
 * exported: `react-refresh/only-export-components` warns on a non-component
 * export, and lint runs with `--max-warnings 0`.
 */
function displayName(user: User | null): string {
  return fullName(user) ?? user?.email ?? 'Account'
}

/** The first letters of the first and last name, else of the email, upper-cased. */
function initials(user: User | null): string {
  const letters = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('')
  return (letters || user?.email?.[0] || '?').toUpperCase()
}

/**
 * The account menu in the sidebar footer. When the sidebar is collapsed to
 * icons its trigger shrinks to the avatar, so the aria-label names it; the
 * label is on the rendered element, whose own props win under useRender.
 */
export function UserMenu({ user }: { user: User | null }) {
  const logout = useLogout()
  const name = displayName(user)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={`Account menu for ${name}`} />}
          >
            <Avatar size="sm">
              <AvatarFallback>
                <Pii>{initials(user)}</Pii>
              </AvatarFallback>
            </Avatar>
            <Pii className="truncate">{name}</Pii>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-56">
            <DropdownMenuItem render={<Link to={ROUTES.profile} />}>
              <UserIcon className="mr-2 size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
