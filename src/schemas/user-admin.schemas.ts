import { z } from 'zod'
import { emailSchema } from '@/schemas/auth.schemas'
import { notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MAX_NAME_LENGTH = 100

/** An optional name part: blank sends nothing, as the API treats a missing name. */
const optionalName = z
  .string()
  .trim()
  .max(MAX_NAME_LENGTH)
  .refine(safeText(), notAllowedMessage('This field'))
  .transform((value) => (value === '' ? undefined : value))

/** `POST /platform/users`. Mirrors express's create-user validator. */
export const createUserSchema = z.object({
  email: emailSchema,
  firstName: optionalName,
  lastName: optionalName,
})

export type CreateUserInput = z.infer<typeof createUserSchema>

/** A name field on the staff edit form: blank means "clear it", which the API takes as `null`. */
const clearableName = z
  .string()
  .trim()
  .max(MAX_NAME_LENGTH)
  .refine(safeText(), notAllowedMessage('This field'))
  .transform((value) => (value === '' ? null : value))

/**
 * The staff Edit name form. Either field may be blank, so an account can hold
 * just a first name, or have one cleared.
 */
export const updateUserNameSchema = z.object({
  firstName: clearableName,
  lastName: clearableName,
})

/**
 * `PATCH /platform/users/:id`, mirroring express's updatePlatformUserSchema:
 * an absent field is left alone, `null` clears it, and at least one is sent.
 */
export interface UpdateUserNameInput {
  firstName?: string | null
  lastName?: string | null
}
