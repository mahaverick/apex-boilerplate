# StyleSeed design lock

StyleSeed is the design method this repo checks its UI against. The lock below records
what the method may and may not change here. The pinned engine is **styleseed v4.2.0**
(`github.com/bitjaru/styleseed`, tag `v4.2.0`), revision
`sha256:eeb89d12b518c178162f72ffe39a7126dd611953d2f66be0f5507de1bfbe7073`
(`.styleseed/manifests/members.json`). Rules move, so an unpinned adoption would change
under the repo. Upgrades go through `/ss-update` and are reviewed as a diff.

## Ownership

**Base UI (`@base-ui/react`) owns `src/components/ui/` permanently.** StyleSeed contributes
method, rules and review, never components. Its Radix primitives and its Vite/React
scaffold are not used and must not be introduced. `ss-component` reads the project's own
primitives, and nothing in the gate chain needs StyleSeed's components. Two checks hold the
line: `tests/unit/dependency-lock.test.ts` fails on any `@radix-ui/*` package or `cmdk` in
`pnpm-lock.yaml`, even a transitive one, and `eslint.config.js` restricts importing them.

**`src/components/ui/command.tsx` is hand-written on Base UI Autocomplete.** shadcn's
`command` is built on `cmdk`, which pulls in Radix. A re-pull of the registry file would
break the dependency lock, so keep the hand-written one. `.prettierignore` names it,
with `form.tsx`, as a file prettier formats.

## Selection

The selection lives in `.styleseed/project.json` and `.styleseed/artifacts/members.json`.

- Output grammar: `operations-console`
- Page type: `detail`
- Surface adapter `product-ui`, domain `saas`
- Brand recipe `enterprise-workbench`, palette recipe `quiet-mineral`, profile `none`.
  These feed the resolver only. shadcn's `base-vega` style and Tabler icons (`components.json`),
  with Inter Variable (`globals.css`), on this app's own indigo tokens, is the approved visual system.
- `.styleseed/project.json` still records the earlier font (`Geist Variable`). The manifest
  hashes that file, so it changes only through `/ss-update`, as a reviewed re-pin; until
  then its font value describes the previous font.
- Score floor: 80
- One artifact, `members`, registered in `.styleseed/artifacts/index.json`. Its route
  locator is `/tenants/$tenantId/members`, the app's route
  (`src/pages/_app/tenants/$tenantId.members.tsx`). No artifact covers the Overview,
  Tenants, Activity or other staff pages.

## Approved tokens

`src/styles/globals.css` is the single token file. It is written in `oklch()`, not hex.
The Tailwind 4 spacing base is the default `--spacing: 0.25rem`, so `N` is `N × 4px`.
The neutrals and the brand colours sit at hue 275 (indigo).

| StyleSeed role              | base-vega variable                       |
| --------------------------- | ---------------------------------------- |
| `semantic/background`       | `--background`                           |
| `semantic/surface`          | `--card`, `--popover`                    |
| `semantic/foreground`       | `--foreground`                           |
| `semantic/muted`            | `--muted`, `--muted-foreground`          |
| `semantic/border`           | `--border`                               |
| `semantic/input-background` | `--input`                                |
| `semantic/switch-background`| `--input` (no dedicated variable exists) |
| `semantic/destructive`      | `--destructive`                          |
| `semantic/success`          | `--success`                              |
| `semantic/warning`          | `--warning`, `--warning-strong`          |
| `semantic/info`             | `--info`                                 |
| `chart/1` to `chart/5`      | `--chart-1` to `--chart-5`               |

The three status tokens have hues 150 (success), 75 (warning) and 245 (info), and each has a
`-foreground` pair. Delivery, lifecycle and user-status badges use them
(`tone-badge.tsx`, `tenant-state-badge.tsx`, `user-status-badges.tsx`). **Never reach for a
palette class such as `green-500`; use the token.** `--info` and `--info-foreground` are
declared, and no component renders them, so they are ungraded until one does.

`--warning` is a fill under dark text, so it is too light to draw with on a light surface
(2:1 on `--popover`). `--warning-strong` is its ink: the toast's warning border and icon
(`ui/toast.tsx`) use it, and it is computed at 4.5:1 or better on `--popover` in both
themes. `--success` and `--destructive` clear that as they are, so the toast uses them
directly. The contrast suite grades the error and success toasts' text, icon and border in
both themes; no warning toast is reachable there, so `--warning-strong` is covered only by
its computed ratio.

`--muted-foreground` is `oklch(0.5 0.03 275)` in light and `oklch(0.74 0.03 275)` in dark. A
lighter light value fails contrast against `--muted`; `pnpm test:contrast`
(`e2e/contrast/contrast.test.ts`) measures it.

## Recorded exceptions

These are intentional. A later pass must not "fix" them.

| Rule     | Location                       | Value                                                                       | Why                                                                                         |
| -------- | ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SS001    | `ui/chart.tsx`                 | `#ccc` ×3, `#fff` ×2 (line 65)                                              | Attribute selectors such as `[stroke='#ccc']` that match recharts' default strokes and replace them (`#ccc` with `stroke-border`, `#fff` with `stroke-transparent`); the app paints neither colour |
| SS001    | `ui/command.tsx`               | `#9191` (line 3)                                                            | The issue number `shadcn-ui/ui#9191` in a comment, not a colour                             |
| SS002    | `ui/tabs.tsx`                  | `p-[3px]`                                                                   | Optical inset; the scale offers 2px or 4px, neither matches                                 |
| SS002    | `ui/tabs.tsx`                  | `bottom-[-5px]`                                                             | Optical underline offset; the scale offers -4px or -6px                                     |
| SS002    | `ui/switch.tsx`                | `h-[18.4px]` `w-[32px]` `h-[14px]` `w-[24px]`                               | Base UI thumb and track geometry; `18.4px` is fractional on purpose                         |
| SS005    | `ui/alert-dialog.tsx`          | `outline-none`                                                              | `AlertDialogPopup` sets no `tabIndex`, so it is not tab-reachable                           |
| SS005    | `ui/dialog.tsx`                | `outline-none`                                                              | `DialogPopup` sets no `tabIndex`, so it is not tab-reachable                                |
| SS005    | `ui/dropdown-menu.tsx`         | `outline-none` ×2                                                           | `MenuPositioner` is a wrapper and `MenuPopup` sets no `tabIndex`; neither is tab-reachable  |
| Repo fix | `ui/avatar.tsx`                | `AvatarFallback` and `AvatarGroupCount` use `text-foreground`               | Contrast margin. The registry has `text-muted-foreground`, which also passes AA on `bg-muted` today (swapping it in leaves `e2e/contrast/contrast.test.ts` green), so a re-pull is not caught; the test ("the avatar initials meet WCAG AA contrast") catches only a colour that fails. `AvatarGroupCount` is rendered nowhere |
| Repo fix | `ui/badge.tsx`                 | `transition-[color,background-color,border-color,box-shadow]`               | An explicit property list, not the registry's `transition-all`                              |
| Repo fix | `ui/button.tsx`                | `transition-[color,background-color,border-color,box-shadow,transform]`     | An explicit property list, not `transition-all`                                             |
| Repo fix | `ui/toggle.tsx`                | `transition-[color,background-color,border-color,box-shadow]`               | An explicit property list, the same as `badge.tsx`                                          |
| Repo fix | `ui/sidebar.tsx` (rail)        | `transition-[right,left,transform]`                                         | An explicit property list, not `transition-all`                                             |
| Lint     | `ui/chart.tsx`                 | Five type-aware rules off for this file                                     | Upstream is kept as pulled; see the `src/components/ui/chart.tsx` block in `eslint.config.js` |

`min-w-24` (the dropdown-menu sub-content) and `w-0.5` (the sidebar rail) spell the registry's
`min-w-[96px]` and `w-[2px]`, so a re-pull diff there is cosmetic.

Rounding an SS002 value to the nearest scale step changes how the control renders.
**Appearance wins over rule compliance.** The rule exists to prevent _unintentional_ drift.

Every other `outline-none` in `src/` sits in one of these places. Read an SS005 finding
before acting on it.

- **Paired with a focus ring in the same class string:** `ui/button.tsx`, `ui/input.tsx`,
  `ui/textarea.tsx`, `ui/select.tsx`, `ui/switch.tsx` and `ui/tabs.tsx`
  (`focus-visible:ring-3`), `ui/toggle.tsx` (`focus-visible:ring-[3px]`), `ui/input-group.tsx` (a `has-[...:focus-visible]` ring on the
  group), and the `focus-visible:outline-none` tab link in `pages/_app/tenants/$tenantId.tsx`.
- **On a focus target with `tabIndex={-1}`:** the layouts
  (`layouts/app-layout.tsx`, `layouts/auth-layout.tsx`, `pages/$.tsx`), the page and card
  headings that take focus from code through `useFocusAfter`
  (`features/tenant/members-card.tsx`, `features/tenant/pending-invitations.tsx`,
  `pages/_app/suppressions.tsx`, `pages/_app/emails/$emailId.tsx`,
  `pages/_app/tenants/$tenantId.tsx`, `pages/_app/tenants/$tenantId.onboarding.tsx`,
  `pages/_app/users/$userId.index.tsx`), the onboarding step `li`
  (`features/onboarding/onboarding-step-list.tsx`) and the suppression row when a focus target is
  set (`features/suppressions/suppressions-table.tsx`).
- **On an element with neither:** the chip input in `ui/combobox.tsx` and the list in
  `ui/command.tsx`.

## Known scanner limits

These describe the pinned engine's scanner (`styleseed-check.mjs`). This repo holds no
scanner source, so the engine-behaviour claims below cannot be checked here; only the
registry, `sourceRoots` and `requiredRenders` points can.

- **SS005 reports false positives.** Its message says "without a detected replacement", but
  it does not look for a replacement. Many reported lines carry `focus-visible:` in the same
  class string. Read findings; do not obey them.
- **`isTokenOrThemeFile` skips real code.** `src/components/features/theme-toggle.tsx` and
  `src/states/theme.store.ts` match its `theme[.-]` pattern and are never scanned.
  `tokenFiles` adds to the skip set rather than whitelisting into it, so the repo cannot fix
  this. Review those two files by hand.
- **The 0 to 100 score is an agent verdict**, not a computed number. The scanner computes no
  score; an agent applies the `ss-score` rubric. Evidence attaches to the score, and the
  number is judgment.
- **The scanner is registry-bound.** It scans only artifacts registered in
  `.styleseed/artifacts/index.json`, never the whole repo. A new route needs a new artifact.
- **An artifact sees only what it declares.** `members` lists `src/styles` in `sourceRoots`
  because the app's `prefers-reduced-motion` block lives in `globals.css`; without it `SS004`
  (motion with no reduced-motion path) fires. A file in `tokenFiles` must also sit under a
  `sourceRoot` to be scanned. An under-declared artifact gives confident, wrong findings.
- **`requiredRenders` must not be empty.** The contract rejects `[]`, so `members` declares a
  desktop (1440×900) and a mobile (390×844) loaded state. A render does not measure colour
  contrast; `pnpm test:contrast` does.

## Generated files that are not our tokens

`resolve-context.mjs` writes `.styleseed/palettes/members.css` and `members.json` from the
`keyColor` in `.styleseed/project.json`, which is `#171717`, a neutral that is not the app's
indigo. They are committed because the manifest hashes them and verification fails without
them.

**The application does not use them.** They define `--ss-*` variables that nothing imports
(`knip.jsonc` lists the CSS as unused on purpose). `src/styles/globals.css` holds the only
live design tokens. Do not wire `--ss-*` into components, and do not treat those files as a
source of truth.

`.prettierignore` excludes `.styleseed/` and this file. A reformat of the generated files
changes their hashes and turns a clean scan into an SS000 contract error.

## Skills

**Core method:** `ss-setup` `ss-resolve` `ss-lint` `ss-score` `ss-a11y` `ss-audit`
`ss-verify` `ss-tokens` `ss-update`

**For new UI work:** `ss-component` `ss-pattern` `ss-page` `ss-review`

**Excluded:** `ss-build` (scaffolds a screen first; the screens exist) · `ss-studio`
(creative exploration) · `ss-reference` (the grammar is chosen) · `ss-restyle` (base-vega is
approved) · `ss-dial` (the lock fixes brand values) · `ss-motion` (the reduced-motion check
already passes) · `ss-copy` · `ss-flow` · `ss-feedback` (out of scope) · `styleseed` (the
meta-router; invoke skills directly)

## Enforcement

On demand, not in CI. StyleSeed publishes no npm package and its plugin installs outside the
repo, so wiring the scanner into CI would mean vendoring it and owning its updates. `eslint`,
`tsc`, Vitest, `jest-axe` and the Playwright suites remain the CI gates (`.github/workflows/ci.yml`).

Run the deterministic tier with:

```bash
node "<styleseed>/skills/ss-score/scripts/styleseed-check.mjs" \
  scan --project-root . --artifact members --format json
```

The committed manifest verifies without a resolver step. Its `sources` are StyleSeed catalog
entries (`catalog:core`, `built-in:operations-console`, and so on), not project files, so
editing `globals.css`, a component or this file does not invalidate it. The `keyColor`
([Generated files](#generated-files-that-are-not-our-tokens)) does not match apex, and a scan
reports on the registered source roots, not on a rendered route. Add artifacts before
relying on a scan for pages other than members.

Re-run `resolve-context.mjs` only when an artifact's `selection`, its `implementation`
paths, `.styleseed/project.json` or the pinned engine version changes. It rewrites the
bundle, the manifest and the palette, so commit those together.

## Visual verification

`ss-verify` renders with Playwright at the `members` artifact's two viewports and scores what
source cannot show. Re-run it for a current visual score.

`pnpm test:e2e` runs the `fixtures` project in `e2e/fixtures/`. Its suites (`overview`,
`directory`, `emails`, `flags` and others) assert at a 390×844
viewport that no page scrolls sideways. A regression fails a test instead of waiting for
the next screenshot.
[CLAUDE.md](CLAUDE.md#end-to-end-tests) holds the conventions.

## Accessibility

`jest-axe` asserts and stays in CI; it is authoritative. `ss-a11y` discovers per artifact,
and its findings become tests. One model, two instruments.
