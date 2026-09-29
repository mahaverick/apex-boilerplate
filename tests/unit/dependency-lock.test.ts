/// <reference types="node" />
/**
 * @file Base UI owns every primitive here (STYLESEED.md). A Radix package, or
 * cmdk, which pulls four of them in, fails this even as a transitive
 * dependency, which the import lint cannot see.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const lockfile = fs.readFileSync(path.resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8')

/** Matches a package key (`packages:`/`snapshots:`), an importer entry or a dependency line. */
const RADIX = /^\s+'?@radix-ui\/[^@:\s']+/gm
const CMDK = /^\s+'?cmdk'?[@:]/gm

describe('dependency lock', () => {
  it('resolves no @radix-ui package', () => {
    expect(lockfile.match(RADIX) ?? []).toEqual([])
  })

  it('resolves no cmdk', () => {
    expect(lockfile.match(CMDK) ?? []).toEqual([])
  })

  it('matches the entry shapes pnpm writes', () => {
    const sample = [
      "  '@radix-ui/react-dialog@1.1.6':",
      "  '@radix-ui/react-dialog@1.1.6(@types/react@19.3.0)(react@19.3.0)':",
      "      '@radix-ui/react-slot': 1.1.2(@types/react@19.3.0)(react@19.3.0)",
      '  cmdk@1.1.1:',
      '  cmdk@1.1.1(@types/react@19.3.0)(react@19.3.0):',
      '      cmdk:',
    ].join('\n')
    expect(sample.match(RADIX)).toHaveLength(3)
    expect(sample.match(CMDK)).toHaveLength(3)
  })

  it('resolves recharts and @tanstack/react-table', () => {
    expect(lockfile).toMatch(/^ {2}recharts@/m)
    expect(lockfile).toMatch(/^ {2}'@tanstack\/react-table@/m)
  })
})
