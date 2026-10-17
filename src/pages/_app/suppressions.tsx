import { IconMailOff } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { SuppressionsTable } from '@/components/features/suppressions/suppressions-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { toast } from '@/lib/toast'
import {
  suppressionsList,
  suppressionsListOptions,
  useLiftSuppression,
} from '@/queries/email.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { EmailSuppression } from '@/types/api.types'

/** The Suppressions page: addresses no email is sent to, with admins able to lift them. */
export const Route = createFileRoute('/_app/suppressions')({
  validateSearch: suppressionsList.schema,
  loaderDeps: ({ search }) => listRequest(suppressionsList, listValues(suppressionsList, search)),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(suppressionsListOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Suppressions') }] }),
  staticData: { crumb: 'Suppressions' },
  component: SuppressionsPage,
})

/**
 * Addresses that no email is sent to: each hard bounce or spam complaint
 * suppresses its address until staff lift it. Filtered and paged in the URL,
 * as on the Users page. Admins lift a suppression with a reason; the API's
 * own refusal (already lifted, a role that changed) shows in the dialog.
 */
function SuppressionsPage() {
  const role = useAuthStore((state) => state.user?.platformRole)
  const canLift = platformRoleAtLeast(role, 'admin')
  const focus = useFocusAfter<'heading' | `suppression:${string}`>()
  const opener = useRef<HTMLElement | null>(null)
  const list = useListSearch(suppressionsList)
  const query = useListQuery(list, suppressionsListOptions)
  const lift = useLiftSuppression()
  const [lifting, setLifting] = useState<EmailSuppression | null>(null)
  const openLift = useCallback((row: EmailSuppression, button: HTMLButtonElement) => {
    opener.current = button
    setLifting(row)
  }, [])

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1
        ref={focus.target('heading')}
        tabIndex={-1}
        className="text-2xl font-semibold outline-none"
      >
        Suppressions
      </h1>
      <SuppressionsTable
        query={query}
        errorMessage="We could not load the suppressions."
        onLift={canLift ? openLift : undefined}
        rowTarget={(id) => focus.target(`suppression:${id}`)}
        empty={
          <EmptyState
            icon={<IconMailOff aria-hidden="true" />}
            title="No suppressed addresses."
            description="An address is suppressed after a hard bounce or a spam complaint."
          />
        }
      />
      <ReasonDialog
        open={lifting !== null}
        onOpenChange={(open) => {
          if (!open) setLifting(null)
        }}
        title="Lift this suppression?"
        description={
          <>
            Emails to {lifting === null ? 'this address' : <Pii>{lifting.address}</Pii>} are sent
            again. Another hard bounce or complaint suppresses it again.
          </>
        }
        confirmLabel="Lift suppression"
        finalFocus={() => focus.finalFocus(opener.current, 'heading')}
        onConfirm={async (reason) => {
          if (lifting === null) return
          await lift.mutateAsync({ id: lifting.id, reason })
          focus.focusAfter([`suppression:${lifting.id}`, 'heading'], opener.current)
          toast.success(
            <>
              Suppression lifted for <Pii>{lifting.address}</Pii>.
            </>
          )
        }}
      />
    </div>
  )
}
