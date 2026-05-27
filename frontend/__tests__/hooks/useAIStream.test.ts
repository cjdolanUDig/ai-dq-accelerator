import { renderHook, act } from '@testing-library/react'
import { useAIStream } from '@/hooks/useAIStream'

class MockEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  close = jest.fn()
  constructor(public url: string) {}
}

let mockInstance: MockEventSource
global.EventSource = jest.fn().mockImplementation((url: string) => {
  mockInstance = new MockEventSource(url)
  return mockInstance
}) as any

it('accumulates events from the SSE stream', () => {
  const { result } = renderHook(() => useAIStream('sess1'))
  act(() => {
    mockInstance.onmessage?.({ data: '{"event":"tool_call","ts":1,"tool":"profile_dataset"}' } as MessageEvent)
  })
  expect(result.current.events).toHaveLength(1)
  expect(result.current.events[0]).toMatchObject({ event: 'tool_call', tool: 'profile_dataset' })
})

it('keeps accumulating after a done event (per-stage, not terminal)', () => {
  // A `done` marks the end of ONE stage (e.g. profiling). Later stages — rules,
  // validate, triage, plan, transform — still emit, so the stream must stay open.
  const { result } = renderHook(() => useAIStream('sess1'))
  act(() => {
    mockInstance.onmessage?.({ data: '{"event":"tool_call","ts":1,"tool":"a"}' } as MessageEvent)
    mockInstance.onmessage?.({ data: '{"event":"done"}' } as MessageEvent)
  })
  expect(result.current.isDone).toBe(true)
  act(() => {
    mockInstance.onmessage?.({ data: '{"event":"tool_call","ts":2,"tool":"plan_step"}' } as MessageEvent)
  })
  expect(result.current.events).toHaveLength(2)
  expect(result.current.events[1]).toMatchObject({ tool: 'plan_step' })
  expect(result.current.isDone).toBe(false)
  expect(mockInstance.close).not.toHaveBeenCalled()
})

it('does not open a connection when stopped', () => {
  ;(global.EventSource as jest.Mock).mockClear()
  renderHook(() => useAIStream('sess1', true))
  expect(global.EventSource).not.toHaveBeenCalled()
})
