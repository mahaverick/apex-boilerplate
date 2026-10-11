/**
 * @file The flags pages' URL search params: who to evaluate. A malformed
 * value is dropped rather than failing the page. Route configs load with the
 * first visit, so this file imports nothing of the pages' own.
 */
import { z } from 'zod'
import type { FlagApp } from '@/types/api.types'

/** The apps the evaluate form offers, in toggle order. */
export const FLAG_EVALUATE_APPS = ['react', 'apex'] as const satisfies readonly FlagApp[]

/** A record id; express validates these as UUIDs, so anything else is no choice. */
const id = z.uuid().optional().catch(undefined)

/** `/flags` search: the user, their tenant and the app to evaluate; the app defaults to the customer app. */
export const flagsSearchSchema = z.object({
  userId: id,
  tenantId: id,
  app: z.enum(FLAG_EVALUATE_APPS).default('react').catch('react'),
})

/** A tenant's Flags tab search: the member to evaluate in that tenant. */
export const tenantFlagsSearchSchema = z.object({ userId: id })
