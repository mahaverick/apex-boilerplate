/**
 * @file A tenant's member list with role and removal controls, parameterised
 * by slug so the Staff page reuses it for the platform tenant.
 */
import { IconAlertCircle } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { createContext, useContext, useRef, useState } from 'react'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { ReasonDialog, type ReasonDialogProps } from '@/components/features/reason-dialog'
import { ROLE_FILTER } from '@/components/features/tenant/role-filter'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { TableRowsSkeleton } from '@/components/shared/section-skeleton'
import { Alert, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  canActorModifyTarget,
  canChangeRoles,
  canManageTenant,
  canPlatformActorModifyTarget,
  isLastOwnerBlocked,
  MEMBERSHIP_ROLES,
  ROLE_LABELS,
  type MembershipRole,
} from '@/constants/roles'
import { PLATFORM_TENANT_SLUG, ROUTES } from '@/constants/routes'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { toast } from '@/lib/toast'
import { noteError } from '@/observability/errors'
import { analyticsKey } from '@/observability/telemetry'
import {
  dropTenantCache,
  isMemberNotFound,
  useLeaveTenant,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/queries/tenant-writes.queries'
import {
  memberName,
  membersList,
  membersListOptions,
  ownersBesides,
  ownersQueryOptions,
  useMyRole,
  type TenantMember,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

/**
 * Which member each role may change or remove. The platform tenant (the Staff
 * page) follows the staff rule: an owner may act on another owner. Acting on your
 * own row (leaving, changing your own role) keeps the customer rule.
 */
function modifyRule(slug: string) {
  return (actor: MembershipRole, target: MembershipRole, isSelf: boolean): boolean =>
    slug === PLATFORM_TENANT_SLUG && !isSelf
      ? canPlatformActorModifyTarget(actor, target, false)
      : canActorModifyTarget(actor, target, isSelf)
}

/**
 * What the Leave dialog says on a customer tenant. Every Apex user is staff,
 * and once the membership is gone the API lets them in through their
 * platform role.
 */
const LEAVE_CUSTOMER = 'You stop being a member of this tenant. You keep your staff access to it.'

/**
 * What the Leave dialog says on the Staff page. The platform role is the
 * platform-tenant membership, so leaving ends it, and only a new invitation
 * brings it back.
 */
const LEAVE_PLATFORM = 'You lose staff access immediately. An owner or admin must invite you back.'

/** Added on a customer tenant for an owner or admin, the roles that can have sent invitations: leaving revokes them. */
const INVITATIONS_REVOKED_ON_LEAVE = 'Pending invitations you sent are revoked.'

/** Added on the Staff page for an owner or admin: leaving staff also revokes, in each other tenant, what their membership there cannot grant, or everything where they have none. */
const PLATFORM_INVITATIONS_REVOKED_ON_LEAVE =
  'Pending invitations you sent here are revoked, and so are any you sent in other tenants for a role you can no longer grant there.'

/** What a leave says when the API answers 404: the membership was already gone. */
const NO_LONGER_A_MEMBER = 'You are no longer a member of this tenant.'

/** What a leave of the platform tenant says when the page could not move to Overview afterwards. */
const LEFT_BUT_STUCK = 'You left, but this page could not move on. Reload it to continue.'

/** What a role change or removal says when its member is already gone, in the customer app's words. */
const MEMBER_GONE = 'That member is no longer in this tenant.'

/** The reason the last owner's own controls are switched off. */
const LAST_OWNER_REASON = 'A tenant must always have an owner. Add another owner first.'

/**
 * What this card says when the member list request failed. Kept apart from
 * `ROLE_ERROR`, with its own `refetch`, because the member list and the role
 * lookup are separate requests: each error names its own request, and each Try
 * again retries that request.
 */
const MEMBERS_ERROR =
  'We could not load this tenant’s members, so none are listed here. This is not a sign that it has none.'

/**
 * Says so when a role change or removal found its member already gone
 * (`isMemberNotFound`), and calls `onGone`: the write awaited the member
 * list's refetch, so the row, and the control that started the write, have
 * gone, and the card moves focus as after a removal.
 * @param error - The write's failure.
 * @param onGone - The row's `onRemoved`.
 * @returns True when the member was gone and it was said; false for any other failure.
 */
function sayMemberGone(error: unknown, onGone: () => void): boolean {
  if (!isMemberNotFound(error)) return false
  toast.error(MEMBER_GONE)
  onGone()
  return true
}

/**
 * Rethrows a staff write's refusal for the reason dialog to show, except a
 * member already gone, which is said as the member path says it, in a toast,
 * and the dialog closes (`sayMemberGone`). An API older than 2.1.0 sends that
 * 404 with no code, so the dialog would take it for the access check's.
 * @param error - The write's failure.
 * @param onGone - The row's `onRemoved`.
 */
function unlessMemberGone(error: unknown, onGone: () => void): void {
  if (!sayMemberGone(error, onGone)) throw error
}

/**
 * The role cell: a select when the actor may change this member's role, plain
 * text otherwise. That takes two predicates: `canChangeRoles`, because the
 * PATCH members route is owner-only, and `modifyRule(slug)` for which
 * target this actor may touch. Removal uses a different pair (see `memberControls`).
 *
 * The select's accessible name includes the member's name, since there is one
 * select per row. When `isLastOwner`, this cell renders the row's one
 * last-owner explanation, with id `reasonId`, as visible text rather than a
 * tooltip: the disabled Leave button has `pointer-events: none`, so a tooltip
 * on it would never open, and Base UI's Tooltip sets no `role="tooltip"`.
 * `isLastOwner` is only true for an owner acting on their own membership,
 * which the predicates always leave as a select, so the explanation always
 * renders when it is needed. Staff acting through platform access (`asStaff`)
 * pick the role first, then give the audited reason in the reason dialog. A
 * change that finds the member already gone calls `onGone`, through the
 * promise rather than `mutate`'s per-call callbacks: the refetch unmounts this
 * cell before those could run.
 */
function RoleCell({
  slug,
  member,
  myRole,
  asStaff,
  isSelf,
  isLastOwner,
  ownersPending,
  reasonId,
  onGone,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  /** Acting through platform access: the change asks for an audited reason first. */
  asStaff: boolean
  isSelf: boolean
  isLastOwner: boolean
  /** The owner count is not known yet (loading or failed): the select stays off, with no reason claimed. */
  ownersPending: boolean
  /** The row's one last-owner explanation, which this cell renders. */
  reasonId: string
  /** Called when the change finds the member gone: the row, and this cell, are gone, so the card moves focus. */
  onGone: () => void
}) {
  const updateRole = useUpdateMemberRole(slug)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const [pendingRole, setPendingRole] = useState<MembershipRole | null>(null)
  const targetRole = member.membership.role
  const name = memberName(member)

  if (!canChangeRoles(myRole) || !modifyRule(slug)(myRole, targetRole, isSelf)) {
    return <span>{ROLE_LABELS[targetRole]}</span>
  }

  /** Sends the change through step-up and says so; rejects with the API's refusal. */
  const changeRole = (role: MembershipRole, reason?: string) =>
    stepUp
      .run(() => updateRole.mutateAsync({ userId: member.user.id, role, reason }))
      .then(() => {
        toast.success(
          <>
            <Pii>{name}</Pii> is now {ROLE_LABELS[role]}.
          </>
        )
      })

  return (
    <div className="grid gap-1">
      <Select
        value={targetRole}
        // The refused change is not pending while its step-up waits; the select holds still all the same.
        disabled={isLastOwner || ownersPending || updateRole.isPending || waiting}
        onValueChange={(value: string | null) => {
          if (value === null || value === targetRole) return
          if (asStaff) {
            setPendingRole(value as MembershipRole)
            return
          }
          changeRole(value as MembershipRole).catch((error: unknown) => {
            if (!sayMemberGone(error, onGone)) toast.error(messageFrom(error))
          })
        }}
      >
        <SelectTrigger
          aria-label={`Role for ${name}`}
          aria-describedby={isLastOwner ? reasonId : undefined}
          className="w-36"
        >
          <SelectValue>
            {(value: string) => ROLE_LABELS[value as MembershipRole] ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MEMBERSHIP_ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isLastOwner && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {LAST_OWNER_REASON}
        </p>
      )}
      {asStaff && (
        <ReasonDialog
          open={pendingRole !== null}
          onOpenChange={(open) => {
            if (!open) setPendingRole(null)
          }}
          title="Change this member’s role?"
          description={
            <>
              <Pii>{name}</Pii> becomes {pendingRole === null ? '' : ROLE_LABELS[pendingRole]} in
              this customer tenant.
            </>
          }
          confirmLabel="Change role"
          onConfirm={(reason) =>
            changeRole(pendingRole ?? targetRole, reason).catch((error: unknown) =>
              unlessMemberGone(error, onGone)
            )
          }
        />
      )}
    </div>
  )
}

/**
 * Remove, for staff acting on a customer tenant through platform access: the
 * same words as a member's Remove, behind the reason dialog the API's audited
 * staff writes use (step-up included). Staff are never a member there, so it
 * is never Leave.
 */
function StaffRemoveMemberButton({
  slug,
  member,
  onRemoved,
  finalFocus,
}: {
  slug: string
  member: TenantMember
  /**
   * Called after the removal, or when the member was already gone, with this
   * button: the refetch takes the row away, so the card moves focus once the
   * button has gone.
   */
  onRemoved: (trigger?: HTMLElement | null) => void
  /** The dialog's `finalFocus`, so closing it does not hand focus back to a button the card is about to move it from. */
  finalFocus: ReasonDialogProps['finalFocus']
}) {
  const removeMember = useRemoveMember(slug)
  const stepUp = useStepUp()
  const trigger = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const name = memberName(member)
  /** Hands this button to the card, which moves focus once the refetch has removed it. */
  const removed = () => onRemoved(trigger.current)
  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        size="sm"
        disabled={removeMember.isPending}
        onClick={() => setIsOpen(true)}
      >
        Remove
      </Button>
      <ReasonDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Remove this member?"
        description={
          <>
            <Pii>{name}</Pii> will lose access to this tenant immediately. Pending invitations they
            sent are revoked.
          </>
        }
        confirmLabel="Remove"
        destructive
        finalFocus={finalFocus}
        onConfirm={async (reason) => {
          try {
            await stepUp.run(() => removeMember.mutateAsync({ userId: member.user.id, reason }))
          } catch (error) {
            unlessMemberGone(error, removed)
            return
          }
          toast.success(
            <>
              <Pii>{name}</Pii> removed.
            </>
          )
          removed()
        }}
      />
    </>
  )
}

/**
 * The Remove control, or Leave on your own row, behind a confirm dialog.
 * Remove goes through the members route; Leave, which every role has, through
 * the caller's own membership route (`useLeaveTenant`). For the last owner it
 * is a disabled Leave button described by the row's explanation in `RoleCell`
 * (`isLastOwner` implies `isSelf`). An owner or admin leaving is told the
 * invitations they sent are revoked, as the server does. After leaving, or
 * when the API answers 404 because the membership was already gone:
 *
 * - On a customer tenant the page stays. The caller is staff, so the tenant
 *   still answers through platform access: the refetched card drops their row
 *   and switches to the staff controls, and focus moves as after a removal.
 * - On the platform tenant (the Staff page) staff access is gone, and the
 *   refreshed profile says so. The page navigates to Overview, whose guard
 *   shows /no-access, and only once that navigation has finished drops the
 *   tenant's cache, so no query still mounted on it refetches.
 *
 * A dismissed step-up removes no one, so the dialog stays open and says so,
 * ready to be confirmed again.
 */
function RemoveMemberButton({
  slug,
  member,
  myRole,
  isSelf,
  isLastOwner,
  ownersPending,
  reasonId,
  onRemoved,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  isSelf: boolean
  isLastOwner: boolean
  /** The owner count is not known yet (loading or failed): the control stays off, with no reason claimed. */
  ownersPending: boolean
  /** The row's one last-owner explanation, rendered by `RoleCell`. */
  reasonId: string
  /** Called after someone else is removed or found already gone, or you leave a customer tenant: the row, and this button, are gone, so the card moves focus. */
  onRemoved: () => void
}) {
  const removeMember = useRemoveMember(slug)
  const leaveTenant = useLeaveTenant(slug)
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stepUpRefused, setStepUpRefused] = useState<string | null>(null)
  const name = memberName(member)
  const isPending = isSelf ? leaveTenant.isPending : removeMember.isPending

  /**
   * Says so; from the platform tenant, leaves its routes and only then forgets
   * it. A navigation that fails is reported and said, and the cache is dropped
   * all the same: the tenant's routes answer 404 from here, so the page still
   * mounted on them refetches what is true.
   */
  async function afterLeaving(message: string) {
    setIsOpen(false)
    toast.success(message)
    if (slug !== PLATFORM_TENANT_SLUG) {
      onRemoved()
      return
    }
    try {
      await navigate({ to: ROUTES.overview })
    } catch (error) {
      noteError(error, 'router', true)
      toast.error(LEFT_BUT_STUCK)
    }
    dropTenantCache(queryClient, slug)
  }

  if (isLastOwner || ownersPending) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        aria-describedby={isLastOwner ? reasonId : undefined}
      >
        {isSelf ? 'Leave' : 'Remove'}
      </Button>
    )
  }

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(next) => {
        // While the removal runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        setStepUpRefused(null)
        setIsOpen(next)
      }}
    >
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={isPending}>
            {isSelf ? 'Leave' : 'Remove'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSelf ? (
              'Leave this tenant?'
            ) : (
              <>
                Remove <Pii>{name}</Pii>?
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSelf ? (
              <>
                {slug === PLATFORM_TENANT_SLUG ? LEAVE_PLATFORM : LEAVE_CUSTOMER}
                {canManageTenant(myRole) &&
                  ` ${slug === PLATFORM_TENANT_SLUG ? PLATFORM_INVITATIONS_REVOKED_ON_LEAVE : INVITATIONS_REVOKED_ON_LEAVE}`}
              </>
            ) : slug === PLATFORM_TENANT_SLUG ? (
              <>
                <Pii>{name}</Pii> loses staff access immediately. Pending invitations they sent here
                are revoked, and so are any they sent in other tenants for a role they can no longer
                grant there. Only a new invitation or <code>pnpm platform:grant</code> gives them
                staff access again. To block their sign-in too, deactivate their account in Users.{' '}
                <Link
                  to={ROUTES.user}
                  params={{ userId: member.user.id }}
                  className="underline underline-offset-4"
                >
                  Open <Pii>{name}</Pii> in Users
                </Link>
              </>
            ) : (
              <>
                <Pii>{name}</Pii> will lose access to this tenant immediately. Pending invitations
                they sent are revoked.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {stepUpRefused !== null && (
          <Alert variant="destructive">
            <IconAlertCircle aria-hidden="true" />
            <AlertTitle>{stepUpRefused}</AlertTitle>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setStepUpRefused(null)
              stepUp
                .run(() =>
                  isSelf
                    ? leaveTenant.mutateAsync()
                    : removeMember.mutateAsync({ userId: member.user.id })
                )
                .then(
                  () => {
                    setBusy(false)
                    if (isSelf) {
                      void afterLeaving('You left this tenant.')
                      return
                    }
                    setIsOpen(false)
                    toast.success(
                      <>
                        <Pii>{name}</Pii> removed.
                      </>
                    )
                    onRemoved()
                  },
                  (error: unknown) => {
                    setBusy(false)
                    if (isReauthRequired(error)) {
                      setStepUpRefused(stepUpRefusal(error))
                      return
                    }
                    if (isSelf && statusFrom(error) === 404) {
                      void afterLeaving(NO_LONGER_A_MEMBER)
                      return
                    }
                    setIsOpen(false)
                    if (sayMemberGone(error, onRemoved)) return
                    toast.error(messageFrom(error))
                  }
                )
            }}
          >
            {busy && waiting ? STEP_UP_WAITING_LABEL : isSelf ? 'Leave' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** What a member's cells and card are built from. */
interface MemberRowContext {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  /** Acting through platform access (`access: 'platform'`): every change asks for a reason. */
  asStaff: boolean
  myUserId: string | undefined
  /** The owners besides the signed-in user that the API counts (`ownersBesides`). */
  otherOwners: number
  /** Whether the owners read has landed. An owner's own controls stay off until it has, since the count is not known. */
  ownersKnown: boolean
  /** Called once a removal has taken the row away; the staff Remove passes its own button, the card moving focus once it has gone. */
  onRemoved: (trigger?: HTMLElement | null) => void
  /** The staff Remove dialog's `finalFocus`, from the card's focus request. */
  removalFinalFocus: ReasonDialogProps['finalFocus']
}

/**
 * The rules one member's controls follow. Removing someone else needs
 * `canManageTenant` (owner or admin, as the DELETE members route requires) and
 * `modifyRule(slug)`, a different pair from the role-change gate in `RoleCell`;
 * a member's own row always offers Leave, except for staff acting through
 * platform access, who hold no membership there to leave. `reasonId` is one id
 * per row: the last-owner explanation renders once, in the role cell, and every
 * control the guard disables points at it. Only an owner acting on their own
 * owner row depends on the owner count, so only that row waits for the owners
 * read.
 * @param context - The member and the caller.
 */
function memberControls({
  slug,
  member,
  myRole,
  asStaff,
  myUserId,
  otherOwners,
  ownersKnown,
}: MemberRowContext) {
  const targetRole = member.membership.role
  const isSelf = member.user.id === myUserId
  const countMatters = isSelf && targetRole === 'owner'
  const canLeave = isSelf && !asStaff
  return {
    isSelf,
    isLastOwner: ownersKnown && isLastOwnerBlocked({ targetRole, isSelf, otherOwners }),
    ownersPending: countMatters && !ownersKnown,
    canRemove:
      canLeave || (canManageTenant(myRole) && modifyRule(slug)(myRole, targetRole, isSelf)),
    reasonId: `last-owner-${member.membership.id}`,
  }
}

/** One member's role: a select when the caller may change it, text otherwise. */
function MemberRole(context: MemberRowContext) {
  const { slug, member, myRole, asStaff, onRemoved } = context
  const { isSelf, isLastOwner, ownersPending, reasonId } = memberControls(context)
  return (
    <RoleCell
      slug={slug}
      member={member}
      myRole={myRole}
      asStaff={asStaff}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      ownersPending={ownersPending}
      reasonId={reasonId}
      onGone={onRemoved}
    />
  )
}

/** One member's Remove (staff: Remove with a reason; own row: Leave); nothing when the caller has none. */
function MemberActions(context: MemberRowContext) {
  const { slug, member, myRole, asStaff, onRemoved, removalFinalFocus } = context
  const { isSelf, isLastOwner, ownersPending, canRemove, reasonId } = memberControls(context)
  if (!canRemove) return null
  if (asStaff) {
    return (
      <StaffRemoveMemberButton
        slug={slug}
        member={member}
        onRemoved={onRemoved}
        finalFocus={removalFinalFocus}
      />
    )
  }
  return (
    <RemoveMemberButton
      slug={slug}
      member={member}
      myRole={myRole}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      ownersPending={ownersPending}
      reasonId={reasonId}
      onRemoved={onRemoved}
    />
  )
}

/**
 * One member as a stacked card, for phones, where the scrolling table puts the
 * Actions column and the last-owner explanation off-screen. The role and Remove
 * controls are the table cells' own.
 */
function MemberCard(context: MemberRowContext) {
  const { member, myUserId } = context
  return (
    <Item variant="outline" role="listitem">
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">
          <span className="flex flex-wrap items-center gap-2">
            <Pii>{memberName(member)}</Pii>
            {member.user.id === myUserId && (
              <span className="text-xs font-normal text-muted-foreground">(you)</span>
            )}
          </span>
        </ItemTitle>
        <ItemDescription className="line-clamp-none break-all">
          <Pii>{member.user.email}</Pii>
        </ItemDescription>
      </ItemContent>
      <ItemFooter className="flex-wrap justify-start">
        <MemberRole {...context} />
        <MemberActions {...context} />
      </ItemFooter>
    </Item>
  )
}

/** What the card hands its cells: the caller and the tenant, which every row's controls read. */
type MembersCardContext = Omit<MemberRowContext, 'member'>

const MembersCardScope = createContext<MembersCardContext | null>(null)

/**
 * A member's row context: the card's, with the row's member. The columns are
 * module-level, so a cell reads what changes between renders (the caller, the
 * owner count, the removal callbacks) from context, and re-renders in place
 * rather than remounting with its dialog state.
 * @param member - The row's member.
 */
function useMemberRowContext(member: TenantMember): MemberRowContext {
  const card = useContext(MembersCardScope)
  if (card === null) throw new Error('A member cell renders inside the members card.')
  return { ...card, member }
}

/** The name cell: the full name, or a dash for a member with none, and "(you)" on the caller's own row. */
function MemberNameCell({ member }: { member: TenantMember }) {
  const { myUserId } = useMemberRowContext(member)
  const name = fullName(member.user)
  return (
    <span className="font-medium">
      {name === null ? <span className="text-muted-foreground">—</span> : <Pii>{name}</Pii>}
      {member.user.id === myUserId && (
        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
      )}
    </span>
  )
}

/** The role cell of the table. */
function MemberRoleCell({ member }: { member: TenantMember }) {
  return <MemberRole {...useMemberRowContext(member)} />
}

/** The actions cell of the table. */
function MemberActionsCell({ member }: { member: TenantMember }) {
  return <MemberActions {...useMemberRowContext(member)} />
}

const column = createColumnHelper<DataTableFeatures, TenantMember>()

/** The name, email and role columns every viewer sees. */
const READ_COLUMNS = [
  column.accessor((member) => fullName(member.user) ?? '', {
    id: 'name',
    header: 'Name',
    meta: { sorts: ['name'], sortName: analyticsKey('name') },
    cell: ({ row }) => <MemberNameCell member={row.original} />,
  }),
  column.accessor((member) => member.user.email, {
    id: 'email',
    header: 'Email',
    meta: { sorts: ['email'], sortName: analyticsKey('email') },
    cell: ({ getValue }) => <Pii className="break-all">{getValue()}</Pii>,
  }),
  column.accessor((member) => member.membership.role, {
    id: 'role',
    header: 'Role',
    // The cell holds the row's controls and the last-owner explanation they point at.
    enableHiding: false,
    meta: { sorts: ['role'], sortName: analyticsKey('role') },
    cell: ({ row }) => <MemberRoleCell member={row.original} />,
  }),
]

/** The read columns, then Actions. */
const MEMBER_COLUMNS = column.columns([
  ...READ_COLUMNS,
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { label: 'Actions', actions: true, className: 'text-right' },
    cell: ({ row }) => <MemberActionsCell member={row.original} />,
  }),
])

/**
 * The read columns alone, for staff through platform access who cannot manage
 * the tenant: they hold no membership to leave and may remove no one, so no
 * row could ever have an action.
 */
const READ_ONLY_COLUMNS = column.columns(READ_COLUMNS)

/**
 * A tenant's members. Its states, in order:
 *
 * - No role: the role lookup is its own request and can fail alone, so its
 *   failure shows a `LoadError` retrying that request, and a skeleton shows
 *   while it is pending. A failed request never shows a skeleton, which would
 *   wait forever with no retry.
 * - Then `DataTable`'s: its own skeleton, load error with Try again, empty
 *   message (only for a list that answered with no rows) and the rows, as a
 *   table or, on a phone, as member cards. The member list can fail alone.
 *
 * The last-owner rule needs every owner, and a page of the list may not hold
 * them, so an owner reads them separately (`ownersQueryOptions`). Until that
 * read lands, the owner's own controls stay off with no reason given; when it
 * fails, they stay off and an `Owners could not be loaded.` error with Try
 * again shows above the list. Only an owner acting through a membership asks:
 * no other role's controls depend on the count.
 */
export function MembersCard({
  slug,
  title = 'Members',
  description = 'Everyone with access to this tenant.',
  tenantId,
}: {
  slug: string
  title?: string
  description?: string
  /** An Apex tenant page's id, scoping the cache; the Staff page passes none. */
  tenantId?: string
}) {
  const list = useListSearch(membersList)
  const members = useListQuery(list, (request) => membersListOptions(slug, tenantId, request))
  const {
    role: myRole,
    access,
    isPending: isRolePending,
    isError: isRoleError,
    retry,
  } = useMyRole(slug, tenantId)
  const asStaff = access === 'platform'
  const owners = useQuery({
    ...ownersQueryOptions(slug, tenantId),
    enabled: myRole === 'owner' && !asStaff,
  })
  const myUserId = useAuthStore((state) => state.user?.id)
  const otherOwners = ownersBesides(owners.data, myUserId, slug === PLATFORM_TENANT_SLUG)
  const focus = useFocusAfter<'heading'>()

  /** What the cells read, once the caller's role is known. */
  const card: MembersCardContext | null =
    myRole && !isRoleError
      ? {
          slug,
          myRole,
          asStaff,
          myUserId,
          otherOwners,
          ownersKnown: owners.isSuccess,
          /** Moves focus to the card heading once a removal has taken the acted-on row away, and `trigger`, when given, with it. */
          onRemoved: (trigger) => focus.focusAfter('heading', trigger),
          /** For the staff Remove dialog: whether closing it returns focus to its button, or leaves the move to `onRemoved`. */
          removalFinalFocus: () => focus.finalFocus(),
        }
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={focus.target('heading')} tabIndex={-1} className="outline-none">
            {title}
          </h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {card === null && (isRoleError || !isRolePending) ? (
          <LoadError message={ROLE_ERROR} onRetry={retry} />
        ) : card === null ? (
          <TableRowsSkeleton rows={4} columns={4} />
        ) : (
          <>
            {owners.isError && (
              <LoadError
                message="Owners could not be loaded."
                onRetry={() => void owners.refetch()}
              />
            )}
            <MembersCardScope value={card}>
              <DataTable
                columns={
                  asStaff && !canManageTenant(card.myRole) ? READ_ONLY_COLUMNS : MEMBER_COLUMNS
                }
                query={members}
                label={title}
                errorMessage={MEMBERS_ERROR}
                getRowId={(member) => member.membership.id}
                search={{
                  label: `Search ${title.toLowerCase()}`,
                  placeholder: 'Search by name or email',
                }}
                filters={[ROLE_FILTER]}
                card={(member) => (
                  <MemberCard key={member.membership.id} {...card} member={member} />
                )}
                empty={
                  <EmptyState
                    size="compact"
                    title="No one has access to this tenant yet."
                    description="An accepted invitation gives someone access."
                  />
                }
              />
            </MembersCardScope>
          </>
        )}
      </CardContent>
    </Card>
  )
}
