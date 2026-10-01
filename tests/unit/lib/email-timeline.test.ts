import { describe, expect, it } from 'vitest'
import { buildEmailTimeline } from '@/lib/email-timeline'
import {
  EMAIL_ATTEMPT_ID,
  EMAIL_ATTEMPT_ID_2,
  EMAIL_EVENT_ID,
  EMAIL_EVENT_ID_2,
  EMAIL_ID_2,
  EMAIL_ID_3,
} from '@/tests/fixtures/ids'
import { emailDetail } from '@/tests/mocks/handlers'

const at = (seconds: number) => `2026-09-29T10:00:${String(seconds).padStart(2, '0')}.000Z`

describe('buildEmailTimeline', () => {
  it('merges attempts and events by time, whatever order the API lists them in', () => {
    const detail = emailDetail({
      createdAt: at(0),
      attempts: [
        { id: EMAIL_ATTEMPT_ID_2, status: 'sent', errorCode: null, createdAt: at(30) },
        { id: EMAIL_ATTEMPT_ID, status: 'failed', errorCode: 'ECONNECTION', createdAt: at(10) },
      ],
      events: [
        {
          id: EMAIL_EVENT_ID_2,
          provider: 'resend',
          type: 'opened',
          bounceKind: null,
          detail: null,
          occurredAt: at(50),
        },
        {
          id: EMAIL_EVENT_ID,
          provider: 'resend',
          type: 'delivered',
          bounceKind: null,
          detail: null,
          occurredAt: at(40),
        },
      ],
    })
    expect(buildEmailTimeline(detail).map((entry) => entry.key)).toEqual([
      'queued',
      `attempt-${EMAIL_ATTEMPT_ID}`,
      `attempt-${EMAIL_ATTEMPT_ID_2}`,
      `event-${EMAIL_EVENT_ID}`,
      `event-${EMAIL_EVENT_ID_2}`,
    ])
  })

  it('keeps Queued first even when a provider clock runs behind ours', () => {
    const detail = emailDetail({
      createdAt: at(20),
      attempts: [],
      events: [
        {
          id: EMAIL_EVENT_ID,
          provider: 'resend',
          type: 'delivered',
          bounceKind: null,
          detail: null,
          occurredAt: at(5),
        },
      ],
    })
    expect(buildEmailTimeline(detail).map((entry) => entry.kind)).toEqual(['queued', 'event'])
  })

  it('puts an attempt before an event at the same instant', () => {
    const detail = emailDetail({
      createdAt: at(0),
      attempts: [{ id: EMAIL_ATTEMPT_ID, status: 'sent', errorCode: null, createdAt: at(9) }],
      events: [
        {
          id: EMAIL_EVENT_ID,
          provider: 'resend',
          type: 'delivered',
          bounceKind: null,
          detail: null,
          occurredAt: at(9),
        },
      ],
    })
    expect(buildEmailTimeline(detail).map((entry) => entry.kind)).toEqual([
      'queued',
      'attempt',
      'event',
    ])
  })

  it('opens with the message this one resent and closes with the ones that resent it', () => {
    const detail = emailDetail({
      createdAt: at(0),
      resentFromId: EMAIL_ID_2,
      resentAsIds: [EMAIL_ID_3],
    })
    const entries = buildEmailTimeline(detail)
    expect(entries.map((entry) => entry.kind)).toEqual([
      'queued',
      'resent-from',
      'attempt',
      'event',
      'resent-as',
    ])
    expect(entries[1]).toMatchObject({ messageId: EMAIL_ID_2, at: at(0) })
    expect(entries.at(-1)).toMatchObject({ messageId: EMAIL_ID_3 })
  })

  it('shows a mail the queue refused as Queued alone', () => {
    expect(
      buildEmailTimeline(emailDetail({ attempts: [], events: [] })).map((entry) => entry.kind)
    ).toEqual(['queued'])
  })
})
