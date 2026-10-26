import { describe, expect, it } from 'vite-plus/test'
import {
  AUDIT_TARGET_LABELS,
  auditTargetLabel,
} from '@/components/features/activity/activity-filters'

describe('auditTargetLabel', () => {
  it('labels the plan and billing targets express writes', () => {
    expect(AUDIT_TARGET_LABELS).toMatchObject({ plan: 'Plan', billing: 'Billing' })
  })

  it('words a target kind it has no label for', () => {
    expect(auditTargetLabel('billing_plan')).toBe('Billing plan')
  })
})
