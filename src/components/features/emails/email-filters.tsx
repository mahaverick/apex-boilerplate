import { TenantFilterChip, UserFilterChip } from '@/components/features/emails/email-filter-chips'
import type { DataTableFilter } from '@/components/shared/data-table/data-table-model'
import { EMAIL_STATUS_BADGE, EMAIL_TEMPLATES } from '@/constants/email.constants'
import {
  EMAIL_MESSAGE_STATUSES,
  EMAIL_TEMPLATE_KEYS,
  type EmailMessageSummary,
} from '@/types/api.types'

/** The Status and Template facets every Emails list has; a tenant's tab uses just these. */
export const EMAIL_FACETS: readonly DataTableFilter[] = [
  {
    name: 'status',
    label: 'Status',
    options: EMAIL_MESSAGE_STATUSES.map((status) => ({
      value: status,
      label: EMAIL_STATUS_BADGE[status].label,
    })),
  },
  {
    name: 'template',
    label: 'Template',
    options: EMAIL_TEMPLATE_KEYS.map((key) => ({ value: key, label: EMAIL_TEMPLATES[key].label })),
  },
]

/**
 * The facets of the Emails page: Status and Template, and the user and tenant
 * a link from their page sets, which show as chips only. A chip names its
 * record from the listed rows when any carries it, else from the record.
 * @param items - The page's rows, which can name the filtered user or tenant.
 */
export function emailFilters(items: readonly EmailMessageSummary[]): readonly DataTableFilter[] {
  return [
    ...EMAIL_FACETS,
    {
      name: 'user',
      label: 'User',
      options: [],
      chipOnly: true,
      isPersonal: true,
      renderChip: (value, onRemove) => (
        <UserFilterChip
          userId={value}
          knownName={items.find((row) => row.user?.id === value)?.user?.name}
          onRemove={onRemove}
        />
      ),
    },
    {
      name: 'tenant',
      label: 'Tenant',
      options: [],
      chipOnly: true,
      renderChip: (value, onRemove) => (
        <TenantFilterChip
          tenantId={value}
          knownName={items.find((row) => row.tenant?.id === value)?.tenant?.name}
          onRemove={onRemove}
        />
      ),
    },
  ]
}
