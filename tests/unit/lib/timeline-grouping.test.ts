import { describe, expect, it } from 'vitest'
import { countEvents, groupTimeline, replayHref, sessionDuration } from '@/lib/timeline-grouping'
import {
  at,
  eventId,
  SESSION_ID,
  SESSION_ID_2,
  timelineRow,
  TRACE_ID,
  TRACE_ID_2,
} from '@/tests/fixtures/timeline'
import type { TimelineRow } from '@/types/api.types'

/** A server row of `trace` in `session`, as express sends a request's events. */
function server(n: number, trace: string | null, session: string | null = SESSION_ID): TimelineRow {
  return timelineRow({
    uuid: eventId(n),
    event: 'user_signed_in',
    timestamp: at(100 - n),
    verified: true,
    source: 'product',
    app: 'api',
    sessionId: session,
    traceId: trace,
    path: null,
  })
}

/** A browser row in `session`. */
function browser(n: number, session: string | null = SESSION_ID): TimelineRow {
  return timelineRow({ uuid: eventId(n), timestamp: at(100 - n), sessionId: session })
}

describe('groupTimeline', () => {
  it('groups consecutive rows of one session into a block, newest first', () => {
    const rows = [browser(1), browser(2), browser(3, SESSION_ID_2)]
    const items = groupTimeline(rows)
    expect(items).toEqual([
      {
        kind: 'session',
        sessionId: SESSION_ID,
        app: 'react',
        startedAt: at(98),
        endedAt: at(99),
        items: [
          { kind: 'event', row: rows[0] },
          { kind: 'event', row: rows[1] },
        ],
      },
      {
        kind: 'session',
        sessionId: SESSION_ID_2,
        app: 'react',
        startedAt: at(97),
        endedAt: at(97),
        items: [{ kind: 'event', row: rows[2] }],
      },
    ])
  })

  it('leaves rows without a session standing alone between blocks', () => {
    const email = timelineRow({
      uuid: eventId(2),
      event: 'email_delivered',
      verified: true,
      source: 'email',
      app: 'api',
      sessionId: null,
    })
    const items = groupTimeline([browser(1), email, browser(3)])
    expect(items.map((item) => item.kind)).toEqual(['session', 'event', 'session'])
    expect(items[1]).toEqual({ kind: 'event', row: email })
  })

  it('collapses consecutive server rows sharing a trace into one request, inside a block', () => {
    const rows = [server(1, TRACE_ID), server(2, TRACE_ID), server(3, TRACE_ID), browser(4)]
    const [block] = groupTimeline(rows)
    expect(block?.kind === 'session' && block.items).toEqual([
      { kind: 'request', traceId: TRACE_ID, rows: rows.slice(0, 3) },
      { kind: 'event', row: rows[3] },
    ])
  })

  it('collapses standalone server rows sharing a trace too', () => {
    const rows = [server(1, TRACE_ID, null), server(2, TRACE_ID, null), server(3, TRACE_ID_2, null)]
    expect(groupTimeline(rows)).toEqual([
      { kind: 'request', traceId: TRACE_ID, rows: rows.slice(0, 2) },
      { kind: 'event', row: rows[2] },
    ])
  })

  it('keeps a trace seen once as an event, and a trace with no id unsplit', () => {
    const rows = [server(1, TRACE_ID, null), server(2, null, null), server(3, null, null)]
    expect(groupTimeline(rows)).toEqual(rows.map((row) => ({ kind: 'event', row })))
  })

  it('never collapses browser rows by trace, even when they carry one', () => {
    const rows = [
      timelineRow({ uuid: eventId(1), traceId: TRACE_ID }),
      timelineRow({ uuid: eventId(2), traceId: TRACE_ID }),
    ]
    const [block] = groupTimeline(rows)
    expect(block?.kind === 'session' && block.items.map((entry) => entry.kind)).toEqual([
      'event',
      'event',
    ])
  })

  it('never collapses a row express did not sign, even one claiming a server source and a real trace', () => {
    const forged = timelineRow({
      uuid: eventId(2),
      source: 'product',
      verified: false,
      traceId: TRACE_ID,
      timestamp: at(98),
    })
    const rows = [server(1, TRACE_ID), forged, server(3, TRACE_ID)]
    const [block] = groupTimeline(rows)
    expect(block?.kind === 'session' && block.items).toEqual(
      rows.map((row) => ({ kind: 'event', row }))
    )
    const pair = [forged, { ...forged, uuid: eventId(4) }]
    expect(groupTimeline(pair.map((row) => ({ ...row, sessionId: null })))).toHaveLength(2)
  })

  it('splits a request where a browser row comes between its server rows', () => {
    const rows = [server(1, TRACE_ID), browser(2), server(3, TRACE_ID)]
    const [block] = groupTimeline(rows)
    expect(block?.kind === 'session' && block.items.map((entry) => entry.kind)).toEqual([
      'event',
      'event',
      'event',
    ])
  })

  it('merges a session cut by a page boundary once the next page is loaded', () => {
    const first = [browser(1), browser(2)]
    const second = [browser(3), browser(4, SESSION_ID_2)]
    expect(groupTimeline(first)).toHaveLength(1)
    const merged = groupTimeline([...first, ...second])
    expect(merged.map((item) => item.kind === 'session' && item.sessionId)).toEqual([
      SESSION_ID,
      SESSION_ID_2,
    ])
    const [block] = merged
    expect(block?.kind === 'session' && [block.startedAt, block.endedAt]).toEqual([at(97), at(99)])
    expect(block?.kind === 'session' && countEvents(block.items)).toBe(3)
  })

  it('merges a request cut by a page boundary the same way', () => {
    const merged = groupTimeline([server(1, TRACE_ID), server(2, TRACE_ID), server(3, TRACE_ID)])
    const [block] = merged
    expect(block?.kind === 'session' && block.items).toHaveLength(1)
    expect(block?.kind === 'session' && countEvents(block.items)).toBe(3)
  })

  it('names the app from the block’s browser rows, never from express’s', () => {
    const apex = timelineRow({ uuid: eventId(2), app: 'apex' })
    expect(groupTimeline([server(1, TRACE_ID), apex])[0]).toMatchObject({ app: 'apex' })
    expect(groupTimeline([server(1, TRACE_ID), server(2, TRACE_ID)])[0]).toMatchObject({
      app: null,
    })
  })

  it('returns nothing for no rows', () => {
    expect(groupTimeline([])).toEqual([])
  })
})

describe('replayHref', () => {
  it('fills the session id into the API’s template', () => {
    expect(replayHref('https://us.posthog.com/project/1/replay/{sessionId}', SESSION_ID)).toBe(
      `https://us.posthog.com/project/1/replay/${SESSION_ID}`
    )
  })

  it('escapes a session id that is not URL-safe', () => {
    expect(replayHref('https://x.test/replay/{sessionId}', 'a/b?c')).toBe(
      'https://x.test/replay/a%2Fb%3Fc'
    )
  })
})

describe('sessionDuration', () => {
  it.each([
    [at(0), at(0), '0 s'],
    [at(0), at(45), '45 s'],
    [at(0), at(12 * 60 + 10), '12 min'],
    [at(0), at(59 * 60 + 50), '1 h'],
    ['2026-10-04T09:00:00.000000Z', '2026-10-04T10:05:00.000000Z', '1 h 5 min'],
    [at(0), 'not a time', 'unknown length'],
  ])('measures %s to %s as %s', (start, end, length) => {
    expect(sessionDuration(start, end)).toBe(length)
  })
})
