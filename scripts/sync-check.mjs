#!/usr/bin/env node
/**
 * @file The sync check: every `files` and `tests` row of react-boilerplate's
 * `shared-core.json` that names apex must be byte for byte react's copy, and
 * the rows apex shares with expo must pass the copied `check-shared` rules.
 * It reads react's working tree, so locally it compares against whichever
 * branch that checkout has; CI checks out react's `main`.
 *
 * Usage: node scripts/sync-check.mjs [--react <dir>]. The react directory is
 * `--react`, then `REACT_BOILERPLATE_DIR`, then `../react-boilerplate` beside
 * this repository's root.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkShared } from './check-shared.mjs'

/** The app this repository is in the manifest. */
const APP = 'apex'

/** This repository's root. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Whether two files hold the same bytes, as `cmp` decides.
 * @param a - One file.
 * @param b - The other.
 * @returns True when both exist and match.
 */
function sameBytes(a, b) {
  return fs.readFileSync(a).equals(fs.readFileSync(b))
}

/**
 * The apex rows of a manifest, or why the manifest cannot be read.
 * @param manifestPath - The manifest's absolute path.
 * @returns The rows naming apex, or an error naming the manifest.
 */
function readApexRows(manifestPath) {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { error: `${manifestPath}: not valid JSON (${error.message})` }
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { error: `${manifestPath}: not a JSON object` }
  }
  const rows = []
  for (const section of ['files', 'tests']) {
    const entries = manifest[section] ?? {}
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
      return { error: `${manifestPath}: "${section}" is not an object` }
    }
    for (const [file, apps] of Object.entries(entries)) {
      if (!Array.isArray(apps) || !apps.every((app) => typeof app === 'string')) {
        return { error: `${manifestPath}: the apps of "${file}" are not an array of names` }
      }
      if (apps.includes(APP)) rows.push(file)
    }
  }
  return { rows }
}

/**
 * Check apex's copies of react's shared rows.
 * @param options - What to check.
 * @param options.root - Apex's root (default: this repository).
 * @param options.react - React's root (default: `REACT_BOILERPLATE_DIR`, then
 *   `../react-boilerplate` beside `root`).
 * @param options.env - The environment read for `CI` and `REACT_BOILERPLATE_DIR`.
 * @param options.warn - Where the no-react warning goes.
 * @returns One line per finding, empty when apex matches.
 */
export function syncCheck({
  root = REPO_ROOT,
  env = process.env,
  react = env.REACT_BOILERPLATE_DIR || path.resolve(root, '../react-boilerplate'),
  warn = console.warn,
} = {}) {
  const manifestPath = path.join(react, 'shared-core.json')
  if (!fs.existsSync(manifestPath)) {
    const message = `sync-check: no react-boilerplate checkout at ${react} (set REACT_BOILERPLATE_DIR or --react)`
    if (env.CI === 'true') return [message]
    warn(`${message}; skipped`)
    return []
  }
  const { rows: apexRows, error } = readApexRows(manifestPath)
  if (error) return [`sync-check: ${error}`]

  const findings = []
  for (const file of apexRows) {
    const ours = path.join(root, file)
    const theirs = path.join(react, file)
    if (!fs.existsSync(ours)) findings.push(`${file}: missing`)
    else if (!fs.existsSync(theirs)) findings.push(`${file}: missing in react-boilerplate`)
    else if (!sameBytes(ours, theirs)) findings.push(`${file}: differs from react-boilerplate`)
  }

  // No `app`: only the expo-row rules run, and only on rows apex holds, since apex-only rows are byte copies, not core.
  const apexSet = new Set(apexRows)
  for (const finding of checkShared({ root, manifest: manifestPath })) {
    if (apexSet.has(finding.file)) {
      findings.push(`${finding.file}:${finding.line}: ${finding.reason}`)
    }
  }
  return findings
}

/**
 * The CLI's options from its arguments.
 * @param argv - The arguments after the script.
 * @returns The options.
 */
function parseArguments(argv) {
  if (argv.length === 0) return {}
  if (argv.length === 2 && argv[0] === '--react') return { react: path.resolve(argv[1]) }
  throw new Error(`sync-check: unknown or incomplete arguments ${argv.join(' ')}`)
}

/** Print each finding and exit 1 when there is any; a bad argument is one line too. */
function main() {
  let findings
  try {
    findings = syncCheck(parseArguments(process.argv.slice(2)))
  } catch (error) {
    findings = [error instanceof Error ? error.message : String(error)]
  }
  if (findings.length > 0) {
    console.error(findings.join('\n'))
    // exitCode, not exit(): exit() drops stderr still queued for a pipe.
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
