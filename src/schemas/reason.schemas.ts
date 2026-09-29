/**
 * @file The `reason` every destructive or state-changing staff action
 * carries, mirroring express's `reasonSchema` (platform.validators.ts):
 * trimmed, 1–500 characters, multi-line safe text (`\n` and `\t` allowed). It
 * is stored in the audit log. A textarea's value never holds `\r\n` (the DOM
 * normalises line breaks to `\n`), and the API normalises any that arrive.
 */
import { z } from 'zod'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

export const MAX_REASON_LENGTH = 500

export const reasonSchema = z
  .string()
  .trim()
  .min(1, 'Enter a reason.')
  .max(MAX_REASON_LENGTH, `Reason must be at most ${MAX_REASON_LENGTH} characters.`)
  .refine(safeText({ multiline: true }), notAllowedMessage('Reason'))

/**
 * The reason dialog's form. With `confirmText`, the user must also type that
 * value (a slug or an email) exactly; without it, `confirmation` is ignored.
 */
export function reasonFormSchema(confirmText?: string) {
  return z
    .object({ reason: reasonSchema, confirmation: z.string() })
    .refine((value) => confirmText === undefined || value.confirmation.trim() === confirmText, {
      path: ['confirmation'],
      message: `Type ${confirmText ?? ''} exactly to confirm.`,
    })
}
