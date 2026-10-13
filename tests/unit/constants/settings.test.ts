import { describe, expect, it } from 'vitest'
import {
  isSettingsPath,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  settingsActiveSection,
} from '@/constants/settings'

describe('settings config', () => {
  it('lists Account then Platform', () => {
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(['Account', 'Platform'])
  })

  it('lists the sections in nav order, each in its group', () => {
    expect(SETTINGS_SECTIONS.map((section) => [section.group, section.label])).toEqual([
      ['account', 'Profile'],
      ['account', 'Security'],
      ['platform', 'Staff'],
      ['platform', 'Feature flags'],
      ['platform', 'Maintenance'],
    ])
  })

  it.each([
    ['/settings/account/profile', 'Profile'],
    ['/settings/account/security/', 'Security'],
    ['/settings/platform/staff', 'Staff'],
    ['/settings/platform/flags', 'Feature flags'],
    ['/settings/platform/maintenance', 'Maintenance'],
  ])('finds the section for %s', (pathname, label) => {
    expect(settingsActiveSection(pathname)?.label).toBe(label)
  })

  it.each([
    '/settings',
    '/settings/',
    '/settings/account/profiles',
    '/settings/platform',
    '/flags',
  ])('finds no section for %s', (pathname) => {
    expect(settingsActiveSection(pathname)).toBeNull()
  })

  it.each([
    ['/settings', true],
    ['/settings/platform/staff', true],
    ['/settingsx', false],
    ['/overview', false],
  ])('isSettingsPath(%s) is %s', (pathname, expected) => {
    expect(isSettingsPath(pathname)).toBe(expected)
  })
})
