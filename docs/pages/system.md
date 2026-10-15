# System

The root URL and the page for a URL nothing matches. Back to the [route map](README.md#route-map).

### `/` — Root redirect

No shot: the route only redirects.

|                     |                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Send the visitor to the right starting page.                                                                                                                               |
| File                | `src/pages/index.tsx`                                                                                                                                                      |
| Guard and redirects | `beforeLoad` throws a redirect: signed in → `/overview`, else `/login`. For a signed-in account without a platform role, `_app` then sends `/overview` on to `/no-access`. |
| Layout              | none                                                                                                                                                                       |
| Data                | none of its own; the boot's session restore decides ([boot.md](boot.md#what-happens))                                                                                      |
| Transitions         | → `/overview`, `/no-access` or `/login`                                                                                                                                    |

The walk confirmed the signed-out exit: `/` landed on `/login`. The signed-in exits are from the code.

### `/$` — Not found

![Page not found](img/system/not-found--default.jpg)

|                     |                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Purpose             | Tell the reader the URL matches no page, and offer a way back.                                                                 |
| File                | `src/pages/$.tsx`, rendering `RouteNotFound` (`src/components/features/route-not-found.tsx`)                                   |
| Guard and redirects | none: the splat route is top level, under neither `_app` nor `_auth`, so it renders the same for everyone                      |
| Layout              | none: the route renders its own `<main>` around `RouteNotFound` on a plain background, with no staff shell and no `AuthLayout` |
| Data                | none                                                                                                                           |
| Sections            | A `Card` with "Page not found", "The address may be mistyped, or the page may have moved." and Go home                         |
| Components          | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardFooter`, `buttonVariants`                                           |
| Transitions         | Go home → `/`, which redirects to `/overview` or `/login`                                                                      |

The shot is taken signed in as staff (`/no-such-page`; its requests were `POST /auth/refresh` 200 and `GET /profile` 200), and still shows no sidebar or header.

`RouteNotFound` is also the router's `defaultNotFoundComponent`, so a route that throws `notFound()` inside a layout shows the same card inside that layout instead.

Findings: [F-system-1](findings.md#f-system-1)
