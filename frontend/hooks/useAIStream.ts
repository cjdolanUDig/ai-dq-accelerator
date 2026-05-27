import { useState, useEffect } from 'react'
import { getAIStreamUrl } from '@/lib/api'

export interface AIEvent {
  event: string
  ts?: string | number
  [key: string]: unknown
}

export function useAIStream(sessionId: string | null) {
  const [events, setEvents] = useState<AIEvent[]>([])
  const [isDone, setIsDone] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    setEvents([])
    setIsDone(false)
    const es = new EventSource(getAIStreamUrl(sessionId))
    let done = false

    es.onmessage = (e) => {
      if (done) return
      try {
        const parsed: AIEvent = JSON.parse(e.data)
        if (parsed.event === 'done') {
          done = true
          setIsDone(true)
          es.close()
          return
        }
        setEvents(prev => [...prev, parsed])
      } catch {}
    }

    es.onerror = () => { /* allow EventSource auto-reconnect */ }

    return () => es.close()
  }, [sessionId])

  return { events, isDone }
}
