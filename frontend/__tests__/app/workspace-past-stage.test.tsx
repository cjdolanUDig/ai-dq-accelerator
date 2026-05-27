import { render, screen, fireEvent } from '@testing-library/react'
import WorkspacePage from '@/app/sessions/[id]/page'

// useParams -> fixed session id
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sess-1' }),
}))

// Mirror the REAL useSession behavior: when disabled (enabled:false) the SWR key
// is null, so `session` is undefined. This is what makes the past-stage feedback
// loop reproducible — if the page disables the poll while viewing a past stage,
// `session` vanishes, `active` collapses to 'load', and the reset effect fires.
const MOCK_SESSION = { session_id: 'sess-1', stage: 'AWAITING_TRIAGE_APPROVAL' }
jest.mock('@/hooks/useSession', () => ({
  useSession: (_id: string, opts: { enabled?: boolean } = {}) => {
    const enabled = opts.enabled ?? true
    return { session: enabled ? MOCK_SESSION : undefined, isLoading: false, error: null, refresh: jest.fn() }
  },
}))
jest.mock('@/hooks/useAIStream', () => ({ useAIStream: () => ({ events: [], isDone: false }) }))
jest.mock('@/hooks/useSessionsList', () => ({ useSessionsList: () => ({ sessions: [] }) }))

// Stub the stage components that actually render so the test doesn't hit their
// internals/network. TriageStage renders for the active stage; SnapshotStageView
// renders for a viewed past stage.
jest.mock('@/components/stages/TriageStage', () => ({ TriageStage: () => <div data-testid="triage-live" /> }))
jest.mock('@/components/stages/SnapshotStageView', () => ({
  SnapshotStageView: ({ stage }: { stage: string }) => <div data-testid="snapshot">snapshot:{stage}</div>,
}))
// CodeBlock pulls in react-syntax-highlighter (ESM-only refractor) which jest
// can't transform; stub it so importing the page's stage graph doesn't crash.
jest.mock('@/components/stages/CodeBlock', () => ({ CodeBlock: () => <div /> }))

describe('WorkspacePage — viewing a past stage', () => {
  it('stays on the past stage after clicking a completed step (no snap-back to current)', () => {
    render(<WorkspacePage />)

    // Sanity: active stage is triage (live view shown, no past banner yet).
    expect(screen.getByTestId('triage-live')).toBeInTheDocument()
    expect(screen.queryByText(/Viewing past stage/)).not.toBeInTheDocument()

    // Click the completed "Rules" step in the stepper.
    fireEvent.click(screen.getByText('Rules'))

    // It must switch to (and STAY on) the past-stage review, not flicker back.
    expect(screen.getByText(/Viewing past stage/)).toBeInTheDocument()
    expect(screen.getByTestId('snapshot')).toHaveTextContent('snapshot:rules')
    expect(screen.queryByTestId('triage-live')).not.toBeInTheDocument()
  })
})
