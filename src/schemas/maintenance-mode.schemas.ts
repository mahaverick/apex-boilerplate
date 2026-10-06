/**
 * @file The maintenance-mode change form, mirroring express's
 * `changeMaintenanceModeBody`: the customer message is trimmed, 1–500
 * characters of multi-line safe text; the reason is the same, required only
 * when switching on or escalating, which also needs the API's environment
 * typed exactly.
 */
import { z } from 'zod'
import { MAINTENANCE_TEXT_MAX_LENGTH } from '@/constants/maintenance-mode.constants'
import { isSwitchOn } from '@/lib/maintenance-mode'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'
import type { MaintenanceMode } from '@/types/api.types'

export const maintenanceMessageSchema = z
  .string()
  .trim()
  .min(1, 'Enter the message customers will see.')
  .max(
    MAINTENANCE_TEXT_MAX_LENGTH,
    `Message must be at most ${MAINTENANCE_TEXT_MAX_LENGTH} characters.`
  )
  .refine(safeText({ multiline: true }), notAllowedMessage('Message'))

/** Empty is allowed here; `maintenanceModeFormSchema` requires it for a switch-on. */
const optionalReasonSchema = z
  .string()
  .trim()
  .max(
    MAINTENANCE_TEXT_MAX_LENGTH,
    `Reason must be at most ${MAINTENANCE_TEXT_MAX_LENGTH} characters.`
  )
  .refine(safeText({ multiline: true }), notAllowedMessage('Reason'))

/**
 * The change dialog's form, for a change away from `from`.
 * @param from - The mode now.
 * @param environment - The API's `APP_ENV`, from the platform GET.
 * @returns A schema that needs a reason and `environment` typed when the
 *   chosen mode switches on or escalates, and neither otherwise.
 */
export function maintenanceModeFormSchema(from: MaintenanceMode, environment: string) {
  return z
    .object({
      mode: z.enum(['read_only', 'full']),
      message: maintenanceMessageSchema,
      reason: optionalReasonSchema,
      confirmation: z.string(),
    })
    .superRefine((value, ctx) => {
      if (!isSwitchOn(from, value.mode)) return
      if (value.reason === '') {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Enter a reason.' })
      }
      if (value.confirmation.trim() !== environment) {
        ctx.addIssue({
          code: 'custom',
          path: ['confirmation'],
          message: `Type ${environment} exactly to confirm.`,
        })
      }
    })
}

export type MaintenanceModeFormValues = z.input<ReturnType<typeof maintenanceModeFormSchema>>
