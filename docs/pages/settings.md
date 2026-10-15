# Settings

Account settings (profile, security), platform settings (staff, flags, maintenance), and the legacy paths `/flags`, `/maintenance`, `/staff` and `/profile` that redirect into them. Back to the [route map](README.md#route-map).

## Layout

`/settings` (`src/pages/_app/settings.tsx`) is the settings shell, under `AppLayout`. The pages it holds are declared in `src/constants/settings.ts` (`SETTINGS_GROUPS`, `SETTINGS_SECTIONS`).

|             |                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fetches     | nothing of its own                                                                                                                                                                                                                                           |
| Header      | A `header` (`max-w-3xl`) with the active section's label as the `h1` and its description under it; on `/settings/` itself, "Settings" and "Manage your account and the platform."                                                                            |
| Navigation  | On every `/settings/*` path the sidebar's content swaps to `NavSettings`: Back to console, then **Account** (Profile, Security) and **Platform** (Staff, Feature flags, Maintenance). Every staff role sees every section; each page gates its own controls. |
| Errors      | Each page sets `errorComponent: SettingsRouteError`, the router's error card with an `h2`, so a render crash keeps the settings header.                                                                                                                      |
| Breadcrumbs | Settings › {section}                                                                                                                                                                                                                                         |

The pages are not one width: the header is `max-w-3xl`, Profile and Security are `max-w-2xl` cards, Staff is `max-w-4xl`, and Feature flags and Maintenance take the full width.

Findings: [F-settings-6](findings.md#f-settings-6)

## Pages

### `/settings/` — Settings

![Settings](img/settings/settings-index--default.jpg)

|                     |                                                                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | The landing page: one card per group listing its sections.                                                                                                                                                                                                                                   |
| File                | `src/pages/_app/settings/index.tsx`                                                                                                                                                                                                                                                          |
| Guard and redirects | `_app`                                                                                                                                                                                                                                                                                       |
| Layout              | `AppLayout` › settings layout                                                                                                                                                                                                                                                                |
| Data                | no query                                                                                                                                                                                                                                                                                     |
| Sections            | `SettingsLinkList` per group: **Account** ("Your profile and sign-in.") with Profile and Security; **Platform** ("Who has staff access, feature flags and maintenance mode.") with Staff, Feature flags and Maintenance. Each row is a link with its icon, label, description and a chevron. |
| Components          | `Card`, `SettingsLinkList`                                                                                                                                                                                                                                                                   |
| Transitions         | each row → its section                                                                                                                                                                                                                                                                       |

Findings: [F-palette-8](findings.md#f-palette-8)

### `/settings/account/profile` — Profile

![Profile](img/settings/account-profile--default.jpg)

|                     |                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Change your own name.                                                                                                                                                                                             |
| File                | `src/pages/_app/settings/account.profile.tsx`                                                                                                                                                                     |
| Guard and redirects | `_app`                                                                                                                                                                                                            |
| Layout              | `AppLayout` › settings layout                                                                                                                                                                                     |
| Data                | `useProfile`: `GET /profile` (`['profile']`) with `initialData` from the session's user, so it paints at once and does not refetch until stale; `PATCH /profile` on Save changes, sending only the changed fields |
| Sections            | A **Details** card ("Update your name. Your email address cannot be changed here."): first and last name, Save changes, then the email and "Member since".                                                        |
| Components          | `Card`, `Form`, `FormField`, `FormError`, `Input`, `Button`, `Skeleton` (2× `h-9`)                                                                                                                                |
| Transitions         | none                                                                                                                                                                                                              |

The page has no error state of its own: it renders the skeleton while there is no data and the form once there is, and a failed `GET /profile` is never shown. The capture has no section for it, so there is no loading or error shot. In the walk, failing `GET /profile` on a full load failed the session restore instead and landed on `/login?redirect=%2Fsettings%2Faccount%2Fprofile`, so the page's own failure is from the code.

Findings: [F-settings-1](findings.md#f-settings-1)

### `/settings/account/security` — Security

![Security](img/settings/account-security--default.jpg)

|                     |                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Your sign-in methods, a password change, and signing out every other session.                                                                                                                                                                           |
| File                | `src/pages/_app/settings/account.security.tsx`                                                                                                                                                                                                          |
| Guard and redirects | `_app`                                                                                                                                                                                                                                                  |
| Layout              | `AppLayout` › settings layout                                                                                                                                                                                                                           |
| Data                | `GET /auth/providers` (`['auth', 'providers']`), started when the page mounts; `POST` change-password and revoke-other-sessions on their buttons                                                                                                        |
| Sections            | One `max-w-2xl` card (`SecuritySection`) ← providers: **Sign-in methods**, then **Change password** (current, new, confirm) or, for a Google-only account, a line saying so. Independent of providers: **Other sessions** with Sign out other sessions. |
| Components          | `Card`, `Form`, `Input`, `Button`, `Skeleton` (`h-5 w-40`, `h-9`), `LoadError`                                                                                                                                                                          |
| Transitions         | none                                                                                                                                                                                                                                                    |

The change-password form waits for the providers read, because it needs `hasPassword`; a failed read hides the form behind its `LoadError`, while Other sessions stays.

| Loading                                              | Error                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| ![](img/settings/account-security--loading.jpg)      | ![](img/settings/account-security--error.jpg)                    |
| skeleton · `h-5 w-40` and `h-9`, over Other sessions | alert · `LoadError` for the sign-in methods, over Other sessions |

Findings: [F-settings-2](findings.md#f-settings-2)

### `/settings/platform/staff` — Staff

![Staff](img/settings/platform-staff--default.jpg)

|                     |                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Everyone with platform access and their role, staff invitations, and the other ways someone becomes staff.                                                                                                                                                                                                                |
| File                | `src/pages/_app/settings/platform.staff.tsx`                                                                                                                                                                                                                                                                              |
| Guard and redirects | `_app`; the API decides who may change a role or invite                                                                                                                                                                                                                                                                   |
| Layout              | `AppLayout` › settings layout                                                                                                                                                                                                                                                                                             |
| Data                | the platform tenant's own routes, started when the page mounts: `GET /tenants/platform` (the caller's role, `['tenants', 'platform']`), `GET /tenants/platform/members` (`['tenants', 'platform', 'members']`) and, for owners and admins, `GET /tenants/platform/invitations` (`['tenants', 'platform', 'invitations']`) |
| Sections            | **Staff members** (`MembersCard`: Name, Email, Role, Actions, every member, no paging). **Invite staff** and **Pending invitations** (`InvitationsSection`). A static **Other ways in** card about `PLATFORM_EMAIL_DOMAINS` and `pnpm platform:grant`.                                                                    |
| Components          | `MembersCard`, `InvitationsSection`, `Card`, `Table`, `Select`, `Button`, `Skeleton`, `LoadError`, `Alert` (destructive, step-up dismissed), `ReasonDialog`                                                                                                                                                               |
| Transitions         | none                                                                                                                                                                                                                                                                                                                      |

The dev database has 60 staff members, all in one table: the page is about 4,100 px tall, and the Actions column is cut at the card's right edge, so its buttons read "Remo". In the error shot the role read and the members read both failed: the Staff members card shows the members `LoadError` and the role `LoadError`, and the invitations section shows the role `LoadError` again.

| Loading                                                                        | Error                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| ![](img/settings/platform-staff--loading.jpg)                                  | ![](img/settings/platform-staff--error.jpg)                   |
| skeleton · 2× `h-10` in the members card, one `h-40` block for the invitations | alert · three `LoadError`s, two of them the same role message |

| Role-denied                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ![](img/settings/platform-staff--role-denied.jpg)                                                                                                                                                                              |
| A viewer: the staff list with each role as plain text and Leave on their own row only; the invite and pending-invitations cards are replaced by "Invitations are managed by owners and admins. Your role here can’t see them." |

Findings: [F-settings-3](findings.md#f-settings-3), [F-settings-4](findings.md#f-settings-4), [F-settings-7](findings.md#f-settings-7), [F-tenants-6](findings.md#f-tenants-6)

### `/settings/platform/flags` — Feature flags

![Feature flags](img/settings/platform-flags--default.jpg)

|                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Every registered flag's live state, flags PostHog has that the registry lacks, the traits a rollout can target, and for admins any user's evaluation.                                                                                                                                                                                                                                                                                                                                                                     |
| File                | `src/pages/_app/settings/platform.flags.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Guard and redirects | `_app`; `?userId`, `?tenantId`, `?app` (default `react`) drive the evaluate panel                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Layout              | `AppLayout` › settings layout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Data                | `GET /platform/flags` (`['platform', 'flags', 'list']`), started by the loader. The evaluate panel (admins and up) searches `GET /platform/users?q&limit=8`, reads `GET /platform/users/:id` for a picked user, and `GET /platform/flags/evaluate` (`['platform', 'flags', 'evaluate', userId, tenantId, app]`, no retry, `gcTime` 0).                                                                                                                                                                                    |
| Sections            | A not-configured or stale note when PostHog is not set up. **Registered flags**: `FlagRegistryTable` (Flag with its description, Kind, Scope, Sent to, Fallback, State, Rollout, a PostHog link), and when the definitions last changed. **Evaluate**: a user search, then that user's evaluation; below admin, "Admins can evaluate flags for a user." **In PostHog, not registered**: `UnregisteredFlagsTable` or "None. Every PostHog flag is registered." **Traits reference**: one bordered row per trait with Copy. |
| Components          | `Table`, `Badge`, `Input`, `Button`, `Skeleton` (`h-64`), `LoadError`, `RoleDenied`, `Alert` (destructive, user search and user-not-found), `FlagEvaluatePanel`, `TraitsPanel`, `Note` (passive: not configured; warning: stale); `EmptyState` (compact: no flags registered, none unregistered); hand-rolled: the trait rows                                                                                                                                                                                             |
| Transitions         | a user's Flags button lands here with `?userId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

| Loading                                       | Error                                       | Empty                                              |
| --------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| ![](img/settings/platform-flags--loading.jpg) | ![](img/settings/platform-flags--error.jpg) | ![](img/settings/platform-flags--empty.jpg)        |
| skeleton · one `h-64` block for four sections | alert · `LoadError`                         | registry stubbed empty: "No flags are registered." |

| Role-denied                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- |
| ![](img/settings/platform-flags--role-denied.jpg)                                                                               |
| A viewer: the registry, the unregistered list and the traits; the Evaluate section says "Admins can evaluate flags for a user." |

Findings: [F-settings-2](findings.md#f-settings-2), [F-settings-5](findings.md#f-settings-5), [F-overview-3](findings.md#f-overview-3)

### `/settings/platform/maintenance` — Maintenance

![Maintenance](img/settings/platform-maintenance--default.jpg)

|                     |                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Customer maintenance mode and each queue's pause state; platform owners turn it on, change it or turn it off.                                                                                                                               |
| File                | `src/pages/_app/settings/platform.maintenance.tsx`                                                                                                                                                                                          |
| Guard and redirects | `_app`; the controls are owner-only                                                                                                                                                                                                         |
| Layout              | `AppLayout` › settings layout                                                                                                                                                                                                               |
| Data                | `GET /platform/maintenance-mode` (`['platform', 'maintenance-mode']`), the query the shell's banner already polls; `PUT /platform/maintenance-mode` from `ChangeModeDialog` and `TurnOffDialog`                                             |
| Sections            | **Customer access**: the mode badge, a sentence on what customers have, a note that staff keep working, and Turn on maintenance… (or Change and Turn off…) for owners. **Queues**: one line per queue, "{name}: not paused, 0 running".     |
| Components          | `Card`, `Badge`, `Button`, `Skeleton` (`h-64`), `LoadError`, `RoleDenied`, `Alert` (destructive, conflict and refusal in both dialogs), `ChangeModeDialog`, `TurnOffDialog`; `EmptyState` (compact: no queues); hand-rolled: the queue list |
| Transitions         | none                                                                                                                                                                                                                                        |

The error state shows only when there is no data yet: a failed refresh keeps the last answer up.

| Loading                                             | Error                                             |
| --------------------------------------------------- | ------------------------------------------------- |
| ![](img/settings/platform-maintenance--loading.jpg) | ![](img/settings/platform-maintenance--error.jpg) |
| skeleton · one `h-64` block for two cards           | alert · `LoadError`                               |

| Role-denied                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![](img/settings/platform-maintenance--role-denied.jpg)                                                                                           |
| A viewer: the state and the queues, with "Only a platform owner can change maintenance mode." in place of the controls. Admins see the same line. |

Findings: [F-settings-2](findings.md#f-settings-2)

## Redirects

Each runs `_app`'s guard first, then throws a `redirect` in `beforeLoad` that keeps the search and hash and replaces the history entry, so Back skips it.

| Route                 | File                                         | Goes to                          |
| --------------------- | -------------------------------------------- | -------------------------------- |
| `/settings/account/`  | `src/pages/_app/settings/account.index.tsx`  | `/settings/account/profile`      |
| `/settings/platform/` | `src/pages/_app/settings/platform.index.tsx` | `/settings/platform/staff`       |
| `/flags`              | `src/pages/_app/flags.tsx`                   | `/settings/platform/flags`       |
| `/maintenance`        | `src/pages/_app/maintenance.tsx`             | `/settings/platform/maintenance` |
| `/staff`              | `src/pages/_app/staff.tsx`                   | `/settings/platform/staff`       |
| `/profile`            | `src/pages/_app/profile.tsx`                 | `/settings/account/profile`      |
