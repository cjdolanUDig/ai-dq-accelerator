import { useState, useEffect } from 'react'
import { getAIStreamUrl } from '@/lib/api'

export interface AIEvent {
  event: string
  ts?: string | number
  [key: string]: unknown
}

/**
 * Stream AI activity events for a session.
 *
 * `stopped` should be set once the workflow is terminal (stage COMPLETE) so the
 * EventSource is closed. We do NOT close on a `done` event: `done` is emitted at
 * the end of EACH stage (profile, explore, rules, validate, triage, plan,
 * transform, ...), and closing on the first one killed the stream before later
 * stages — notably PLAN — ever emitted. The backend keeps the stream open across
 * stages (and EventSource auto-reconnects with Last-Event-ID across the
 * human-approval gaps), so later stages' activity still arrives.
 */
export function useAIStream(sessionId: string | null, stopped = false) {
  const [events, setEvents] = useState<AIEvent[]>([])
  const [isDone, setIsDone] = useState(false)

  useEffect(() => {
    if (!sessionId || stopped) return
    setEvents([])
    setIsDone(false)
    const es = new EventSource(getAIStreamUrl(sessionId))

    es.onmessage = (e) => {
      try {
        const parsed: AIEvent = JSON.parse(e.data)
        if (parsed.event === 'done') {
          // Per-stage completion — not terminal. Keep the stream open.
          setIsDone(true)
          return
        }
        setIsDone(false)
        setEvents(prev => [...prev, parsed])
      } catch {}
    }

    es.onerror = () => { /* allow EventSource auto-reconnect across stage gaps */ }

    return () => es.close()
  }, [sessionId, stopped])

  return { events, isDone }
}
