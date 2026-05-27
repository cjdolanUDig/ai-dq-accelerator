import { ruleTitle, humanizeColumn } from '@/lib/ruleTitle'

describe('humanizeColumn', () => {
  it('capitalizes first letter of camelCase', () => {
    expect(humanizeColumn('customerID')).toBe('CustomerID')
  })
  it('title-cases snake_case', () => {
    expect(humanizeColumn('total_charges')).toBe('Total Charges')
  })
  it('returns empty string for undefined', () => {
    expect(humanizeColumn(undefined)).toBe('')
  })
})

describe('ruleTitle', () => {
  it('not_null', () => {
    expect(ruleTitle({ check: 'not_null', column: 'email' })).toBe('Email must not be empty')
  })
  it('unique', () => {
    expect(ruleTitle({ check: 'unique', column: 'customerID' })).toBe('CustomerID must be unique')
  })
  it('regex_match', () => {
    expect(ruleTitle({ check: 'regex_match', column: 'email', pattern: '^.+@.+$' }))
      .toBe('Email must match ^.+@.+$')
  })
  it('value_in_set', () => {
    expect(ruleTitle({ check: 'value_in_set', column: 'gender', values: ['Male', 'Female'] }))
      .toBe('Gender must be one of Male, Female')
  })
  it('range with min and max', () => {
    expect(ruleTitle({ check: 'range', column: 'age', min: 0, max: 120 }))
      .toBe('Age must be between 0 and 120')
  })
  it('range with only min', () => {
    expect(ruleTitle({ check: 'range', column: 'age', min: 0 })).toBe('Age must be at least 0')
  })
  it('range with only max', () => {
    expect(ruleTitle({ check: 'range', column: 'age', max: 120 })).toBe('Age must be at most 120')
  })
  it('date_format', () => {
    expect(ruleTitle({ check: 'date_format', column: 'dob', format: 'YYYY-MM-DD' }))
      .toBe('Dob must be a valid date (YYYY-MM-DD)')
  })
  it('cross_column_order', () => {
    expect(ruleTitle({ check: 'cross_column_order', col_a: 'start', col_b: 'end' }))
      .toBe('start must be ≤ end')
  })
  it('custom_sql with rationale', () => {
    expect(ruleTitle({ check: 'custom_sql', rationale: 'TotalCharges parses as number' }))
      .toBe('Custom check: TotalCharges parses as number')
  })
  it('custom_sql without rationale', () => {
    expect(ruleTitle({ check: 'custom_sql' })).toBe('Custom check')
  })
  it('falls back to raw check for unknown type', () => {
    expect(ruleTitle({ check: 'some_future_check', column: 'x' })).toBe('some_future_check')
  })
})
