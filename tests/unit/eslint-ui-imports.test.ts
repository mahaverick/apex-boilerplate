import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vite-plus/test'

/** One Oxlint diagnostic, as `vp lint -f json` prints it. */
interface OxlintDiagnostic {
  code: string
  filename: string
  help?: string
}

const UI_DIR = 'src/components/ui'
const VENDORED_FILES = ['src/components/ui/badge.tsx', 'src/components/ui/sidebar.tsx']
const IMPORTS = {
  cmdk: "import { Command } from 'cmdk'",
  radix: "import * as X from '@radix-ui/react-slot'",
  cn: "import { cn } from 'cn'",
}

/**
 * Lints each probe as a file in `dir`, in one Oxlint run. Oxlint has no stdin
 * mode, and editing the real file would race the test files that import it, so
 * each probe gets its own file, deleted afterwards. The leading dot keeps the probe
 * out of the `import.meta.glob` scans other suites run over src/ in parallel.
 * @param probes - Source text, keyed by a probe name unique within this run.
 * @param dir - The directory whose config overrides apply.
 * @returns The `help` text of each `no-restricted-imports` diagnostic, keyed by probe name.
 */
function oxlintRestrictedImports(
  probes: Record<string, string>,
  dir: string
): Record<string, string[]> {
  const paths = Object.fromEntries(
    Object.keys(probes).map((name) => [
      name,
      path.join(dir, `.lint-probe-${process.pid}-${name}.tsx`),
    ])
  )
  let stdout: string
  try {
    for (const [name, code] of Object.entries(probes)) writeFileSync(paths[name] ?? '', code)
    try {
      stdout = execFileSync('pnpm', ['exec', 'vp', 'lint', '-f', 'json', ...Object.values(paths)], {
        encoding: 'utf8',
      })
    } catch (error) {
      // Any finding exits 1; the JSON report is still on stdout.
      stdout = (error as { stdout: string }).stdout
    }
  } finally {
    for (const probe of Object.values(paths)) rmSync(probe, { force: true })
  }
  const { diagnostics } = JSON.parse(stdout) as { diagnostics: OxlintDiagnostic[] }
  return Object.fromEntries(
    Object.entries(paths).map(([name, probe]) => [
      name,
      diagnostics
        .filter((d) => d.filename === probe && d.code === 'eslint(no-restricted-imports)')
        .map((d) => d.help ?? ''),
    ])
  )
}

/**
 * The probe name for one vendored file and one import.
 * @param file - The vendored file the probe stands in for.
 * @param kind - Which import the probe holds.
 * @returns A name unique within this run.
 */
function probeName(file: string, kind: keyof typeof IMPORTS): string {
  return `${path.basename(file, '.tsx')}-${kind}`
}

// form.tsx and command.tsx ban `cn` in their own override but can't take a probe; the Vite+ plan's seed matrix checks them.
describe('vendored ui imports', () => {
  let results: Record<string, string[]> = {}

  beforeAll(() => {
    const probes: Record<string, string> = {}
    for (const file of VENDORED_FILES) {
      for (const [kind, code] of Object.entries(IMPORTS)) {
        probes[probeName(file, kind as keyof typeof IMPORTS)] = code
      }
    }
    results = oxlintRestrictedImports(probes, UI_DIR)
  }, 60_000)

  it.each(VENDORED_FILES)(
    'bans cmdk and @radix-ui in vendored ui file %s but lets it import cn',
    (file) => {
      expect(results[probeName(file, 'cmdk')]).toEqual([
        expect.stringContaining('Base UI Autocomplete'),
      ])
      expect(results[probeName(file, 'radix')]).toEqual([expect.stringContaining('Base UI')])
      expect(results[probeName(file, 'cn')]).toEqual([])
    }
  )
})
