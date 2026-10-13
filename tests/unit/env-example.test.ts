import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RUNTIME_CONFIG_KEYS } from '@/configs/runtime-config'

describe('.env.example', () => {
  it('lists every run-time setting as a VITE_ variable', () => {
    const listed = [...readFileSync('.env.example', 'utf8').matchAll(/^(VITE_[A-Z_]+)=/gm)].map(
      (match) => match[1]
    )
    expect(listed.sort()).toEqual(RUNTIME_CONFIG_KEYS.map((key) => `VITE_${key}`).sort())
  })
})
