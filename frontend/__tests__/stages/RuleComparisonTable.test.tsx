import { render, screen, fireEvent } from '@testing-library/react'
import { RuleComparisonTable } from '@/components/stages/_scorecard/RuleComparisonTable'
import type { RuleComparisonEntry } from '@/lib/types'

const rows: RuleComparisonEntry[] = [
  {
    id: 'r1', check: 'not_null', column: 'email', category: 'completeness',
    initial_passed: false, initial_failures: 12,
    final_passed: false, final_failures: 3,
    final_sample_failing_rows: [{ customerID: 'CUST00231', email: null, gender: 'Male' }],
    status: 'improved',
  },
]

describe('RuleComparisonTable drill-in', () => {
  it('shows the human title instead of the raw check', () => {
    render(<RuleComparisonTable rows={rows} />)
    expect(screen.getByText('Email must not be empty')).toBeInTheDocument()
  })
  it('expands a row to show the check definition and failing rows', () => {
    render(<RuleComparisonTable rows={rows} />)
    expect(screen.queryByText(/sample failing rows/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Email must not be empty/i }))
    expect(screen.getByText(/sample failing rows/i)).toBeInTheDocument()
    expect(screen.getByText('CUST00231')).toBeInTheDocument()
    expect(screen.getByText('check: not_null')).toBeInTheDocument()
  })
  it('does not offer expansion when a rule has no failing rows', () => {
    const passing: RuleComparisonEntry[] = [{
      id: 'r2', check: 'unique', column: 'cid', category: 'uniqueness',
      initial_passed: true, initial_failures: 0, final_passed: true, final_failures: 0,
      final_sample_failing_rows: [], status: 'unchanged',
    }]
    render(<RuleComparisonTable rows={passing} />)
    expect(screen.queryByRole('button', { name: /must be unique/i })).not.toBeInTheDocument()
  })
})
