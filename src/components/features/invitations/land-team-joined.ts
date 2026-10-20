import { landJoined, type JoinedTenant } from '@/components/features/invitations/land-joined'
import { isPlatformTenant } from '@/lib/staff-team'
import { toast } from '@/lib/toast'

/**
 * `landJoined` with staff wording for the platform tenant, whose stored name
 * is internal: "You're now on the staff team. Signed in as {account}." Any
 * other tenant keeps the shared wording. Pass the server's address, never one
 * from the URL.
 * @param tenant - The tenant joined.
 * @param account - The signed-in address, from the server's answer or session.
 * @param alreadyMember - True when the caller had joined already.
 * @param open - Navigates to the landing for `tenant`, replacing the token page.
 */
export function landTeamJoined(
  tenant: JoinedTenant,
  account: string,
  alreadyMember: boolean,
  open: (tenant: JoinedTenant) => void
): void {
  if (!isPlatformTenant(tenant)) {
    landJoined(tenant, account, alreadyMember, open)
    return
  }
  toast.success(
    alreadyMember
      ? `You’re already on the staff team. Signed in as ${account}.`
      : `You’re now on the staff team. Signed in as ${account}.`
  )
  open(tenant)
}
