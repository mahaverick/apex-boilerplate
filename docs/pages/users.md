# Users

This file covers the user list (`/users/`), one user's page, and the user actions menu. Back to the [route map](README.md#route-map).

## Layout

`/users/$userId` (`src/pages/_app/users/$userId.tsx`) renders a bare `Outlet`: no header, tabs or gate of its own.

- Its loader starts `GET /platform/users/:id` (`['platform', 'user', id]`; a 404 is not retried) without awaiting it.
- `UserCrumb` reads the same query. The breadcrumb reads Users › User until it answers, and Users › {name or email} after.
- Each page under it reads the detail again and draws its own loading, error and not-found states. The not-found state is `UserNotFound`: "User not found", "This user does not exist, or was permanently deleted." and Back to users.

There is no tab bar. The user page links to Flags with an outline button in its header (admins and up).

Findings: [F-users-5](findings.md#f-users-5)

## Pages

### `/users/` — Users

![Users](img/users/users--default.jpg)

|                     |                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose             | Every account, searched, filtered and paged; admins create one here.                                                                                                                                                                                   |
| File                | `src/pages/_app/users/index.tsx`                                                                                                                                                                                                                       |
| Guard and redirects | `_app`                                                                                                                                                                                                                                                 |
| Layout              | `AppLayout`                                                                                                                                                                                                                                            |
| Data                | `GET /platform/users?search&status&signedIn&staff&sort&cursor&direction&limit&total=1` (`['platform', 'users', 'list', request]`), started by the loader; the previous view's rows stay up while the next loads. `POST /platform/users` from New user. |
| Sections            | Toolbar, table and pager; listed below the table.                                                                                                                                                                                                      |
| Components          | `DataTable` through `UsersTable` (Email (link), Name, Status, Staff role, Tenants, Last sign-in), `EmptyState`, `RoleDenied`, `CreateUserDialog`                                                                                                       |
| Transitions         | an email → `/users/$userId`; Previous/Next → `?cursor` (and `?direction=prev` going back); New user → the dialog                                                                                                                                       |

The page is the `h1`, then a `DataTable`:

- **Toolbar:**
  - the search box "Search by name or email", debounced into `?search`;
  - facets Status (Active, Inactive, Deleted; a comma list in `?status`), Signed in (Has signed in, Never signed in; `?signedIn`, keyed on the last sign-in, as the badge is) and Staff (`?staff`);
  - Columns, a result count and **New user** (admins and up).
- **Table:** Email and Last sign-in sort (`?sort`).
- **Footer:** "Showing", a rows-per-page select (`?limit`), and Previous page and Next page.

The **New user** dialog says "We email them a sign-in link to the customer app. It expires in {minutes} minutes. You can send a new one from their page." {minutes} comes from `signInLinkTtlSeconds` in `GET /status/client-settings`. Until that read loads, the dialog omits the middle sentence.

Every search, filter or sort change drops the cursor. The API orders the rows; nothing sorts client-side. The stale-cursor and failed-page states are the same as the tenant list's. On a phone the rows stack as cards.

| Loading                           | Error                                                                  | Empty                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ![](img/users/users--loading.jpg) | ![](img/users/users--error.jpg)                                        | ![](img/users/users--empty.jpg)                                                       |
| skeleton · table-shaped rows      | alert · "We couldn’t load the users. Select Try again." with Try again | "No users yet." unfiltered; "Nothing matches these filters." with Reset when filtered |

| Dark                           | Mobile                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------- |
| ![](img/users/users--dark.jpg) | ![](img/users/users--mobile.jpg)                                             |
| The table on dark surfaces.    | The filters wrap to three rows; the table scrolls sideways, cut after Email. |

| Role-denied                               |
| ----------------------------------------- |
| ![](img/users/users--role-denied.jpg)     |
| A viewer: the same list without New user. |

Findings: [F-users-1](findings.md#f-users-1), [F-users-2](findings.md#f-users-2)

### `/users/$userId/` — User

![User](img/users/user-overview--default.jpg)

|                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose             | One account: who it is, its tenants, sign-in methods and pending invitations, its emails, and for admins its recorded history and a link to its flags.                                                                                                                                                                                                                                                                                                 |
| File                | `src/pages/_app/users/$userId.index.tsx`                                                                                                                                                                                                                                                                                                                                                                                                               |
| Guard and redirects | `_app`; a 404 renders `UserNotFound`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Layout              | `AppLayout` › the bare user layout                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Data                | `GET /platform/users/:id` (`['platform', 'user', id]`), started by the layout's loader. Once it answers: `GET /platform/emails?user&limit=10` (`['platform', 'emails', 'list', request]`, no `total`) for the Emails card and, for admins and up, `GET /platform/audit-log?target` (`['platform', 'audit-log', …]`, `staleTime` 0, paged).                                                                                                             |
| Sections            | Header: the name (or the email) as the `h1`, the email, status badges, a Staff · {role} badge, joined and last sign-in; a Flags button (admins) and the **Actions** menu. A deleted account's read-only note. Cards: **Tenants** (each membership, linked, with its role), **Sign-in methods**, **Pending invitations**, **Emails** (the last ten, with View all emails), **Recorded actions on this account** (admins).                               |
| Components          | `Card`, `Badge`, `buttonVariants` links, `CardRowsSkeleton`, `LoadError`, `RoleDenied`, `UserActionsMenu`, `UserEmailsCard` (`QueryState`, `ItemGroup`, `Item`), `UserHistoryCard` (`ActivityTable`); `Note` (warning, deleted account); `EmptyState` (compact: "Not a member of any tenant.", "None.", "No emails sent to this account yet."); `ItemGroup`, `Item`, `ItemContent`, `ItemTitle`, `ItemActions` (the memberships and invitations lists) |
| Transitions         | a tenant → `/tenants/$tenantId`; Flags → `/settings/platform/flags?userId=`; View all emails → `/emails?user=`; an email → `/emails/$emailId`                                                                                                                                                                                                                                                                                                          |

**States.**

- While the user loads, the page is a visually hidden `h1` "User", a header and five cards.
  - The header is three bars in a `grid gap-1`: `h-8 w-64`, then `h-5 w-48` and `h-5 w-80` for the email and the badges line.
  - Each card is a title bar over two rows. The card count is the five an admin sees (a viewer sees fewer once loaded). The sizes are not measured against the loaded cards.
- A 404 keeps `UserNotFound`. A failed read with no user keeps its own `LoadError`.
- A failed refetch with the user on screen keeps the page, with that `LoadError` above it.
- The Emails card has its own states (an `h-24` skeleton, `LoadError`, `RoleDenied`), as does the History card (`DataTable`’s table-shaped skeleton).

**Status badges.** They read Active or Inactive (or Deleted), and "Never signed in" while the account has no last sign-in. The list's Signed in facet uses the same rule.

**Actions menu.** `UserActionsMenu` holds these items, as `availableUserActions` allows:

- Edit name
- Send sign-in link: admins and up, for an active account that is not staff or whose staff role is at or below the actor's (the actor's own included)
- Sign out everywhere
- Deactivate or Reactivate
- Delete
- Delete permanently

**Send sign-in link** opens a confirm dialog:

- Title "Send a sign-in link?", and the text "We email {address} a link that signs them in to {Apex or the customer app}. It works once and expires in {minutes} minutes."
- {minutes} is `signInLinkTtlSeconds` from `GET /status/client-settings`. Until that read loads, the text says "It works once."
- Send link posts `POST /platform/users/:id/sign-in-link`, with no reason and no step-up.
- A sent link toasts "Sign-in link sent to {address}."
- An email that did not go keeps the dialog open with "The email couldn’t be sent. Select Send link to try again."

| Loading                                                                                                                                 | Error                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ![](img/users/user-overview--loading.jpg)                                                                                               | ![](img/users/user-overview--error.jpg)                             |
| skeleton · three header bars over five cards (a title bar over two rows each), four of them in the viewport; the wrapper is `aria-busy` | alert · `LoadError` "We couldn’t load this user. Select Try again." |

| Dark                                   | Mobile                                                      |
| -------------------------------------- | ----------------------------------------------------------- |
| ![](img/users/user-overview--dark.jpg) | ![](img/users/user-overview--mobile.jpg)                    |
| Cards on the dark surfaces.            | The header buttons wrap under the address; the cards stack. |

| Role-denied                                                                |
| -------------------------------------------------------------------------- |
| ![](img/users/user-overview--role-denied.jpg)                              |
| A viewer: no Flags or Actions, and no History card. The Emails card stays. |

Findings: [F-users-3](findings.md#f-users-3), [F-users-5](findings.md#f-users-5), [F-overview-4](findings.md#f-overview-4), [F-palette-6](findings.md#f-palette-6)
