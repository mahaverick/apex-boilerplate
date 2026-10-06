import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { LoadError } from '@/components/features/load-error'
import { ChangeModeDialog, type OnMode } from '@/components/features/maintenance/change-mode-dialog'
import { TurnOffDialog } from '@/components/features/maintenance/turn-off-dialog'
import { RoleDenied } from '@/components/features/role-denied'
import { ToneBadge } from '@/components/features/tone-badge'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import type { BadgeTone } from '@/constants/badge-tones'
import { MAINTENANCE_MODE_LABELS, STAFF_WRITES_NOTE } from '@/constants/maintenance-mode.constants'
import { platformRoleAtLeast } from '@/constants/roles'
import { queueLine } from '@/lib/maintenance-mode'
import { absoluteTime } from '@/lib/relative-time'
import { maintenanceModeQueryOptions } from '@/queries/maintenance-mode.queries'
import { isRoleDenied } from '@/queries/platform.queries'
import { useAuthStore } from '@/states/auth.store'
import type {
  MaintenanceMode,
  PlatformMaintenanceModeView,
  QueuePauseState,
} from '@/types/api.types'

export const Route = createFileRoute('/_app/maintenance')({
  head: () => ({ meta: [{ title: pageTitle('Maintenance') }] }),
  staticData: { crumb: 'Maintenance' },
  component: MaintenancePage,
})

const MODE_TONES: Record<MaintenanceMode, BadgeTone> = {
  off: 'success',
  read_only: 'warning',
  full: 'destructive',
}

/** Which dialog is open. */
type Open = 'change' | 'off' | null

/** The owner's moves from each mode, as button label and the modes its dialog offers. */
const ACTIONS: Record<MaintenanceMode, { label: string; modes: readonly OnMode[] }[]> = {
  off: [{ label: 'Turn on maintenance…', modes: ['read_only', 'full'] }],
  read_only: [
    { label: 'Escalate to full…', modes: ['full'] },
    { label: 'Edit message…', modes: ['read_only'] },
  ],
  full: [
    { label: 'Switch to read-only…', modes: ['read_only'] },
    { label: 'Edit message…', modes: ['full'] },
  ],
}

/** The state: mode, since when, who set it, why, and the customer message. */
function StateFacts({ view }: { view: PlatformMaintenanceModeView }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Customers</dt>
      <dd>
        <ToneBadge tone={MODE_TONES[view.mode]}>{MAINTENANCE_MODE_LABELS[view.mode]}</ToneBadge>
      </dd>
      {view.since !== null && (
        <>
          <dt className="text-muted-foreground">Since</dt>
          <dd>
            <time dateTime={view.since}>{absoluteTime(view.since)}</time>
          </dd>
        </>
      )}
      {view.changedBy !== null && (
        <>
          <dt className="text-muted-foreground">Set by</dt>
          <dd>
            <Pii>{view.changedBy.name}</Pii>
          </dd>
        </>
      )}
      {view.reason !== null && (
        <>
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="wrap-break-word whitespace-pre-line">
            <Pii>{view.reason}</Pii>
          </dd>
        </>
      )}
      {view.mode !== 'off' && view.message !== null && (
        <>
          <dt className="text-muted-foreground">Customer message</dt>
          <dd className="wrap-break-word whitespace-pre-line">
            <Pii>{view.message}</Pii>
          </dd>
        </>
      )}
    </dl>
  )
}

/** Each queue's pause state and running jobs, for checking "0 running" before database work. */
function QueueList({ queues }: { queues: QueuePauseState[] }) {
  if (queues.length === 0) {
    return <p className="text-sm text-muted-foreground">The API reported no queues.</p>
  }
  return (
    <ul aria-label="Queues" className="grid gap-1 text-sm tabular-nums">
      {queues.map((queue) => (
        <li key={queue.name}>{queueLine(queue)}</li>
      ))}
    </ul>
  )
}

/**
 * The owner's buttons for the current mode, and their dialogs. The change
 * dialog keeps the modes it last opened with, so its title does not change
 * while it animates out.
 */
function OwnerControls({ view }: { view: PlatformMaintenanceModeView }) {
  const [open, setOpen] = useState<Open>(null)
  const [modes, setModes] = useState<readonly OnMode[]>(['read_only'])
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS[view.mode].map((action) => (
        <Button
          key={action.label}
          variant={view.mode === 'off' || action.modes.includes('full') ? 'destructive' : 'outline'}
          onClick={() => {
            setModes(action.modes)
            setOpen('change')
          }}
        >
          {action.label}
        </Button>
      ))}
      {view.mode !== 'off' && <Button onClick={() => setOpen('off')}>Turn off…</Button>}
      <ChangeModeDialog
        view={view}
        modes={modes}
        open={open === 'change'}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
      />
      <TurnOffDialog
        view={view}
        open={open === 'off'}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
      />
    </div>
  )
}

/** The loaded page: the state with the owner's controls, then the queues. */
function MaintenanceContent({
  view,
  isOwner,
}: {
  view: PlatformMaintenanceModeView
  isOwner: boolean
}) {
  return (
    <>
      <section aria-labelledby="maintenance-state">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="maintenance-state">Customer access</h2>
            </CardTitle>
            <CardDescription>
              {view.mode === 'off'
                ? 'Customers have the whole app.'
                : view.mode === 'full'
                  ? 'Customers see a maintenance page and cannot sign in.'
                  : 'Customers can read but not change anything.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <StateFacts view={view} />
            <p className="text-sm text-muted-foreground">{STAFF_WRITES_NOTE}</p>
            {isOwner ? (
              <OwnerControls view={view} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Only a platform owner can change maintenance mode.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
      <section aria-labelledby="maintenance-queues">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="maintenance-queues">Queues</h2>
            </CardTitle>
            <CardDescription>
              Full maintenance pauses every queue; jobs already running finish first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QueueList queues={view.queues} />
          </CardContent>
        </Card>
      </section>
    </>
  )
}

/**
 * Maintenance mode, for every staff role: who switched customers to which
 * mode and why, the message they see, and each queue's pause state. Owners
 * change it here; everyone else reads it.
 */
function MaintenancePage() {
  const state = useQuery(maintenanceModeQueryOptions())
  const isOwner = platformRoleAtLeast(
    useAuthStore((s) => s.user?.platformRole),
    'owner'
  )
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Maintenance</h1>
      {state.isError && state.data === undefined ? (
        isRoleDenied(state.error) ? (
          <RoleDenied />
        ) : (
          <LoadError
            message="We could not load the maintenance state."
            onRetry={() => void state.refetch()}
          />
        )
      ) : state.data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <MaintenanceContent view={state.data} isOwner={isOwner} />
      )}
    </div>
  )
}
