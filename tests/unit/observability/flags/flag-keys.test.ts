import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CLIENT_FLAGS,
  type BooleanClientFlagKey,
  type ClientFlagKey,
  type MultivariateClientFlagKey,
} from '@/observability/flags/flag-keys'
import { fallbackFlags } from '@/observability/flags/flag-values'

describe('apex flag keys', () => {
  it('mirrors an empty slice: express registers no flag for apex yet', () => {
    expect(CLIENT_FLAGS).toEqual({})
    expect(fallbackFlags()).toEqual({})
  })

  it('types every key as never, so reading an unregistered flag fails typecheck', () => {
    expectTypeOf<ClientFlagKey>().toEqualTypeOf<never>()
    expectTypeOf<BooleanClientFlagKey>().toEqualTypeOf<never>()
    expectTypeOf<MultivariateClientFlagKey>().toEqualTypeOf<never>()
  })
})
