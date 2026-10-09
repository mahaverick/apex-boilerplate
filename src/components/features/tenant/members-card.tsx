/**
 * @file A tenant's member list with role and removal controls, parameterised
 * by slug so the Staff page reuses it for the platform tenant. Its states: an
 * error per failed request, a skeleton, empty, cards on a phone, otherwise the table.
 */
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { STEP_UP_DISMISSED } from '@/components/features/reason-dialog'
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
import { messageFrom } from '@/lib/api-error'
import { isReauthRequired } from '@/lib/step-up'
import {
  memberName,
  ownerCount,
  useMembers,
  useMyRole,
  useRemoveMember,
  useUpdateMemberRole,
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
 * renders when it is needed.
 */
function RoleCell({
  slug,
  member,
  myRole,
  isSelf,
  isLastOwner,
  reasonId,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  isSelf: boolean
  isLastOwner: boolean
  /** The row's one last-owner explanation, which this cell renders. */
  reasonId: string
}) {
  const updateRole = useUpdateMemberRole(slug)
  const stepUp = useStepUp()
  const targetRole = member.membership.role
  const name = memberName(member)

  if (!canChangeRoles(myRole) || !modifyRule(slug)(myRole, targetRole, isSelf)) {
    return <span>{ROLE_LABELS[targetRole]}</span>
  }

  return (
    <div className="grid gap-1">
      <Select
        value={targetRole}
        disabled={isLastOwner || updateRole.isPending}
        onValueChange={(value: string | null) => {
          if (value === null || value === targetRole) return
          stepUp
            .run(() =>
              updateRole.mutateAsync({ userId: member.user.id, role: value as MembershipRole })
            )
            .then(
              () =>
                toast.success(
                  <Pii>{`${name} is now ${ROLE_LABELS[value as MembershipRole]}.`}</Pii>
                ),
              (error: unknown) => toast.error(messageFrom(error))
            )
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
    </div>
  )
}

/**
 * The Remove control, or Leave on your own row, behind a confirm dialog. For
 * the last owner it is a disabled Leave button described by the row's
 * explanation in `RoleCell` (`isLastOwner` implies `isSelf`). After leaving,
 * the page navigates away, because the tenant's routes answer 404 to a caller
 * with neither a membership nor a platform role: to Overview from the platform
 * tenant, to the Tenants list from any other. A dismissed step-up removes no
 * one, so the dialog stays open and says so, ready to be confirmed again.
 */
function RemoveMemberButton({
  slug,
  member,
  isSelf,
  isLastOwner,
  reasonId,
  onRemoved,
}: {
  slug: string
  member: TenantMember
  isSelf: boolean
  isLastOwner: boolean
  /** The row's one last-owner explanation, rendered by `RoleCell`. */
  reasonId: string
  /** Called after someone else is removed: their row, and this button, are gone, so the card moves focus. */
  onRemoved: () => void
}) {
  const removeMember = useRemoveMember(slug)
  const stepUp = useStepUp()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stepUpDismissed, setStepUpDismissed] = useState(false)
  const name = memberName(member)

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
          <Button variant="outline" size="sm" disabled={removeMember.isPending}>
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
              'You will lose access to this tenant immediately. An owner or admin will have to invite you back.'
            ) : slug === PLATFORM_TENANT_SLUG ? (
              <>
                <Pii>
                  {name} loses staff access immediately. Pending invitations they sent here are
                  revoked, and so are any they sent in other tenants for a role their membership
                  there cannot grant. If their address is on an auto-join domain
                  (PLATFORM_EMAIL_DOMAINS), they rejoin as a viewer at their next sign-in:
                  deactivate their account from Users to offboard them.
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
                .run(() => removeMember.mutateAsync(member.user.id))
                .then(
                  () => {
                    setBusy(false)
                    setIsOpen(false)
                    toast.success(
                      isSelf ? 'You left this tenant.' : <Pii>{`${name} removed.`}</Pii>
                    )
                    if (!isSelf) onRemoved()
                    // Leaving the platform tenant ends staff access; Overview's guard then shows /no-access.
                    if (isSelf) {
                      void navigate({
                        to: slug === PLATFORM_TENANT_SLUG ? ROUTES.overview : ROUTES.tenants,
                      })
                    }
                  },
                  (error: unknown) => {
                    setBusy(false)
                    if (isReauthRequired(error)) {
                      setStepUpDismissed(true)
                      return
                    }
                    setIsOpen(false)
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
 * One member, as a table row or, with `asCard`, a stacked card. Removal needs
 * `canManageTenant` (owner or admin, as the DELETE members route requires)
 * and `modifyRule(slug)`, a different pair from the role-change gate in
 * `RoleCell`. `reasonId` is one id per row: the last-owner explanation renders
 * once, in the role cell, and every control the guard disables points at it.
 */
function MemberRow({
  slug,
  member,
  myRole,
  myUserId,
  owners,
  onRemoved,
  asCard = false,
}: {
  slug: string
  member: TenantMember
  myRole: MembershipRole
  myUserId: string | undefined
  owners: number
  onRemoved: () => void
  /**
   * Render a stacked card instead of a table row, for phones, where the
   * scrolling table puts the Actions column off-screen.
   */
  asCard?: boolean
}) {
  const targetRole = member.membership.role
  const isSelf = member.user.id === myUserId
  const isLastOwner = isLastOwnerBlocked({ targetRole, isSelf, ownerCount: owners })
  const canRemove = canManageTenant(myRole) && modifyRule(slug)(myRole, targetRole, isSelf)
  const reasonId = `last-owner-${member.membership.id}`

  const role = (
    <RoleCell
      slug={slug}
      member={member}
      myRole={myRole}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      reasonId={reasonId}
    />
  )
  const remove = canRemove ? (
    <RemoveMemberButton
      slug={slug}
      member={member}
      isSelf={isSelf}
      isLastOwner={isLastOwner}
      reasonId={reasonId}
      onRemoved={onRemoved}
    />
  ) : null

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
    isPending: isRolePending,
    isError: isRoleError,
    retry,
  } = useMyRole(slug, tenantId)
  const myUserId = useAuthStore((state) => state.user?.id)
  const owners = ownerCount(members.data)
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
                myUserId={myUserId}
                owners={owners}
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
                  myUserId={myUserId}
                  owners={owners}
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
