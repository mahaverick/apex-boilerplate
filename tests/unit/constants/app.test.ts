import { describe, expect, it } from 'vite-plus/test'
import { APP_NAME, pageTitle } from '@/constants/app'

describe('pageTitle', () => {
  it('suffixes the page name with the app name', () => {
    expect(APP_NAME).toBe('Apex')
    expect(pageTitle('Profile')).toBe('Profile · Apex')
  })
})
