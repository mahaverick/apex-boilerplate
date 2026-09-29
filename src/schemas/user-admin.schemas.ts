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

/** `PATCH /platform/users/:id`: the two name fields, as on the profile page. */
export { updateProfileSchema as updateUserNameSchema } from '@/schemas/profile.schemas'
export type { UpdateProfileInput as UpdateUserNameInput } from '@/schemas/profile.schemas'
