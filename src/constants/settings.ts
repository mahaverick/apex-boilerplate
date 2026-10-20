/**
 * @file The Settings area's one source of truth: its groups and sections drive
 * the settings nav, the `/settings` landing page, the settings layout's title
 * and the command palette's settings pages, after Pulse's `settings.constants.ts`.
 */
import {
  IconFlag,
  IconShieldCheck,
  IconShieldLock,
  IconTool,
  IconUser,
  type TablerIcon,
} from '@tabler/icons-react'

/** A settings group's id. */
export type SettingsGroupId = 'account' | 'platform'

/** One labelled group of the settings nav and landing page. */
export interface SettingsGroup {
  id: SettingsGroupId
  label: string
  description: string
}

/** The groups, in the order the nav and landing page show them. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'account', label: 'Account', description: 'Your profile and sign-in.' },
  {
    id: 'platform',
    label: 'Platform',
    description: 'Who has staff access, feature flags and maintenance mode.',
  },
]

/** A settings page's path. */
export type SettingsPath =
  | '/settings/account/profile'
  | '/settings/account/security'
  | '/settings/platform/staff'
  | '/settings/platform/flags'
  | '/settings/platform/maintenance'

/** One settings page: where it lives, what it is called, and its group. */
export interface SettingsSection {
  group: SettingsGroupId
  to: SettingsPath
  label: string
  description: string
  Icon: TablerIcon
}

/** Every settings page, grouped in `SETTINGS_GROUPS` order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    group: 'account',
    to: '/settings/account/profile',
    label: 'Profile',
    description: 'Your name.',
    Icon: IconUser,
  },
  {
    group: 'account',
    to: '/settings/account/security',
    label: 'Security',
    description: 'Your sign-in methods and other sessions.',
    Icon: IconShieldLock,
  },
  {
    group: 'platform',
    to: '/settings/platform/staff',
    label: 'Staff',
    description: 'Everyone with platform access, their roles and invitations.',
    Icon: IconShieldCheck,
  },
  {
    group: 'platform',
    to: '/settings/platform/flags',
    label: 'Feature flags',
    description: 'Every flag’s live state, and any user’s evaluation.',
    Icon: IconFlag,
  },
  {
    group: 'platform',
    to: '/settings/platform/maintenance',
    label: 'Maintenance',
    description: 'Customer maintenance mode and the queues’ pause state.',
    Icon: IconTool,
  },
]

/** The landing page's subtitle, and the layout's when no section is active. */
export const SETTINGS_DESCRIPTION = 'Manage your account and the platform.'

/** Whether `pathname` (a trailing slash ignored) has exactly the segments of `to`. */
function matchesSection(pathname: string, to: string): boolean {
  return pathname.replace(/(.)\/+$/, '$1') === to
}

/**
 * The section `pathname` shows, or null on the landing page and outside
 * settings. Whole paths only, so `/settings/account/profiles` matches none.
 */
export function settingsActiveSection(pathname: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((section) => matchesSection(pathname, section.to)) ?? null
}

/** Whether `pathname` is `/settings` or one of its pages. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/')
}
