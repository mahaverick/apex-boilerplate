# Suppressions

Addresses no email is sent to after a hard bounce or a spam complaint (`/suppressions`). Back to the [route map](README.md#route-map).

## Pages

### `/suppressions` — Suppressions

![Suppressions](img/suppressions/suppressions--default.jpg)

|                     |                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Every suppressed address, active or lifted, searched and paged; admins lift one.                                                                                                                                                                                                                                                                           |
| File                | `src/pages/_app/suppressions.tsx`                                                                                                                                                                                                                                                                                                                          |
| Guard and redirects | `_app`                                                                                                                                                                                                                                                                                                                                                     |
| Layout              | `AppLayout`                                                                                                                                                                                                                                                                                                                                                |
| Data                | `GET /platform/email-suppressions?search&state&sort&cursor&direction&limit&total=1` (`['platform', 'email-suppressions', 'list', request]`), started by the loader; `POST /platform/email-suppressions/:id/lift` through `ReasonDialog`                                                                                                                    |
| Sections            | The `h1`, then `DataTable`: a toolbar with "Search by address" (debounced into `?search`), the State facet (Active, Lifted; a comma list in `?state`, and none picked is the API's default, active), Columns and a result count; the table (Address and Suppressed sort, `?sort`); then "Showing", a rows-per-page select and Previous page and Next page. |
| Components          | `DataTable` through `SuppressionsTable` (Address, Reason, Source, Suppressed, State, and a Lift button for admins), `EmptyState`, `RoleDenied`, `ReasonDialog`                                                                                                                                                                                             |
| Transitions         | Lift → the reason dialog; the row stays, marked lifted                                                                                                                                                                                                                                                                                                     |

The empty first page with nothing picked says "No suppressed addresses."; with a search or a state picked, "Nothing matches these filters." with Reset. Each row (or card, on a phone) is a focus landmark: after Lift the focus lands on it. The dev database has no suppressed address, so the default shot is the empty state.

| Loading                                         | Error                                                        | Empty                                         |
| ----------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| ![](img/suppressions/suppressions--loading.jpg) | ![](img/suppressions/suppressions--error.jpg)                | ![](img/suppressions/suppressions--empty.jpg) |
| skeleton · table-shaped rows                    | alert · "We could not load the suppressions." with Try again | "Nothing matches these filters." with Reset   |

| Role-denied                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- |
| ![](img/suppressions/suppressions--role-denied.jpg)                                                                          |
| A viewer: the same list. Lift is admin only, but with no suppressed address the shot shows the empty list and no row action. |

Findings: [F-suppressions-1](findings.md#f-suppressions-1), [F-suppressions-2](findings.md#f-suppressions-2)
