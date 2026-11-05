import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { syncCheck } from '../../../scripts/sync-check.mjs'

/** The copied check-shared script, an apex row in the fixture manifest. */
const CHECK_SHARED = path.resolve(import.meta.dirname, '../../../scripts/check-shared.mjs')

/** The CLI under test. */
const SCRIPT = path.resolve(import.meta.dirname, '../../../scripts/sync-check.mjs')

/**
 * Runs the CLI with no inherited `CI` or `REACT_BOILERPLATE_DIR`.
 * @param args - Its arguments.
 * @param env - Variables to set.
 * @returns Its exit status and output.
 */
function runCli(args: string[], env: Record<string, string> = {}) {
  const inherited = { ...process.env }
  delete inherited.CI
  delete inherited.REACT_BOILERPLATE_DIR
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...inherited, ...env },
  })
}

/** Temporary directories made by a test, removed after it. */
const made: string[] = []

/**
 * A fresh temporary directory.
 * @returns Its absolute path.
 */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-check-'))
  made.push(dir)
  return dir
}

/**
 * Writes files under a root, making their directories.
 * @param root - The root.
 * @param files - Repo-relative paths and their contents.
 */
function writeTree(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
}

/** A manifest with an apex-and-expo file, an apex-only test and an expo-only file. */
const MANIFEST = JSON.stringify({
  files: {
    'scripts/check-shared.mjs': ['apex', 'expo'],
    'src/lib/plural.ts': ['apex', 'expo'],
    'src/lib/expo-only.ts': ['expo'],
  },
  tests: { 'tests/unit/plural.test.ts': ['apex'] },
  ports: {},
  testPorts: {},
  exemptions: {},
})

/** The shared rows, as react holds them. */
const SHARED = {
  'scripts/check-shared.mjs': fs.readFileSync(CHECK_SHARED, 'utf8'),
  'src/lib/plural.ts': 'export const plural = (n: number) => (n === 1 ? "" : "s")\n',
  'tests/unit/plural.test.ts': "it('pluralises', () => {})\n",
}

/**
 * A react tree with the manifest and every row, and an apex tree with the apex rows.
 * @param apexFiles - Apex files to write over the shared ones (null removes one).
 * @returns The two roots.
 */
function trees(apexFiles: Record<string, string | null> = {}): { react: string; apex: string } {
  const react = tempDir()
  const apex = tempDir()
  writeTree(react, {
    'shared-core.json': MANIFEST,
    ...SHARED,
    'src/lib/expo-only.ts': 'export const onlyExpo = 1\n',
  })
  const apexTree: Record<string, string> = { ...SHARED }
  for (const [file, text] of Object.entries(apexFiles)) {
    if (text === null) delete apexTree[file]
    else apexTree[file] = text
  }
  writeTree(apex, apexTree)
  return { react, apex }
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('syncCheck', () => {
  it('passes when every apex row matches', () => {
    const { react, apex } = trees()
    expect(syncCheck({ react, root: apex, env: {} })).toEqual([])
  })

  it('names a file that differs', () => {
    const { react, apex } = trees({ 'src/lib/plural.ts': 'export const plural = () => "s"\n' })
    expect(syncCheck({ react, root: apex, env: {} })).toEqual([
      'src/lib/plural.ts: differs from react-boilerplate',
    ])
  })

  it('names a file that is missing', () => {
    const { react, apex } = trees({ 'tests/unit/plural.test.ts': null })
    expect(syncCheck({ react, root: apex, env: {} })).toEqual([
      'tests/unit/plural.test.ts: missing',
    ])
  })

  it('ignores rows that do not name apex', () => {
    // src/lib/expo-only.ts is absent from apex, and check-shared would report it.
    const { react, apex } = trees()
    writeTree(react, { 'src/lib/expo-only.ts': 'export const changed = 2\n' })
    expect(syncCheck({ react, root: apex, env: {} })).toEqual([])
  })

  it('names a file that react lacks', () => {
    const { react, apex } = trees()
    fs.rmSync(path.join(react, 'src/lib/plural.ts'))
    expect(syncCheck({ react, root: apex, env: {} })).toEqual([
      'src/lib/plural.ts: missing in react-boilerplate',
    ])
  })

  it('reports a check-shared finding on an expo row apex holds', () => {
    const browserOnly = 'export const title = () => document.title\n'
    const { react, apex } = trees({ 'src/lib/plural.ts': browserOnly })
    writeTree(react, { 'src/lib/plural.ts': browserOnly })
    expect(syncCheck({ react, root: apex, env: {} })).toEqual([
      'src/lib/plural.ts:1: uses the browser global document',
    ])
  })

  it.each([
    ['is not JSON', '{ "files": '],
    ['lists apps as a string', JSON.stringify({ files: { 'src/lib/plural.ts': 'apex' } })],
  ])('reports one finding when the manifest %s', (_case, manifest) => {
    const { react, apex } = trees()
    writeTree(react, { 'shared-core.json': manifest })
    const findings = syncCheck({ react, root: apex, env: {} })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('shared-core.json')
  })

  it('prints one line and exits 1, with no stack trace, on a malformed manifest', () => {
    const { react } = trees()
    writeTree(react, { 'shared-core.json': '{ "files": ' })
    const result = runCli(['--react', react])
    expect(result.status).toBe(1)
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(result.stderr).toContain('shared-core.json')
    expect(result.stderr).not.toMatch(/\n\s+at /)
  })

  it('reads --react before REACT_BOILERPLATE_DIR', () => {
    const base = tempDir()
    const result = runCli(['--react', path.join(base, 'from-flag')], {
      CI: 'true',
      REACT_BOILERPLATE_DIR: path.join(base, 'from-env'),
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('from-flag')
    expect(result.stderr).not.toContain('from-env')
  })

  it('reads REACT_BOILERPLATE_DIR before the default', () => {
    const base = tempDir()
    const apex = path.join(base, 'apex')
    const { react } = trees()
    writeTree(apex, SHARED)
    // The default ../react-boilerplate holds a differing copy, so reading it would report a finding.
    writeTree(path.join(base, 'react-boilerplate'), {
      'shared-core.json': MANIFEST,
      ...SHARED,
      'src/lib/plural.ts': 'export const plural = () => "s"\n',
    })
    expect(syncCheck({ root: apex, env: { REACT_BOILERPLATE_DIR: react } })).toEqual([])
  })

  it('falls back to ../react-boilerplate beside the root', () => {
    const base = tempDir()
    const apex = path.join(base, 'apex')
    writeTree(apex, SHARED)
    writeTree(path.join(base, 'react-boilerplate'), {
      'shared-core.json': MANIFEST,
      ...SHARED,
      'src/lib/plural.ts': 'export const plural = () => "s"\n',
    })
    expect(syncCheck({ root: apex, env: {} })).toEqual([
      'src/lib/plural.ts: differs from react-boilerplate',
    ])
  })

  it('warns and passes with no react directory', () => {
    const { apex } = trees()
    const warnings: string[] = []
    const findings = syncCheck({
      react: path.join(apex, 'no-such-react'),
      root: apex,
      env: {},
      warn: (message) => warnings.push(message),
    })
    expect(findings).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no-such-react')
  })

  it('fails with no react directory when CI is true', () => {
    const { apex } = trees()
    const findings = syncCheck({
      react: path.join(apex, 'no-such-react'),
      root: apex,
      env: { CI: 'true' },
      warn: () => {},
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('no-such-react')
  })
})
