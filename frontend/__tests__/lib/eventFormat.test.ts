import { formatToolInput, summarizeResult, resultDetail } from '@/lib/eventFormat'

describe('formatToolInput', () => {
  it('returns key/value rows for a flat object', () => {
    expect(formatToolInput({ column: 'customerID', top_n: 5 })).toEqual([
      { key: 'column', value: 'customerID', kind: 'text' },
      { key: 'top_n', value: '5', kind: 'text' },
    ])
  })
  it('renders arrays as list kind, one item per line', () => {
    const out = formatToolInput({ todos: ['Get sample', 'Get schema'] })
    expect(out[0]).toEqual({ key: 'todos', value: 'Get sample\nGet schema', kind: 'list' })
  })
  it('detects SQL strings as code kind', () => {
    const out = formatToolInput({ query: 'SELECT * FROM working_data WHERE x IS NULL' })
    expect(out[0].kind).toBe('code')
  })
  it('returns empty array for non-object input', () => {
    expect(formatToolInput(undefined)).toEqual([])
    expect(formatToolInput('nope')).toEqual([])
  })
})

describe('summarizeResult', () => {
  it('summarizes an array as a row count', () => {
    expect(summarizeResult({ event: 'tool_result', result: [1, 2, 3] })).toBe('3 rows returned')
  })
  it('summarizes 1 row without pluralizing', () => {
    expect(summarizeResult({ event: 'tool_result', result: [1] })).toBe('1 row returned')
  })
  it('summarizes value-count style dicts', () => {
    expect(
      summarizeResult({ event: 'tool_result', result: { total_rows: 70000, null_count: 0 } }),
    ).toBe('70,000 rows · 0 nulls')
  })
  it('surfaces errors', () => {
    expect(summarizeResult({ event: 'tool_result', result: { error: 'boom' } })).toBe('Error: boom')
  })
  it('falls back to preview when no structured result', () => {
    expect(summarizeResult({ event: 'tool_result', preview: 'legacy text' })).toBe('legacy text')
  })
})

describe('resultDetail', () => {
  it('builds a table from a list of row objects', () => {
    const d = resultDetail({ event: 'tool_result', result: [{ a: 1, b: 2 }, { a: 3, b: 4 }] })
    expect(d).toEqual({ kind: 'table', columns: ['a', 'b'], rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }] })
  })
  it('builds key/value entries from a dict', () => {
    const d = resultDetail({ event: 'tool_result', result: { total_rows: 5 } })
    expect(d).toEqual({ kind: 'kv', entries: [{ key: 'total_rows', value: '5' }] })
  })
  it('returns null when there is no structured result', () => {
    expect(resultDetail({ event: 'tool_result', preview: 'x' })).toBeNull()
  })
})
