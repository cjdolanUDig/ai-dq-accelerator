import { render, screen, fireEvent } from '@testing-library/react'
import { ScorecardStage } from '@/components/stages/ScorecardStage'
import type { ScorecardResponse } from '@/lib/types'

jest.mock('@/components/stages/CodeBlock', () => ({ CodeBlock: () => <div /> }))

const base: ScorecardResponse = {
  stage: 'COMPLETE' as ScorecardResponse['stage'],
  baseline_score: 0.5, final_score: 0.9, delta: 0.4,
  original_rows: 100, final_rows: 90, rows_removed: 10, rows_modified: 5,
  rules_passing: 3, rules_total: 4, narrative: '', transformation_log: [],
  rule_comparison: [
    { id: 'r1', check: 'not_null', column: 'email', initial_passed: false, initial_failures: 412, final_passed: true, final_failures: 0, status: 'fixed' },
    { id: 'r2', check: 'regex', column: 'phone', initial_passed: true, initial_failures: 0, final_passed: false, final_failures: 5, status: 'regressed' },
  ],
}

it('shows Overview by default and switches to the Rules tab', () => {
  render(<ScorecardStage sessionId="s1" data={base} />)
  expect(screen.getByText('Quality Score')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'rules' }))
  expect(screen.getByText('Email must not be empty')).toBeInTheDocument()
  expect(screen.getByText('regex')).toBeInTheDocument()
  expect(screen.getAllByText(/fixed/i).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/regressed/i).length).toBeGreaterThan(0)
})

it('shows an unavailable message on the Rules tab when comparison is empty', () => {
  render(<ScorecardStage sessionId="s1" data={{ ...base, rule_comparison: [] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'rules' }))
  expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument()
})
