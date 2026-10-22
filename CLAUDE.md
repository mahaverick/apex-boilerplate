# CLAUDE.md

Rules and gotchas for changing code in this repository. The decisions here look
wrong until you know the reason; changing one is a deliberate act, not a tidy-up.
How the app fits together is in [ARCHITECTURE.md](ARCHITECTURE.md), what it
defends against is in [SECURITY.md](SECURITY.md), and how to run, configure and
deploy it is in [README.md](README.md).

## Sibling sync

`react-boilerplate`, the customer app, shares the HTTP layer, analytics, flags,
error tracking, most of the container and several components with this app. When
you change a shared path, change react in the same PR, and say in the description
what happened there ("ported in react#N", or "not applicable because …"). For a
file the two apps hold byte for byte, change react's copy first and copy it here,
except `scrub.ts`, whose rules change in express first.
The paths are listed in
[Sibling sync with react-boilerplate](ARCHITECTURE.md#sibling-sync-with-react-boilerplate).

## Staff access

Every signed-in page is for platform staff, and the API decides what each role
may do. The reasons are in [Staff-only access](SECURITY.md#staff-only-access),
[Step-up re-authentication](SECURITY.md#step-up-re-authentication) and
[Reason prompts](SECURITY.md#reason-prompts).

- **A 404 under `/platform/*` is a refusal, not a miss.** The API answers 404 to
  non-staff and to staff below a route's role. `isRoleDenied` recognises it and
  the page renders `RoleDenied`. Never turn that 404 into a sign-out or a retry
  loop: it is not an auth verdict.
- **A refusal's text goes through `staffMessageFrom`** (`src/lib/staff-message.ts`),
  never the shared `messageFrom` directly. It words express's route code
  `not_found`, which every role-gate 404 carries, as staff copy instead of the
  API's developer sentence.
- **A write that may need a recent sign-in runs through `useStepUp().run`.** The
  API refuses a stale sign-in with `REAUTH_REQUIRED`, which is not a verdict.
  The "Confirm it's you" dialog confirms by a passkey, or by an emailed link
  (under "Use another method"), opened in this browser's session on
  `/auth/confirm`. The confirm page posts `step_up_confirmed`, and the dialog
  refreshes the session and retries the write once. A passkey confirmation
  needs no message: the dialog that asked holds the new token. There is no password and no Google step-up: Google cannot prove
  a fresh sign-in.
- **Shared passkey and step-up modules are react's; change react first, then
  copy.** The passkey, step-up and `app-shell` files listed in
  [Sibling sync](ARCHITECTURE.md#sibling-sync-with-react-boilerplate) are byte
  for byte react's at its passkeys merge. Never edit one here alone. After a
  copy, run `bash -c 'for f in <paths>; do git -C ../react-boilerplate show
  <react-sha>:$f | cmp -s - $f || echo "DRIFT $f"; done'` and expect no
  output. Apex's own seams are `src/constants/frontend-app.ts`,
  `src/lib/action-message.ts` and `tests/mocks/setup-refusal.ts`.
- **A member or invitation write through platform access carries a reason.** When
  `useMyRole` reports `access: 'platform'`, the write goes through `ReasonDialog`
  and sends `reason` in the body, DELETE included. A member of the tenant, the
  Staff page included, sends none.
- **`src/constants/roles.ts` mirrors express's role rules.** Change both repos
  together, or the app offers actions the API refuses, or hides ones it allows.
- **A new main-nav page is an entry in `src/constants/navigation.ts`** plus the
  pieces [The staff shell](ARCHITECTURE.md#the-staff-shell-this-app-only) lists.
  The sidebar's main nav and the command palette both read that list.
- Settings pages are declared in `src/constants/settings.ts`; add a page there and
  as a route under `src/pages/_app/settings/`. Main-nav pages stay in
  `src/constants/navigation.ts`.
- **Text another party wrote renders as text.** A name, a reason, an audit entry's
  metadata or a maintenance message is text, never markup. A rendered email stays in its `<iframe sandbox="">`: never add
  `allow-same-origin` ([Untrusted content](SECURITY.md#untrusted-content)).

## The gate

- **0 errors and 0 warnings.** Check with `pnpm check`: `vp check` (Oxlint with
  type-aware rules, plus the Oxfmt check), then ESLint with `--max-warnings 0` for
  the 17 leftover rules, which run untyped. Oxlint fails on a warning too
  (`denyWarnings` in `vite.config.ts`). `pnpm lint` runs `vp lint`, ESLint and
  `vp fmt --check`, with the same zero-warning bar.
- CI also runs `pnpm lint:docs`,
  `pnpm ui:drift`, `pnpm knip`, `pnpm typecheck`, `pnpm test:coverage` (thresholds in
  `vitest.config.ts`), `pnpm check:bundle` and the `e2e` and `docker` jobs. The scripts
  are in [README.md](README.md).

## Dead code (knip)

`pnpm knip` fails CI on an unused file, export, type or dependency. knip is pinned
exactly, because a release can add new kinds of finding. Every ignore in
`knip.jsonc` carries its reason beside it, which is why the file is `.jsonc`. An
ignore without a reason does not go in.

When it reports something:

- An export used only in its own file loses `export`. A symbol used nowhere is
  deleted, and a re-export nobody imports leaves its barrel.
- An export a test imports counts as used, so a test seam stays exported.
  `pnpm knip --production` (not in CI) lists the exports only tests import.
- A `.mjs` export is removed from its `.d.mts` in the same change.
- A vendored file under `src/components/ui/` that nothing imports still fails:
  delete it. Only its export and type findings are ignored. The hand-written
  `command.tsx` keeps shadcn's export names, so the same ignore covers it.
- In a file shared with react, change both apps when react's knip reports the same
  finding. When only this app's knip reports it, add an ignore that names react's
  use, as the `src/observability/telemetry/index.ts` ignore does.

## Git hooks

- **The hooks live in `.vite-hooks/` and must stay committed.** `prepare`
  (`vp config --hooks`) generates only the `_/` dispatcher, so if
  `git ls-files .vite-hooks` is empty, no hook runs.
- Existing clone? After `pnpm install`, run `git config --unset core.hooksPath && pnpm prepare` once, or no hook runs.
- **pre-push runs no e2e.** A long pre-push hook can outlast the SSH connection and
  drop the push. CI runs e2e. `pnpm push [git push args]` runs `pnpm gate` first,
  then pushes with `--no-verify`.
- **Hooks call `pnpm exec`, never `npx`.** On a fresh machine `npx` downloads the
  newest version, not the one this repo tested against.

## CI

- **Key CI's concurrency group on `github.event_name`, not `github.workflow`.**
  When `deploy.yml` calls `ci.yml`, `github.workflow` is the caller's name.
  Non-PR runs are grouped per commit, so a newer push never drops a pending gate.
- **A moderate advisory in a production dependency fails CI**
  (`pnpm audit --prod --audit-level moderate`). `test` is one of the checks the
  `main` ruleset requires ([README](README.md#releases)), so the advisory blocks
  every PR. Prefer an `overrides` entry in `pnpm-workspace.yaml` that forces the
  patched version, with a comment naming the advisory. When no patched version
  exists, list the ID under `auditConfig.ignoreGhsas` there, with a comment giving
  the reason and a date to revisit.
- The PR title must be a conventional commit: it becomes the squash commit that
  release-please reads. How releases and images flow is in
  [Deploy](ARCHITECTURE.md#deploy) and the [README](README.md#releases).

## Auth

Each rule's reason is in [Token storage and refresh](SECURITY.md#token-storage-and-refresh)
and [Sign-out rules](SECURITY.md#sign-out-rules).

- **The API prefix is fixed and relative.** It is `API_PREFIX` in
  `src/constants/routes.ts`. Add no environment variable for it, and never call an
  absolute API URL ([The HTTP layer and session](ARCHITECTURE.md#the-http-layer-and-session)
  lists everything that moves with it).
- **The access token is memory-only.** It lives only in `auth.store`, and that
  store never gets a `persist` middleware.
- **`ensureSession()` is the only caller of `/auth/refresh`.** A second call site
  brings back the refresh race, and the existing tests will not see it.
- **Only an auth verdict signs a user out** (`isAuthVerdict`). If you widen it to
  any error, every user is signed out during a deploy.

## Analytics

Each rule's reason is in [Analytics privacy](SECURITY.md#analytics-privacy).

- **Wrap every rendered person name, email address, avatar initial and invitation
  address, and any free text staff typed, in `<Pii>`.** Wrap the value, not the
  sentence. A sentence a builder returns as a string (`auditSentence`,
  `bannerSentence`, `conflictSentence`, the maintenance
  preview) is masked whole, the safe default, as is a string `ReasonDialog`
  description. Use `<Pii>`, not `ph-no-capture`, which blanks the element in
  replay. A staff page that renders person data goes into the page list in
  `e2e/fixtures/pii.test.ts`, and a new harness person into its `NAMES`. Without
  them the guard cannot see it.
- **An attribute may carry personal data only if `mask-attribute.ts` masks it.**
  `e2e/nginx/analytics.test.ts` pins `aria-label` masking in the full snapshot
  and in later mutations.
- **Only `src/observability/telemetry/` imports posthog-js**, and only
  `telemetry.ts` imports it as a value, through `import()`. `pnpm check:bundle`
  fails if it reaches a first-visit chunk.
- **Never widen the privacy guards**: the free-string ban in `event-registry.ts`, the
  browser's ban on person and group properties, `ANALYTICS_URL_QUERY_ALLOWLIST`
  and `guardEvent`. What each one stops is in SECURITY.md. The one exception is
  the campaign keys `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`
  in the allowlist, which the standing rule on mailed links requires: express
  puts them on every link it mails, with values from its own constants. The
  sanitizer keeps a campaign value only when it matches `^[a-z0-9_-]{1,64}$`.
  Nothing else may be added, and never `token`, `email` or `redirect`.
- **Never call the SDK's `reset()` directly.** It drops the super properties and
  the consent answer. `resetKeepingConsent` restores both.
- **Page views come from the router, not posthog-js.** The router captures
  `$pageview` once the route has resolved (`onResolved`), so a page view never
  precedes the state it describes. `installRouteFeatureProperties` syncs the
  `$feature/*` properties on `onLoad`, which fires first, so each page view, the
  first one included, carries its flag values
  ([Router hooks](ARCHITECTURE.md#router-hooks-this-app-only)).
- **Page titles are fixed words**, never a record's or a person's name.
- **posthog-js minors and majors wait for a human** (`renovate.json`). Before
  taking one, run the suites that pin its internals: `url-sanitizer.test.ts`,
  `handoff.test.ts` and `analytics.sdk.test.ts` (in
  `tests/unit/observability/telemetry/`, against the real SDK), and
  `e2e/nginx/analytics.test.ts`.

## Feature flags

How flags are read is in [Feature flags](ARCHITECTURE.md#feature-flags).

- **The API is the only evaluator.** Nothing calls posthog-js's `getFeatureFlag`,
  `isFeatureEnabled` or `onFeatureFlags`. Keep `advanced_disable_feature_flags`.
  Never switch to `advanced_disable_flags`: it also stops remote config, so replay
  never starts. Never pass `bootstrap.featureFlags`: posthog-js would put those
  values on every event, over the server's.
- **A flag is a key in `flag-keys.ts` first**, mirroring express's registry entry.
  A value the server sends for a key the slice lacks is dropped. This app's slice
  is empty, so every flag key type is `never` until an entry is added.
- **A gated page has a gated API route.** `requireClientFlag` only hides the page.
  Express's `requireFlag` is what refuses.
- **Register `$feature/*` from a layout effect or a router hook, never from a
  query or loader.** A loader also runs for a hover preload, whose scope is not the
  page's.

## Maintenance mode

Customer maintenance mode is the API's; this app shows it to staff and lets
platform owners change it. How it works is in
[Maintenance admin](ARCHITECTURE.md#maintenance-admin-this-app-only), and the
change rules are in [Maintenance controls](SECURITY.md#maintenance-controls).

- **Staff pages are not gated by the mode.** Express lets `/platform/*`,
  `POST /auth/refresh` and `GET /profile` through in both modes, so a page loaded
  during `full` maintenance restores its session as usual. Add no maintenance
  store, gate or redirect here.
- **Read the platform state, never the `Maintenance-Mode` header.**
- **A new call to a customer route that express blocks in maintenance needs
  express's staff list.** Express lets staff through on such a route only when it
  is in `MAINTENANCE_STAFF_ROUTES`
  (`express-boilerplate/src/constants/maintenance-mode.constants.ts`), checked
  against `express-boilerplate/tests/fixtures/apex-api-calls.json`. Add the route
  to both in the same change, or staff get a 503 on it during maintenance.

## The container

The mechanism is in [The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).
The reasons are in [CSP and headers](SECURITY.md#csp-and-headers) and
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

- **No inline script, ever.** The CSP is `script-src 'self'`. A new origin for
  scripts, styles, images, fonts or `fetch` means changing the policy in
  `nginx.conf` in the same commit.
- **`src/lib/zod-jitless.ts` is the first import** in `main.tsx`, `tests/setup.ts`,
  `e2e/harness/harness.tsx` and every `src/` file that imports Zod as a value
  (anything but `import type`). The entry's first import alone is not enough: a
  chunk the entry imports evaluates before the entry's body.
  `tests/unit/lib/zod-jitless.test.ts` and `pnpm check:bundle` enforce it. Never fix Zod's JIT probe by adding
  `'unsafe-eval'`.
- **No `location` declares `add_header`.** One that did would drop every security
  header.
- **The image runs as uid 101 on a read-only root.** Everything it writes goes
  under `/tmp`. `docker/check-image.sh` checks this from outside.
- **Nothing is configured at build time.** A setting that differs between
  environments is a run-time variable, never a `VITE_*` value or a build ARG. A new
  setting touches every file
  [The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config)
  lists, in one change, and its pattern follows
  [Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

## Error tracking

How it works is in [Error tracking](ARCHITECTURE.md#error-tracking). What it sends
is in [Error-tracking privacy](SECURITY.md#error-tracking-privacy).

- **`listen.ts` imports only `identity-epoch.ts`**, which imports nothing. It is in
  every entry chunk, and `pnpm check:bundle` caps it at 1 KB gzipped.
- **`report.ts` never imports the router.** The router registers its route source
  (`setErrorRouteSource`), so a crash in the router's own module can still be
  reported.
- **Inject stays release-less.** `posthog-cli sourcemap inject` in the Dockerfile
  runs with a placeholder token, no `--release-*` flag and no `.git` in the context.
  A release makes it call PostHog and write a release id into every chunk, so an
  unchanged chunk would ship new bytes under its old hashed name.
- **Never soften `docker/upload-sourcemaps.sh`.** Every failure it detects fails
  the build ([README](README.md#source-maps) lists them). Never add `|| true` or
  `--no-fail`: without the maps, the image reports unreadable frames, silently.
- **A `@posthog/cli` bump updates both hashes in `docker/posthog-cli.sha256`** in
  the same change. The Dockerfile checks the binary against them before it runs it
  with the upload token.
- **Change a scrub rule in express first** ([The scrubber](SECURITY.md#the-scrubber)).
  `scrub.ts` is a byte-for-byte copy, so never edit it here alone.

## Never install

`react-hook-form`, `@hookform/resolvers`, `next-themes`, `sonner`,
`@tanstack/zod-form-adapter`, `clsx`, `tailwind-merge`, any `@radix-ui/*`, `cmdk`.

Each has an in-repo replacement:

- TanStack Form with a Zod validator, which needs no adapter package;
- `theme.store` with the pre-paint files `public/theme-init.js` and `public/boot-variant.js`;
- the `cn` package;
- Base UI through shadcn, its toast included (`src/lib/toast.ts`);
- `src/components/ui/command.tsx` on Base UI's Autocomplete, for `cmdk`, which
  pulls in Radix.

Adding one back gives the project two ways to do the same thing. eslint refuses an
import of `cmdk` or `@radix-ui/*` anywhere under `src/`, `tests/` and `e2e/`, the
vendored files included; only `src/lib/utils.ts` and the vendored files may import
the `cn` package.

**Never run `shadcn add form` or `shadcn add sonner`.** The registry's `form.tsx` is
built on react-hook-form, and ours is hand-written. The toast is Base UI's, from
base-vega's `toast` item (`src/components/ui/toast.tsx`); raise toasts with `toast`
from `@/lib/toast`, never from the UI file. Re-adding `toast` drops its local edits,
listed below.

## `src/components/ui/`

The directory holds vendored shadcn output. An edit there is lost the next time
the component is added again.

- **The formatter skips the vendored files** (`fmt.ignorePatterns` in `vite.config.ts`).
- **The linters relax only some rules for them**: the Tailwind rules,
  `react/only-export-components`, `local/comment-style`, the JSDoc
  requirement and the import restrictions. Every other rule, type-aware rules at
  error included, still applies, so a type error there fails CI. The one
  exception is `chart.tsx`, which turns off five type-aware rules its Recharts
  typing trips. Settle a doubt by running the linter, not by reading the config:
  for ESLint, `pnpm exec eslint --print-config <file>`. For Oxlint, lint a probe
  file under the glob: `oxlint --print-config` prints the whole config, not one
  file's. The exemptions live in the `vite.config.ts` overrides and in
  `eslint.config.js`.
- **`form.tsx` and `command.tsx` are ours**, fully linted and formatted. They are
  named in `vite.config.ts` and `eslint.config.js`. Find them with
  `grep -n 'form.tsx' vite.config.ts` and `grep -n '!(form|command)' eslint.config.js`:
  the `vite.config.ts` override blocks that re-enable the `react/only-export-components`
  rule and the import restriction, the `!` negations in `fmt.ignorePatterns`, and the
  `!(form|command)` globs in `eslint.config.js`. A third hand-written file there
  goes into all of them in the same change.
- **An edit to a vendored file is recorded, or CI fails.** `pnpm ui:drift`
  compares each file with its registry snapshot in `scripts/ui-registry/` and
  accepts only the edits in `docs/ui-local-edits.md`. On drift it prints the
  `ui-drift-hunk` block to record; add it with its reason. Never edit the
  snapshot by hand: `pnpm ui:drift:refresh` retakes it through the installed
  `shadcn` devDependency. A `shadcn` bump, or a `components.json` style or icon
  library change, fails the check until the snapshot is retaken, which is why
  Renovate leaves `shadcn` for a human.
- **A re-add drops these local edits; put them back.** `docs/ui-local-edits.md`
  is the full record. `avatar.tsx`: the fallback
  and group count use `text-foreground` (contrast). `tabs.tsx`: the panel keeps
  `rounded-md focus-visible:ring-3 focus-visible:ring-ring/50` (WCAG 2.4.7).
  `badge`, `button`, `switch`, `tabs`, `toggle` and the sidebar rail name their
  transition properties instead of `transition-all` (`toggle` keeps
  `background-color` in its list). The sidebar rail uses `after:w-0.5` and the
  dropdown `min-w-24`. `toast.tsx`: Tabler icons for the registry's
  `IconPlaceholder`; `PII_CLASS_NAME` last in the root's `cn(...)`, after
  `className`, so a caller cannot unmask a toast; top-right anchoring (`top-4`,
  `top-0 origin-top`, every Y offset sign-flipped, `swipeDirection` up and
  right); the `data-[type=…]` border and icon colours on `--success`,
  `--warning-strong` and `--destructive`; the viewport's
  `aria-label="Status messages"` (Base UI's default, "Notifications", reads as a
  feature name); and `<Toaster>` defaulting to `toastManager` from
  `@/lib/toast` instead of a manager of its own.
  `tests/unit/components/ui/toast.test.tsx` fails without the mask, the icon
  colours, the label or the shared manager. Base UI keeps the close button
  `aria-hidden` but tabbable while the stack is collapsed; that is accepted
  upstream behaviour, since Tab reaches the toast first and expands it. The
  files shared with react-boilerplate stay byte for byte equal to react's.
  Every Tabler icon in `src/components/ui/` except the one in `spinner.tsx`
  carries `aria-hidden="true"` (the
  guard test `tests/unit/ui-icons-aria-hidden.test.ts` fails otherwise); the combobox clear and chip-remove buttons carry
  `aria-label` for the same reason, and the apex-only `calendar.tsx` follows
  the same rule. `shadcn init` also overwrites `src/lib/utils.ts`,
  `src/hooks/use-mobile.ts` and `command.tsx` (with a cmdk one),
  rewrites every colour token in `globals.css` (`tests/unit/styles/tokens.test.ts`
  fails), duplicates its `@import` lines and adds `cmdk` and `next-themes`, and
  may bump unrelated dependencies: revert all of it.
- **The vitest config's coverage `exclude` is the inverse list.** It names the
  vendored files, so a new vendored file goes there and a hand-written one stays
  out.

## Forms

- **The Zod schemas in `src/schemas/` mirror the API's validators.** Change both
  repos together, or the client accepts what the server rejects.
- **Parse before posting.** TanStack hands `onSubmit` the raw form state, so a
  schema's `.trim()` or `.toLowerCase()` reaches the wire only if the value is
  parsed on the way out.
- **Edit forms send only the changed fields** (`useChangedFields` in
  `src/hooks/use-changed-fields.ts`, whose JSDoc gives the wiring). A stored value
  that today's rules refuse must not block saving other fields, so do not parse
  the whole form with the full schema.
- **`<Form>` clears a server error only on a native change event.** A Base UI
  `Select` emits none, so its change handler calls `serverErrors.clearField()`
  itself, as `src/components/features/tenant/invite-member-form.tsx` does. Base
  UI's `Checkbox` is unverified: check it before relying on either answer.

## Versions

- **TypeScript stays below 6.1.** typescript-eslint 8.70.1 peers
  `typescript >=4.8.4 <6.1.0`. Oxlint's type-aware engine bundles its own TS 7, so
  it does not constrain this pin. `renovate.json` holds it. Re-check the peer
  range before lifting the hold. `@types/node` is not part of this constraint.
- **The pnpm version lives only in `packageManager`.** The Dockerfile and CI read
  it. pnpm records itself in `pnpm-lock.yaml` (`packageManagerDependencies`), so
  changing the field means regenerating the lockfile in the same commit, or
  `--frozen-lockfile` fails.
- **`devEngines.runtime` (`onFail: "error"`) refuses a wrong Node at install.**
- **Renovate holds every Node pin below 25.** It covers the Docker `node` image,
  `.node-version` and CI's `node-version:`. Renovate does not move `engines.node` or
  `devEngines.runtime.version`, so a Node major moves those by hand alongside the
  pins.
- Renovate's schedule and automerge policy are in `renovate.json`. Majors and the
  Node and TypeScript pins always wait for a human, and so does `shadcn`
  (`pnpm ui:drift:refresh`).

## Conventions the linter enforces

- **kebab-case** file and folder names under `src/`. `src/pages/**` is exempt,
  because TanStack Router's file routes need `__root.tsx`, `_app.tsx`, `_auth.tsx`
  and `$tenantId.members.tsx`.
- **No path under `src/` that a content blocker matches.** Vite's dev server
  serves each file at its own URL, so a path like `analytics/events.ts` is
  dropped by EasyPrivacy and the app hangs on its loading screen.
  `tests/unit/blocker-safe-paths.test.ts` lists the banned shapes.
- **Suffixed files live in their directory:** `*.store.ts` in `src/states/`,
  `*.queries.ts` in `src/queries/`, `*.schemas.ts` in `src/schemas/`, `*.types.ts`
  in `src/types/`. A file in `src/hooks/` is named `use-*`.
- **No test file lives under `src/`**, `src/pages/` included, so the router never
  sees a test in its routes directory. Unit suites go in `tests/unit/`, mirroring
  their subject's path (`src/http/session.ts` → `tests/unit/http/session.test.ts`).
  Shared support goes in `tests/mocks/` and `tests/fixtures/`, imported as
  `@/tests/...`. Playwright suites go in `e2e/`.
- **Tests are `.test.ts(x)`**, never `.spec.`, and never in a `__tests__/` folder.
- **Import `cn` from `@/lib/utils`**, not from the package.
- **Comments.** Each comment is a JSDoc block, a directive, a one-line JSX comment
  or a single `//` line, and none narrates history (`local/comment-style`). By
  convention, a `//` line gives a why: security, concurrency, a timing budget or a
  named external bug. Every named function, method, class, interface, type alias
  and exported const carries a JSDoc description (`jsdoc/require-jsdoc`).

## Test timing

Across `tests/` and `e2e/`, eslint rejects the common forms of a bare sleep:

- a `setTimeout` inside `new Promise`;
- `sleep()`;
- `waitForTimeout()`;
- `setTimeout` from `timers/promises`.

It also rejects `networkidle`. Only `tests/fixtures/timing.ts` and `e2e/timing.ts`
are exempt, because they implement the deliberate waits.

1. **Wait on a condition, never on a duration.** In `tests/`, use `findBy*`,
   `waitFor` and `vi.waitFor`. In `e2e/`, use web-first assertions and
   `expect.poll`. Use fake timers when the product's own timer is under test.
2. **A deliberate wait is `settle(ms, reason)`** from `@/tests/fixtures/timing`
   (`e2e/timing.ts` re-exports it). The reason names what cannot be observed. A
   blank reason rejects, and an empty literal fails typecheck.
3. **A wall-clock upper bound is allowed only when the bound is the claim under
   test.** It gets a comment naming what it proves, and either references a product
   constant or has at least 10× headroom over the measured p99.
4. **Count only what the test created**, never a process-wide resource.
5. **A negative check waits on a barrier event where one exists**, and otherwise on
   `settle` with a reason.
6. **Never raise a timeout to fix a flake before its mechanism is known.**
   `asyncUtilTimeout` in `tests/setup.ts` is every `findBy*` and `waitFor` budget,
   so a `{ timeout }` that restates it is noise.

Three fake-timer traps:

- **Without `shouldAdvanceTime`, `findBy*` and `waitFor` hang.** Testing Library
  advances fake timers only when a `jest` global exists, and Vitest defines none.
  Under a clock that moves only when told, assert with `getBy*` after
  `await act(() => vi.advanceTimersByTimeAsync(ms))`. Restore real timers before
  the next `findBy*`.
- **React's async `act` flushes on `setImmediate`**, which Vitest's default
  `toFake` fakes too. Fake only what the code under test reads, as
  `router.test.tsx` does with `{ toFake: ['setTimeout', 'clearTimeout', 'Date'] }`.
- **`userEvent` typing under fake timers needs `advanceTimers`**, as in
  `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. Without it, typing
  waits on a clock that never moves.

## End-to-end tests

Playwright has five projects: `fixtures`, `live`, `contrast`, `nginx` and
`capture`.

- **Name e2e files `*.test.ts`.** `playwright.config.ts` sets `testMatch` to
  match. `vitest.config.ts` keeps an explicit `include` of `tests/**`, or Vitest
  would collect the Playwright files and run them under jsdom.
- **`e2e/` is type-linted through its own `tsconfig.json`.** It is not exempted
  like the root configs.
- **The dev server starts as `vite --force`.** Without it, Vite trusts a stale
  dependency cache, finds a new import mid-run, re-optimises and reloads the page.
  The reload drops the memory-only token and lands the test on `/login`. Outside
  CI, a server that is already running is reused, with whatever cache it has.

**`fixtures`** drives `e2e/harness/`: the real router and CSS, with MSW answering
the fixtures. It needs no backend. It exists for what jsdom cannot see, because
jsdom has no layout. `?path=` picks the route, and the harness's other query
parameters shape the fixtures: `?role=none|viewer|owner` (the default is a
platform admin), `?member=`, `?flags=`, `?preview=`, `?emails=none`, `?maintenance=full|route`, `?hold=` and `?fail=` (comma-separated `/api/v1/` paths that never answer or answer 500), `?profile=stale` and
`?onboarding=`. The harness's comments give each one's meaning.

**An endpoint the harness leaves unmocked falls through**
(`onUnhandledRequest: 'bypass'`). `fixtures` and `contrast` take `test` from
`e2e/hermetic.ts`, which answers such a request with express's 401 envelope. That
401 on a token-bearing request is a verdict, so it signs the harness user out. At
teardown it fails the test and names the endpoint. A test that fulfills an `/api`
route itself stamps the response with `FALLBACK_HEADER`, or teardown reports it as
an escape. If a fixtures test lands on `/login`, look for an unmocked endpoint.

**`live`** needs a real express and its services, Mailpit included, and runs only
with `E2E_LIVE=1`. Sign-in is by emailed link, so the helpers in
`e2e/live/helpers.ts` read each link from Mailpit (`mailedLink` in
`e2e/capture/mailpit.ts`):

- **`staffSession` grants first, then signs in.** `grantPlatformRole` creates
  the account when there is none, and an Apex link request for an address with
  no platform role answers 202 and mails nothing.
- **`freshEmail` per run.** Express mails one address at most one sign-in link
  a minute and ten a day, and answers 202 either way, so a reused address waits
  on links that never arrive.
- **`RATE_LIMIT_SCALE`.** Express allows ten link requests per IP per fifteen
  minutes. A 429 from `/auth/link/request` fails with a message naming
  `RATE_LIMIT_SCALE`; set it on the API under test to widen the limit.
- **`logIn`** hands the kept session's refresh cookie to a page once, because
  the cookie rotates on first use; after that staff sign in through the page and
  a new link. Apex creates no account, so `createUser` makes a customer through
  a customer-app link.

Nothing is cleaned up: every run leaves its accounts, tenants, invitations and
audit entries in that API's database. What the express under test needs is in
the [README](README.md#testing). The helpers that run commands (`grantPlatformRole`,
`fireEmailEvent`, `backdateStepUp`) run them in `E2E_API_DIR`, which has no
default: `apiDir` throws when it is unset, is not an existing directory, or its
`package.json` lacks the script the helper runs (`apiDirPlan`). The main express
checkout is allowed, because apex sends no process signals.

`assertApiServesApex` and `assertFakeEmailWebhook` fail before any test runs and
name what is wrong. The variables, with their defaults, are in the
[README](README.md#testing).

**posthog-js drops every event from a Playwright browser** (`navigator.webdriver`,
a headless user agent). An analytics e2e test uses `HUMAN_USER_AGENT` and calls
`passPosthogBotFilter` before its first navigation (`e2e/helpers/fake-posthog.ts`).

**`nginx`** runs against the production image (`pnpm test:e2e:nginx`), because the
headers and the CSP are only real there. The `@no-api` tests also run in CI with
nothing behind `/api`. The rest need a live API and run locally.
The variables are in the [README](README.md#testing), and the live half of
`e2e/nginx/analytics.test.ts` has its setup in the README's
[Analytics](README.md#analytics-posthog) section.

**`contrast`** (`pnpm test:contrast`) runs axe's `color-contrast` rule in a real
browser, in both themes, over every surface reachable without a backend. Each
surface asserts a heading only it renders before axe runs, because a redirected
route still paints a legible page. It is opt-in and not in CI. Component
composition changes contrast as much as the palette does, so run it before merging
UI work. Never judge a contrast change by eye.

**`capture`** (`pnpm capture:pages`) takes the page inventory's screenshots in
`docs/pages/img/` against a dev stack that is already up, and starts nothing.
Run it only through `pnpm capture:pages`: that script sets `E2E_CAPTURE=1`,
which turns `webServer` off, and a bare `--project=capture` starts the dev
server and then skips every test. It needs `E2E_API_DIR` to name the express
checkout (a staff account is granted its role there) and takes
`CAPTURE_ONLY=auth,tenants` to limit the run to those areas, or a route key such as
`'/tenants/$tenantId/members'` (quote it, or the shell expands `$tenantId`). It is opt-in and
not in CI. How to run it is in `docs/pages/README.md`.

## Accessibility

`tests/unit/a11y.test.tsx` is a gate. Every routed page and every open overlay it
covers (the dialogs, the mobile sheet, the command palette, the filters and the
menus) must come back clean. If something trips a rule, fix the markup. No rule
is disabled to make it pass.

- **axe runs over `document`, not a fragment.** Axe's page-level rules come back
  inapplicable for any smaller context. The gate pins this by asserting that
  `html-has-lang`, `document-title` and `bypass` are in `results.passes`.
- **Every page needs exactly one `<main>` and one `<h1>`, and the test asserts both
  by hand.** Under jsdom, axe cannot evaluate `page-has-heading-one` or
  `landmark-one-main`. Both use axe's `passForModal` check, which looks for a
  modal. When no dialog is open, the check calls `document.elementsFromPoint`,
  which axe polyfills over `document.elementFromPoint`; jsdom has neither, so axe
  files both rules under `incomplete`. `toHaveNoViolations` does not read that
  list. When a dialog is open, both rules pass without looking at the page.
  `CardTitle` renders a `div`, so a page's `h1` goes inside it.
- **`incomplete` is pinned.** `KNOWN_INCOMPLETE` lists the rules jsdom cannot
  decide, each with its reason, and the gate fails on any other rule filed there.
  `aria-valid-attr-value` is accepted only when every check on it is
  `controlsWithinPopup`, so a dangling reference still fails. A page holding an
  iframe, such as the email preview, runs with `frames: 'skip'`.
- **Menus are graded at menu scope.** Base UI portals a menu popup to
  `document.body`, so at document scope every open menu trips `region`.
  `expectNoViolationsIn` runs the same rule set against the popup. It asserts that
  `aria-required-children` passed, which happens only when axe evaluated a
  `role="menu"`.
- **`RouteError`, `PageSkeleton` and `RouteNotFound` render no `<main>`.** They
  render inside the matched route's `Outlet`, which a layout's `<main>` already
  wraps. The top-level splat route `src/pages/$.tsx` has no layout, so it wraps
  `RouteNotFound` in its own `<main>`.
- **Colour contrast is not checked here.** Every `cat.color` rule is off under
  jsdom, which has no layout. The `contrast` e2e project measures contrast, and the
  `fixtures` project checks overflow at 390px. Focus rings are checked only as a
  `focus-visible:` class, not in a browser.
