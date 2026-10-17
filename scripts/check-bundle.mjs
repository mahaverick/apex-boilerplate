/**
 * @file Builds the app in memory and checks the chunks it would ship: more than
 * one JS chunk, first-visit JS (the entry chunk and its static imports) under
 * budget and free of posthog-js and `@posthog/core` (each of which must exist
 * in some other chunk, or the check proves nothing), the error listener in the
 * entry chunk under its own budget, Zod's config reached before any app code
 * that reaches Zod, and no devtools module in any chunk. Run with
 * `pnpm check:bundle`.
 */
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

/** The ceiling for first-visit JS in bytes. Raise it only with a measured reason. */
const ENTRY_BUDGET_BYTES = 598_500

/**
 * A module inside one of the devtools packages, by its node_modules path. Module
 * ids, not code: outside development the packages export a component that
 * returns null, so a leaked chunk's code carries none of the package's name.
 */
const DEVTOOLS_MODULE =
  /[\\/]@tanstack[\\/](react-query-devtools|query-devtools|react-router-devtools|router-devtools-core)[\\/]/

/**
 * A posthog-js module, by its node_modules path. The analytics facade imports
 * it with a dynamic `import()`, so it must stay out of every first-visit chunk.
 */
const POSTHOG_MODULE = /[\\/]posthog-js[\\/]/

/**
 * An `@posthog/core` module, by its node_modules path. Only the lazy error
 * reporter imports it, so it must stay out of the first-visit chunks.
 */
const POSTHOG_CORE_MODULE = /[\\/]@posthog[\\/]core[\\/]/

/** The entry-chunk error listener, which every page pays for. */
const ERROR_LISTENER_MODULE = /[\\/]src[\\/]observability[\\/]errors[\\/]listen\.ts$/

/** The most the error listener's rendered code may weigh in the entry chunk, gzipped. */
const ERROR_LISTENER_BUDGET_GZIP_BYTES = 1024

/** Zod's config, which turns off the JIT probe that `script-src 'self'` reports. */
const JITLESS_MODULE = /[\\/]src[\\/]lib[\\/]zod-jitless\.ts$/

/** A Zod module, by its node_modules path. */
const ZOD_MODULE = /[\\/]node_modules[\\/]zod[\\/]/

const root = path.resolve(import.meta.dirname, '..')

/** The prefix of an app module's id: this repo's `src/`, not a package's. */
const APP_PREFIX = `${path.join(root, 'src')}/`

const output = await build({
  root,
  logLevel: 'warn',
  build: { write: false },
})
const results = Array.isArray(output) ? output : [output]
const chunks = results.flatMap((result) =>
  'output' in result ? result.output.filter((file) => file.type === 'chunk') : []
)
const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
const failures = []

/**
 * Lists `fileName` and every chunk it statically imports, recursively.
 * @param fileName - A chunk's file name.
 * @returns The chunk and its static imports.
 */
const closureOf = (fileName) => {
  const closure = new Set([fileName])
  for (const name of closure) {
    for (const imported of byFile.get(name)?.imports ?? []) closure.add(imported)
  }
  return closure
}

if (chunks.length < 2) {
  failures.push(`expected more than one JS chunk, found ${chunks.length}`)
}

const entries = chunks.filter((chunk) => chunk.isEntry)
if (entries.length !== 1) {
  failures.push(`expected one entry chunk, found ${entries.length}`)
} else {
  const initial = closureOf(entries[0].fileName)
  const bytes = [...initial].reduce(
    (sum, fileName) => sum + Buffer.byteLength(byFile.get(fileName)?.code ?? ''),
    0
  )
  console.log(
    `first-visit JS: ${bytes} bytes in ${initial.size} chunks (budget ${ENTRY_BUDGET_BYTES})`
  )
  if (bytes > ENTRY_BUDGET_BYTES) {
    failures.push(`first-visit JS is ${bytes} bytes, over the ${ENTRY_BUDGET_BYTES}-byte budget`)
  }
  for (const fileName of initial) {
    const moduleIds = byFile.get(fileName)?.moduleIds ?? []
    if (moduleIds.some((id) => POSTHOG_MODULE.test(id))) {
      failures.push(`first-visit chunk ${fileName} contains posthog-js, which must load on demand`)
    }
    if (moduleIds.some((id) => POSTHOG_CORE_MODULE.test(id))) {
      failures.push(
        `first-visit chunk ${fileName} contains @posthog/core, which must load on demand`
      )
    }
  }
  const entry = entries[0]
  const listenerId = entry.moduleIds.find((id) => ERROR_LISTENER_MODULE.test(id))
  if (listenerId === undefined) {
    failures.push('the entry chunk has no error listener (src/observability/errors/listen.ts)')
  } else {
    const gzipped = gzipSync(entry.modules[listenerId]?.code ?? '', { level: 9 }).length
    console.log(
      `error listener: ${gzipped} bytes gzipped (budget ${ERROR_LISTENER_BUDGET_GZIP_BYTES})`
    )
    if (gzipped > ERROR_LISTENER_BUDGET_GZIP_BYTES) {
      failures.push(
        `the error listener is ${gzipped} bytes gzipped, over its ${ERROR_LISTENER_BUDGET_GZIP_BYTES}-byte budget`
      )
    }
  }
}

if (!chunks.some((chunk) => chunk.moduleIds.some((id) => POSTHOG_MODULE.test(id)))) {
  failures.push('no chunk contains posthog-js: the lazy-load check above proved nothing')
}

if (!chunks.some((chunk) => chunk.moduleIds.some((id) => POSTHOG_CORE_MODULE.test(id)))) {
  failures.push('no chunk contains @posthog/core: the lazy-load check above proved nothing')
}

/**
 * Zod's config must evaluate before any app module can build a schema. A chunk
 * that holds app code and reaches Zod must therefore reach the config too, or
 * hold it ahead of its other app modules: an entry chunk's own body runs after
 * every chunk it imports, so a config inlined there ran after a schema built in
 * one of those chunks, and Zod's `new Function('')` probe broke the CSP.
 */
const jitlessChunk = chunks.find((chunk) => chunk.moduleIds.some((id) => JITLESS_MODULE.test(id)))
if (jitlessChunk === undefined) {
  failures.push('no chunk contains src/lib/zod-jitless.ts')
} else {
  for (const chunk of chunks) {
    const closure = closureOf(chunk.fileName)
    const reachesZod = [...closure].some((fileName) =>
      byFile.get(fileName)?.moduleIds.some((id) => ZOD_MODULE.test(id))
    )
    const appIds = chunk.moduleIds.filter((id) => id.startsWith(APP_PREFIX))
    if (!reachesZod || appIds.length === 0) continue
    if (chunk === jitlessChunk) {
      const first = appIds[0]
      if (!JITLESS_MODULE.test(first)) {
        failures.push(`${chunk.fileName} evaluates ${first} before src/lib/zod-jitless.ts`)
      }
    } else if (!closure.has(jitlessChunk.fileName)) {
      failures.push(
        `${chunk.fileName} reaches Zod but not ${jitlessChunk.fileName}, which holds src/lib/zod-jitless.ts`
      )
    }
  }
}

for (const chunk of chunks) {
  const leaked = chunk.moduleIds.filter((id) => DEVTOOLS_MODULE.test(id))
  if (leaked.length > 0) {
    failures.push(`${chunk.fileName} contains devtools modules: ${leaked.join(', ')}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check-bundle: ${failure}`)
  process.exit(1)
}
console.log(`check-bundle: ok, ${chunks.length} JS chunks`)
