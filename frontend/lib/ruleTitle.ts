// frontend/lib/ruleTitle.ts
// Pure helpers to turn a rule's raw `check` type into a human-readable title.

/** A minimal rule shape — works for both Rule and RuleComparisonEntry. */
export interface RuleLike {
  check?: string
  column?: string
  pattern?: string
  values?: unknown[]
  min?: number
  max?: number
  format?: string
  col_a?: string
  col_b?: string
  rationale?: string
}

/** "customerID" -> "CustomerID"; "total_charges" -> "Total Charges". */
export function humanizeColumn(col?: string): string {
  if (!col) return ''
  const spaced = col.replace(/[_-]+/g, ' ').trim()
  if (spaced.includes(' ')) {
    return spaced.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function rangeTitle(col: string, min?: number, max?: number): string {
  if (min != null && max != null) return `${col} must be between ${min} and ${max}`
  if (min != null) return `${col} must be at least ${min}`
  if (max != null) return `${col} must be at most ${max}`
  return `${col} must be within range`
}

export function ruleTitle(rule: RuleLike): string {
  const col = humanizeColumn(rule.column)
  switch (rule.check) {
    case 'not_null':
      return `${col} must not be empty`
    case 'unique':
      return `${col} must be unique`
    case 'regex_match':
      return `${col} must match ${rule.pattern ?? 'a pattern'}`
    case 'value_in_set':
      return `${col} must be one of ${(rule.values ?? []).join(', ')}`
    case 'range':
      return rangeTitle(col, rule.min, rule.max)
    case 'date_format':
      return `${col} must be a valid date (${rule.format ?? ''})`
    case 'cross_column_order':
      return `${rule.col_a} must be ≤ ${rule.col_b}`
    case 'custom_sql':
      return rule.rationale ? `Custom check: ${rule.rationale}` : 'Custom check'
    default:
      return rule.check ?? ''
  }
}
