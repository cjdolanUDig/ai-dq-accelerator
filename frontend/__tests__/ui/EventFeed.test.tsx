import { render, screen, fireEvent } from '@testing-library/react'
import { EventFeed } from '@/components/ai-panel/EventFeed'

describe('EventFeed structured rendering', () => {
  it('renders tool-call inputs as key/value rows, not raw JSON', () => {
    render(<EventFeed events={[{ event: 'tool_call', ts: 1, tool: 'dq_get_value_counts', input: { column: 'customerID', top_n: 5 } }]} />)
    expect(screen.getByText('column')).toBeInTheDocument()
    expect(screen.getByText('customerID')).toBeInTheDocument()
    expect(screen.getByText('top_n')).toBeInTheDocument()
    expect(screen.queryByText(/"column":/)).not.toBeInTheDocument()
  })

  it('summarizes a structured result and expands to detail on click', () => {
    render(
      <EventFeed
        events={[{ event: 'tool_result', ts: 2, tool: 'dq_get_value_counts', result: { total_rows: 70000, null_count: 0 } }]}
      />,
    )
    expect(screen.getByText('70,000 rows · 0 nulls')).toBeInTheDocument()
    expect(screen.queryByText('total_rows')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(screen.getByText('total_rows')).toBeInTheDocument()
  })

  it('falls back to preview text for legacy events without result', () => {
    render(<EventFeed events={[{ event: 'tool_result', ts: 3, tool: 'old_tool', preview: 'legacy preview' }]} />)
    expect(screen.getByText('legacy preview')).toBeInTheDocument()
  })
})
