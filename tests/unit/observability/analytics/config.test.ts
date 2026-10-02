import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRuntimeConfig, resetRuntimeConfigForTests } from '@/configs/runtime-config'
import {
  ANALYTICS_APP,
  ANALYTICS_URL_QUERY_ALLOWLIST,
  analyticsConfigFrom,
  getAnalyticsConfig,
  isAnalyticsAvailable,
} from '@/observability/analytics/config'
import { sanitizeUrl } from '@/observability/analytics/url-sanitizer'
import { analyticsConfigFor } from '@/tests/mocks/posthog'

const KEY = 'phc_test_key_not_real'

describe('analyticsConfigFrom', () => {
  it('is inert with nothing configured, on the default UI host, opt_out and development', () => {
    expect(analyticsConfigFrom(parseRuntimeConfig({}).config)).toEqual({
      key: undefined,
      uiHost: 'https://us.posthog.com',
      consentMode: 'opt_out',
      handoffOrigins: [],
      environment: 'development',
    })
  })

  it('takes every analytics setting from the run-time configuration, and always runs opt_out', () => {
    expect(
      analyticsConfigFor({
        POSTHOG_KEY: KEY,
        POSTHOG_UI_HOST: 'https://eu.posthog.com',
        ANALYTICS_CONSENT_MODE: 'required',
        ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com,https://blog.example.com',
        APP_ENVIRONMENT: 'staging',
      })
    ).toEqual({
      key: KEY,
      uiHost: 'https://eu.posthog.com',
      consentMode: 'opt_out',
      handoffOrigins: ['https://www.example.com', 'https://blog.example.com'],
      environment: 'staging',
    })
  })
})

describe('getAnalyticsConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetRuntimeConfigForTests()
  })

  it('reads this page’s run-time configuration', () => {
    resetRuntimeConfigForTests()
    vi.stubEnv('VITE_POSTHOG_KEY', KEY)
    vi.stubEnv('VITE_APP_ENVIRONMENT', 'test')
    expect(getAnalyticsConfig()).toMatchObject({ key: KEY, environment: 'test' })
  })
})

describe('isAnalyticsAvailable', () => {
  it.each([
    [{}, false],
    [{ POSTHOG_KEY: KEY }, true],
    // Apex ignores the consent mode, `off` included.
    [{ POSTHOG_KEY: KEY, ANALYTICS_CONSENT_MODE: 'off' }, true],
  ])('%o → %s', (raw, expected) => {
    expect(isAnalyticsAvailable(analyticsConfigFor(raw))).toBe(expected)
  })
})

describe('the app constants', () => {
  it('names this app and keeps only its list enums in URLs', () => {
    expect(ANALYTICS_APP).toBe('apex')
    expect(ANALYTICS_URL_QUERY_ALLOWLIST).toEqual(['range', 'tab', 'state', 'status'])
  })
})

describe('the URL allowlist, through the sanitizer', () => {
  it('keeps range, state, status and tab, and strips token and email', () => {
    expect(
      sanitizeUrl(
        'https://app.example.com/tenants?range=7d&token=probe-token&state=open&email=pii-probe%40example.test&status=active&tab=members',
        ANALYTICS_URL_QUERY_ALLOWLIST
      )
    ).toBe('https://app.example.com/tenants?range=7d&state=open&status=active&tab=members')
  })
})
