/**
 * @file A tenant's member list with role and removal controls, parameterised
 * by slug so the Staff page reuses it for the platform tenant. Its states: an
 * error per failed request, a skeleton, empty, cards on a phone, otherwise the table.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { ReasonDialog, STEP_UP_DISMISSED } from '@/components/features/reason-dialog'
import { Pii } from '@/components/shared/pii'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { useIsMobile } from '@/hooks/use-mobile'
import { useStepUp } from '@/hooks/use-step-up'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { isReauthRequired } from '@/lib/step-up'
import { noteError } from '@/observability/errors'
import {
  dropTenantCache,
  isMemberNotFound,
  useLeaveTenant,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/queries/tenant-writes.queries'
import {
  memberName,
  otherOwnerCount,
  useMembers,
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
 * platform-tenant membership, so leaving ends it; an auto-join domain brings
 * a verified address back as viewer at its next sign-in.
 */
const LEAVE_PLATFORM =
  'You lose staff access immediately. An owner or admin will have to invite you back, unless your address is on an auto-join domain: then you rejoin as a viewer at your next sign-in.'

/** Added on a customer tenant for an owner or admin, the roles that can have sent invitations: leaving revokes them. */
const INVITATIONS_REVOKED_ON_LEAVE = 'Pending invitations you sent are revoked.'

/** Added on the Staff page for an owner or admin: leaving staff also revokes, in each other tenant, what their membership there cannot grant, or everything where they have none. */
const PLATFORM_INVITATIONS_REVOKED_ON_LEAVE =
  'Pending invitations you sent here are revoked, and so are any you sent in other tenants for a role you can no longer grant there.'

/** What a leave says when the API answers 404: the membership was already gone. */
const NO_LONGER_A_MEMBER = 'You are no longer a member of this tenant.'

/** What a leave of the platform tenant says when the page could not move to Overview afterwards. */
const LEFT_BUT_STUCK = 'You left, but this page could not move on. Reload it to continue.'

/** What a role change or removal says when its member is already gone, in react's words. */
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
 * target this actor may touch. Removal uses a different pair (see `MemberRow`).
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
  /** The row's one last-owner explanation, which this cell renders. */
  reasonId: string
  /** Called when the change finds the member gone: the row, and this cell, are gone, so the card moves focus. */
  onGone: () => void
}) {
  const updateRole = useUpdateMemberRole(slug)
  const stepUp = useStepUp()
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
        toast.success(<Pii>{`${name} is now ${ROLE_LABELS[role]}.`}</Pii>)
      })

  return (
    <div className="grid gap-1">
      <Select
        value={targetRole}
        disabled={isLastOwner || updateRole.isPending}
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
          description={`${name} becomes ${pendingRole === null ? '' : ROLE_LABELS[pendingRole]} in this customer tenant.`}
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
}: {
  slug: string
  member: TenantMember
  /** Called after the removal, or when the member was already gone: the row, and this button, are gone, so the card moves focus. */
  onRemoved: () => void
}) {
  const removeMember = useRemoveMember(slug)
  const stepUp = useStepUp()
  const [isOpen, setIsOpen] = useState(false)
  const name = memberName(member)
  return (
    <>
      <Button
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
        description={`${name} will lose access to this tenant immediately. Pending invitations they sent are revoked.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async (reason) => {
          try {
            await stepUp.run(() => removeMember.mutateAsync({ userId: member.user.id, reason }))
          } catch (error) {
            unlessMemberGone(error, onRemoved)
            return
          }
          toast.success(<Pii>{`${name} removed.`}</Pii>)
          onRemoved()
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
  reasonId,
  onRemoved,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  isSelf: boolean
  isLastOwner: boolean
  /** The row's one last-owner explanation, rendered by `RoleCell`. */
  reasonId: string
  /** Called after someone else is removed or found already gone, or you leave a customer tenant: the row, and this button, are gone, so the card moves focus. */
  onRemoved: () => void
}) {
  const removeMember = useRemoveMember(slug)
  const leaveTenant = useLeaveTenant(slug)
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stepUpDismissed, setStepUpDismissed] = useState(false)
  const name = memberName(member)
  const isPending = isSelf ? leaveTenant.isPending : removeMember.isPending

  /**
   * Says so; from the platform tenant, leaves its routes and only then forgets
   * it. A navigation that fails is reported and said, and the cache is dropped
   * all the same: the tenant's routes answer 404 now, so the page still
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

  if (isLastOwner) {
    return (
      <Button variant="outline" size="sm" disabled aria-describedby={reasonId}>
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
        setStepUpDismissed(false)
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
            {isSelf ? 'Leave this tenant?' : <Pii>{`Remove ${name}?`}</Pii>}
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
                <Pii>
                  {name} loses staff access immediately. Pending invitations they sent here are
                  revoked, and so are any they sent in other tenants for a role they can no longer
                  grant there. If their address is on an auto-join domain (PLATFORM_EMAIL_DOMAINS),
                  they rejoin as a viewer at their next sign-in: deactivate their account from Users
                  to offboard them.
                </Pii>{' '}
                <Link
                  to={ROUTES.user}
                  params={{ userId: member.user.id }}
                  className="underline underline-offset-4"
                >
                  <Pii>{`Open ${name} in Users`}</Pii>
                </Link>
              </>
            ) : (
              <Pii>{`${name} will lose access to this tenant immediately. Pending invitations they sent are revoked.`}</Pii>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {stepUpDismissed && (
          <p role="alert" className="text-sm text-destructive">
            {STEP_UP_DISMISSED}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setStepUpDismissed(false)
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
                    toast.success(<Pii>{`${name} removed.`}</Pii>)
                    onRemoved()
                  },
                  (error: unknown) => {
                    setBusy(false)
                    if (isReauthRequired(error)) {
                      setStepUpDismissed(true)
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
            {isSelf ? 'Leave' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * One member, as a table row or, with `asCard`, a stacked card. Removing
 * someone else needs `canManageTenant` (owner or admin, as the DELETE members
 * route requires) and `modifyRule(slug)`, a different pair from the
 * role-change gate in `RoleCell`; a member's own row always offers Leave.
 * `reasonId` is one id per row: the last-owner explanation renders once, in
 * the role cell, and every control the guard disables points at it. Staff
 * acting through platform access (`asStaff`) get the reason-dialog Remove
 * instead, and no Leave: they hold no membership there to leave.
 */
function MemberRow({
  slug,
  member,
  myRole,
  asStaff,
  myUserId,
  otherOwners,
  onRemoved,
  asCard = false,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  /** Acting through platform access (`access: 'platform'`): every change asks for a reason. */
  asStaff: boolean
  myUserId: string | undefined
  /** The owners besides the signed-in user that the API counts (`otherOwnerCount`). */
  otherOwners: number
  onRemoved: () => void
  /**
   * Render a stacked card instead of a table row, for phones, where the
   * scrolling table puts the Actions column off-screen.
   */
  asCard?: boolean
}) {
  const targetRole = member.membership.role
  const isSelf = member.user.id === myUserId
  const isLastOwner = isLastOwnerBlocked({ targetRole, isSelf, otherOwners })
  const canLeave = isSelf && !asStaff
  const canRemove =
    canLeave || (canManageTenant(myRole) && modifyRule(slug)(myRole, targetRole, isSelf))
  const reasonId = `last-owner-${member.membership.id}`

  const role = (
    <RoleCell
      slug={slug}
      member={member}
      myRole={myRole}
      asStaff={asStaff}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      reasonId={reasonId}
      onGone={onRemoved}
    />
  )
  const remove = !canRemove ? null : asStaff ? (
    <StaffRemoveMemberButton slug={slug} member={member} onRemoved={onRemoved} />
  ) : (
    <RemoveMemberButton
      slug={slug}
      member={member}
      myRole={myRole}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      reasonId={reasonId}
      onRemoved={onRemoved}
    />
  )

  if (asCard) {
    return (
      <li className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-0.5">
          <span className="font-medium">
            <Pii>{memberName(member)}</Pii>
            {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
          </span>
          <Pii className="text-sm break-all text-muted-foreground">{member.user.email}</Pii>
        </div>
        {role}
        {remove && <div>{remove}</div>}
      </li>
    )
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Pii>{memberName(member)}</Pii>
        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
      </TableCell>
      <TableCell>
        <Pii>{member.user.email}</Pii>
      </TableCell>
      <TableCell>{role}</TableCell>
      <TableCell className="text-right">{remove}</TableCell>
    </TableRow>
  )
}

/**
 * A tenant's members. Its states, in order:
 *
 * - An error, or no role: the member list and the role lookup are independent
 *   queries that can fail alone, so each failure shows its own `LoadError`
 *   retrying its own request; when both fail, both render. A failed request
 *   never shows a skeleton, which would wait forever with no retry.
 * - A skeleton while either query is pending.
 * - The empty message, only after the error branch, because a failed load and
 *   an empty tenant both give `[]`.
 * - Cards on a phone, because the scrolling table puts the Actions column and
 *   the last-owner explanation off-screen; otherwise the table. The layout is
 *   picked in JS with `useIsMobile`, the hook the sidebar uses, because
 *   rendering both layouts and hiding one with CSS would put two role selects
 *   per member and two elements with one `reasonId` in the DOM. The table is
 *   `min-w-2xl`, so the vendored Table's `overflow-x-auto` wrapper scrolls
 *   instead of crushing four columns.
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
  const members = useMembers(slug, tenantId)
  const {
    role: myRole,
    access,
    isPending: isRolePending,
    isError: isRoleError,
    retry,
  } = useMyRole(slug, tenantId)
  const asStaff = access === 'platform'
  const myUserId = useAuthStore((state) => state.user?.id)
  const otherOwners = otherOwnerCount(members.data, myUserId, slug === PLATFORM_TENANT_SLUG)
  const isMobile = useIsMobile()
  const focus = useFocusAfter<'heading'>()
  const focusHeading = () => focus.focusAfter('heading')

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
      <CardContent>
        {members.isError || isRoleError || (!isRolePending && !myRole) ? (
          <div className="grid gap-3">
            {members.isError && (
              <LoadError message={MEMBERS_ERROR} onRetry={() => void members.refetch()} />
            )}
            {(isRoleError || (!isRolePending && !myRole)) && (
              <LoadError message={ROLE_ERROR} onRetry={retry} />
            )}
          </div>
        ) : members.isPending || isRolePending || !myRole ? (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (members.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one has access to this tenant yet. An accepted invitation gives someone access.
          </p>
        ) : isMobile ? (
          <ul className="grid gap-3">
            {(members.data ?? []).map((member) => (
              <MemberRow
                key={member.membership.id}
                asCard
                slug={slug}
                member={member}
                myRole={myRole}
                asStaff={asStaff}
                myUserId={myUserId}
                otherOwners={otherOwners}
                onRemoved={focusHeading}
              />
            ))}
          </ul>
        ) : (
          <Table className="min-w-2xl">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members.data ?? []).map((member) => (
                <MemberRow
                  key={member.membership.id}
                  slug={slug}
                  member={member}
                  myRole={myRole}
                  asStaff={asStaff}
                  myUserId={myUserId}
                  otherOwners={otherOwners}
                  onRemoved={focusHeading}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
