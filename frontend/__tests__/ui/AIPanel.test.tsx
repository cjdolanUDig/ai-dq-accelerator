import { render, screen, fireEvent } from '@testing-library/react'
import { AIPanel } from '@/components/ai-panel/AIPanel'

// jsdom doesn't implement scrollTo — mock it so useStickToBottom doesn't throw
beforeAll(() => {
  Element.prototype.scrollTo = () => {}
})

const events = [
  { event: 'thinking', ts: 1, stage: 'profile', text: 'profiling thought' },
  { event: 'thinking', ts: 2, stage: 'validate', text: 'validating thought' },
  { event: 'thinking', ts: 3, text: 'untagged thought' },
]

describe('AIPanel per-stage filter', () => {
  it('shows only the viewing stage plus untagged events by default', () => {
    render(<AIPanel events={events} isStreaming={false} viewingStage="profile" />)
    expect(screen.getByText('profiling thought')).toBeInTheDocument()
    expect(screen.getByText('untagged thought')).toBeInTheDocument()
    expect(screen.queryByText('validating thought')).not.toBeInTheDocument()
  })

  it('shows all events after toggling to All', () => {
    render(<AIPanel events={events} isStreaming={false} viewingStage="profile" />)
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }))
    expect(screen.getByText('validating thought')).toBeInTheDocument()
  })
})
