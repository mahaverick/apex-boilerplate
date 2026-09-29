import { useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useMemo, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { EditTenantDialog } from '@/components/features/tenants/edit-tenant-dialog'
import { OwnerInvitationDialog } from '@/components/features/tenants/owner-invitation-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { platformRoleAtLeast } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useStepUp } from '@/hooks/use-step-up'
import { focusFallbackOnRemoval } from '@/lib/focus-fallback'
import {
  activeOwnerCount,
  useArchiveTenant,
  usePurgeTenant,
  useReactivateTenant,
  useSuspendTenant,
} from '@/queries/tenant-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformTenantDetail } from '@/types/api.types'

type Open = 'edit' | 'owner' | 'suspend' | 'reactivate' | 'archive' | 'purge' | null

/**
 * The tenant's staff actions, shown only when the API would accept them
 * as the API gates them: admin for every soft
 * action, owner for Delete permanently, and the lifecycle state for each
 * transition. Edit also needs the tenant route's effective role, which is the
 * platform role unless the staff member is a member there too; a refusal then
 * shows inline. Suspend, Archive, Delete permanently and the owner invitation
 * go through step-up. No menu renders when no action applies; the dialogs
 * stay mounted, so one whose action just removed the last option still
 * closes and hands focus back.
 */
export function TenantActionsMenu({
  tenant,
  fallbackFocus,
}: {
  tenant: PlatformTenantDetail
  /** Where focus goes when an action removes this menu's trigger while it holds focus. */
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const role = useAuthStore((s) => s.user?.platformRole)
  const navigate = useNavigate()
  const stepUp = useStepUp()
  const suspend = useSuspendTenant(tenant.id)
  const reactivate = useReactivateTenant(tenant.id)
  const archive = useArchiveTenant(tenant.id)
  const purge = usePurgeTenant(tenant.id, {
    onPurged: () => navigate({ to: ROUTES.tenants, search: { state: 'archived' } }),
  })
  const [open, setOpen] = useState<Open>(null)
  const keepFocusOnPage = useMemo(() => focusFallbackOnRemoval(fallbackFocus), [fallbackFocus])

  const isAdmin = platformRoleAtLeast(role, 'admin')
  const isOwner = platformRoleAtLeast(role, 'owner')
  const state = tenant.lifecycleState
  const can = {
    edit: isAdmin && state === 'active',
    owner: isAdmin && state === 'active' && activeOwnerCount(tenant) === 0,
    suspend: isAdmin && state === 'active',
    reactivate: isAdmin && state === 'suspended',
    archive: isAdmin && state !== 'archived',
    purge: isOwner && state === 'archived',
  }
  const hasActions = Object.values(can).some(Boolean)

  const dialogProps = (which: Exclude<Open, null>) => ({
    open: open === which,
    onOpenChange: (next: boolean) => setOpen(next ? which : null),
  })

  return (
    <>
      {hasActions && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button ref={keepFocusOnPage} variant="outline" />}>
            Actions
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {can.edit && (
              <DropdownMenuItem onClick={() => setOpen('edit')}>Edit details</DropdownMenuItem>
            )}
            {can.owner && (
              <DropdownMenuItem onClick={() => setOpen('owner')}>
                Resend owner invitation
              </DropdownMenuItem>
            )}
            {can.suspend && (
              <DropdownMenuItem onClick={() => setOpen('suspend')}>Suspend</DropdownMenuItem>
            )}
            {can.reactivate && (
              <DropdownMenuItem onClick={() => setOpen('reactivate')}>Reactivate</DropdownMenuItem>
            )}
            {can.archive && (
              <DropdownMenuItem variant="destructive" onClick={() => setOpen('archive')}>
                Archive
              </DropdownMenuItem>
            )}
            {can.purge && (
              <DropdownMenuItem variant="destructive" onClick={() => setOpen('purge')}>
                Delete permanently
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {can.edit && <EditTenantDialog tenant={tenant} {...dialogProps('edit')} />}
      {can.owner && <OwnerInvitationDialog tenant={tenant} {...dialogProps('owner')} />}
      <ReasonDialog
        {...dialogProps('suspend')}
        title={`Suspend ${tenant.name}?`}
        description="Members lose access at once, and its members and invitations are frozen until it is reactivated."
        confirmLabel="Suspend"
        destructive
        onConfirm={async (reason) => {
          await stepUp.run(() => suspend.mutateAsync(reason))
          toast.success(`${tenant.name} suspended.`)
        }}
      />
      <ReasonDialog
        {...dialogProps('reactivate')}
        title={`Reactivate ${tenant.name}?`}
        description="Members get their access back straight away."
        confirmLabel="Reactivate"
        onConfirm={async (reason) => {
          await reactivate.mutateAsync(reason)
          toast.success(`${tenant.name} reactivated.`)
        }}
      />
      <ReasonDialog
        {...dialogProps('archive')}
        title={`Archive ${tenant.name}?`}
        description="Archiving is permanent: the tenant can’t be reactivated, its pending invitations are revoked, and its slug becomes free for reuse."
        confirmLabel="Archive"
        destructive
        confirmText={tenant.slug}
        onConfirm={async (reason) => {
          await stepUp.run(() => archive.mutateAsync(reason))
          toast.success(`${tenant.name} archived.`)
        }}
      />
      <ReasonDialog
        {...dialogProps('purge')}
        title={`Permanently delete ${tenant.name}?`}
        description="This removes the tenant, its settings, memberships, invitations and its own activity log for good. Only a record of the deletion stays in the platform log. It can’t be undone."
        confirmLabel="Delete permanently"
        destructive
        confirmText={tenant.slug}
        onConfirm={async (reason) => {
          await stepUp.run(() => purge.mutateAsync(reason))
          toast.success(`${tenant.name} permanently deleted.`)
        }}
      />
    </>
  )
}
