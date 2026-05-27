import { renderHook, waitFor } from '@testing-library/react'
import { useSession } from '@/hooks/useSession'

const mockFetch = jest.fn()
global.fetch = mockFetch

const baseState = { session_id: 'abc', profile: {}, ai_summary: '', suggested_rules: [], baseline_quality_score: 0, current_score: 0, validation_summary: '', anomaly_summary: '', transformation_log: [], scorecard: {}, narrative: '', output_dir: '', zip_path: '' }

beforeEach(() => mockFetch.mockReset())

it('returns session state after fetch', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ...baseState, stage: 'PROFILING' }) })

  const { result } = renderHook(() => useSession('abc'))
  await waitFor(() => expect(result.current.session?.stage).toBe('PROFILING'))
})

it('stops polling once the session is COMPLETE', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ...baseState, stage: 'COMPLETE' }) })

  const { result } = renderHook(() => useSession('sess-complete'))
  await waitFor(() => expect(result.current.session?.stage).toBe('COMPLETE'))

  const callsAfterLoad = mockFetch.mock.calls.length
  // Wait past the 2s poll interval — a COMPLETE session must not re-poll.
  await new Promise((r) => setTimeout(r, 2500))
  expect(mockFetch.mock.calls.length).toBe(callsAfterLoad)
})
