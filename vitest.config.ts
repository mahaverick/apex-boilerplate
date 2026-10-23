import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  /**
   * The app's own React Compiler, as vite.config.ts registers it, so a unit
   * test sees the memoization the browser runs: a render-time read the
   * compiler caches (a clock, module state) passes uncompiled.
   */
  plugins: [babel({ presets: [reactCompilerPreset()] })],
  /** The release constant vite.config.ts defines, which this standalone config does not inherit. */
  define: { __APP_RELEASE__: JSON.stringify('test') },
  resolve: {
    /** `@/tests` first: aliases match in order, and `@` would map `@/tests/…` into src/. */
    alias: [
      { find: '@/tests', replacement: path.resolve(import.meta.dirname, './tests') },
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    /**
     * Explicit, because Vitest's default glob would also collect the e2e
     * `*.test.ts` files and run Playwright specs under jsdom.
     */
    include: ['tests/**/*.test.{ts,tsx}'],
    // Forks, not threads: Node's BroadcastChannel crosses worker_threads, so under 'threads' one test file would hear another's messages.
    pool: 'forks',
    /**
     * Headroom over Vitest's 5s default: each test file gets its own worker and
     * jsdom, and on a cold CI machine a file that renders the whole route tree
     * can spend most of 5s before its first assertion. It must stay well above
     * `asyncUtilTimeout` in tests/setup.ts, which bounds `findBy*`/`waitFor`.
     * There is no `retry`: it would hide a race from the report, not fix it.
     */
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      /**
       * Excludes the generated route tree, the mount-only entry, the dev-only
       * devtools and the vendored shadcn files, by name: form.tsx and
       * command.tsx in ui/ are ours and measured.
       */
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/components/dev/devtools.tsx',
        'src/components/ui/{alert-dialog,avatar,badge,breadcrumb,button,card,collapsible,combobox,dialog,dropdown-menu}.tsx',
        'src/components/ui/{field,input,input-group,label,select,separator,sheet,sidebar,skeleton,switch}.tsx',
        'src/components/ui/{table,tabs,textarea,toast,tooltip}.tsx',
        'src/components/ui/{alert,calendar,chart,checkbox,empty,item,kbd,popover,spinner,toggle,toggle-group}.tsx',
      ],
      /**
       * A drop below any of these fails CI (`pnpm test:merge`) and `pnpm test:coverage`.
       * A shard sees part of the suite; the merge job enforces the gate on the whole.
       */
      thresholds:
        process.env.COVERAGE_SHARD === '1'
          ? undefined
          : { statements: 88, branches: 82, functions: 86, lines: 89 },
    },
  },
})
