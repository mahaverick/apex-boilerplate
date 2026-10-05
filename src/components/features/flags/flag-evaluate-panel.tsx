import { useQuery } from '@tanstack/react-query'
import { FlagEvaluation } from '@/components/features/flags/flag-evaluation'
import { FlagUserPicker } from '@/components/features/flags/flag-user-picker'
import { LoadError } from '@/components/features/load-error'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FLAG_APP_LABELS } from '@/constants/flags.constants'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'
import { FLAG_EVALUATE_APPS } from '@/schemas/flags.schemas'
import type { FlagApp, FlagRow, PlatformUserDetail } from '@/types/api.types'

/** The select value meaning "evaluate with no tenant". */
const NO_TENANT = 'none'

/** What the form evaluates; it lives in the page's URL. */
export interface FlagEvaluateSearch {
  userId?: string
  tenantId?: string
  app: FlagApp
}

interface FlagEvaluatePanelProps {
  search: FlagEvaluateSearch
  onSearchChange: (next: FlagEvaluateSearch) => void
  registry: FlagRow[]
}

/**
 * The tenant express evaluates with: only one of the user's own tenants,
 * and none for Apex, which staff use with no tenant. Anything else in the
 * URL is ignored rather than sent to be refused.
 * @param user - The user being evaluated.
 * @param search - The form's state.
 * @returns The tenant id to send, or undefined.
 */
function effectiveTenantId(
  user: PlatformUserDetail,
  search: FlagEvaluateSearch
): string | undefined {
  if (search.app !== 'react' || search.tenantId === undefined) return undefined
  return user.memberships.some((membership) => membership.tenantId === search.tenantId)
    ? search.tenantId
    : undefined
}

/** The app and tenant choices for a picked user, and the evaluation they produce. */
function EvaluateUser({
  user,
  search,
  onSearchChange,
  registry,
}: FlagEvaluatePanelProps & { user: PlatformUserDetail }) {
  const tenantId = effectiveTenantId(user, search)
  const name = fullName(user)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Evaluating for</span>
        <Pii className="font-medium">{name ?? user.email}</Pii>
        {name !== null && <Pii className="text-muted-foreground">{user.email}</Pii>}
        <Button variant="outline" size="sm" onClick={() => onSearchChange({ app: search.app })}>
          Change user
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          aria-label="App"
          value={[search.app]}
          onValueChange={(value: string[]) => {
            const app = FLAG_EVALUATE_APPS.find((option) => value.includes(option))
            if (app) onSearchChange({ userId: user.id, tenantId, app })
          }}
        >
          {FLAG_EVALUATE_APPS.map((app) => (
            <ToggleGroupItem key={app} value={app}>
              {FLAG_APP_LABELS[app]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          value={tenantId ?? NO_TENANT}
          disabled={search.app === 'apex'}
          onValueChange={(value: string | null) =>
            onSearchChange({
              userId: user.id,
              app: search.app,
              ...(value === null || value === NO_TENANT ? {} : { tenantId: value }),
            })
          }
        >
          <SelectTrigger aria-label="Tenant" className="w-56">
            <SelectValue>
              {(current: string) =>
                user.memberships.find((membership) => membership.tenantId === current)
                  ?.tenantName ?? 'No tenant'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TENANT}>No tenant</SelectItem>
            {user.memberships.map((membership) => (
              <SelectItem key={membership.tenantId} value={membership.tenantId}>
                {membership.tenantName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {search.app === 'apex' && (
        <p className="text-xs text-muted-foreground">
          Apex is evaluated with no tenant, as staff use it.
        </p>
      )}
      <FlagEvaluation params={{ userId: user.id, tenantId, app: search.app }} registry={registry} />
    </div>
  )
}

/**
 * Explains every registered flag for one user: pick them from the
 * directory, optionally one of their tenants, and the app whose client
 * view to mark. Admins and up; the page leaves it out below that.
 */
export function FlagEvaluatePanel({ search, onSearchChange, registry }: FlagEvaluatePanelProps) {
  const user = useQuery({
    ...platformUserQueryOptions(search.userId ?? ''),
    enabled: search.userId !== undefined,
  })
  if (search.userId === undefined) {
    return <FlagUserPicker onPick={(userId) => onSearchChange({ userId, app: search.app })} />
  }
  if (user.isError) {
    return statusFrom(user.error) === 404 ? (
      <div role="alert" className="grid justify-items-start gap-3 rounded-md border p-4">
        <p className="text-sm text-muted-foreground">That user doesn’t exist any more.</p>
        <Button variant="outline" size="sm" onClick={() => onSearchChange({ app: search.app })}>
          Change user
        </Button>
      </div>
    ) : (
      <LoadError message="We could not load this user." onRetry={() => void user.refetch()} />
    )
  }
  if (user.data === undefined) return <Skeleton className="h-24 w-full" />
  return (
    <EvaluateUser
      user={user.data}
      search={search}
      onSearchChange={onSearchChange}
      registry={registry}
    />
  )
}
