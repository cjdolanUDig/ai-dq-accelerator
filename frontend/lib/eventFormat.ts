// frontend/lib/eventFormat.ts
// Pure formatters that turn raw AI event payloads into display-ready structures.
import type { AIEvent } from '@/hooks/useAIStream'

const SQL_RE = /\b(select|from|where|join|group\s+by|order\s+by|case\s+when|coalesce|cast)\b/i

export type InputKind = 'text' | 'list' | 'code'
export interface InputRow {
  key: string
  value: string
  kind: InputKind
}

function scalar(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function formatToolInput(input: unknown): InputRow[] {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return []
  return Object.entries(input as Record<string, unknown>).map(([key, v]) => {
    if (Array.isArray(v)) {
      return { key, value: v.map(scalar).join('\n'), kind: 'list' as const }
    }
    if (typeof v === 'string' && SQL_RE.test(v)) {
      return { key, value: v, kind: 'code' as const }
    }
    return { key, value: scalar(v), kind: 'text' as const }
  })
}

function resultValue(ev: AIEvent): unknown {
  return 'result' in ev ? (ev as Record<string, unknown>).result : undefined
}

export function summarizeResult(ev: AIEvent): string {
  const r = resultValue(ev)
  if (r === undefined) return 'preview' in ev ? String((ev as Record<string, unknown>).preview) : ''
  if (Array.isArray(r)) return `${r.length} row${r.length === 1 ? '' : 's'} returned`
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>
    if ('error' in o) return `Error: ${String(o.error)}`
    const parts: string[] = []
    if ('total_rows' in o) parts.push(`${Number(o.total_rows).toLocaleString()} rows`)
    if ('null_count' in o) parts.push(`${Number(o.null_count).toLocaleString()} nulls`)
    if (parts.length) return parts.join(' · ')
    return `${Object.keys(o).length} field${Object.keys(o).length === 1 ? '' : 's'}`
  }
  return String(r)
}

export type ResultDetail =
  | { kind: 'table'; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: 'kv'; entries: { key: string; value: string }[] }
  | null

export function resultDetail(ev: AIEvent): ResultDetail {
  const r = resultValue(ev)
  if (Array.isArray(r) && r.length > 0 && typeof r[0] === 'object' && r[0] !== null) {
    const rows = r as Record<string, unknown>[]
    return { kind: 'table', columns: Object.keys(rows[0]), rows }
  }
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    return {
      kind: 'kv',
      entries: Object.entries(r as Record<string, unknown>).map(([key, v]) => ({ key, value: scalar(v) })),
    }
  }
  return null
}
