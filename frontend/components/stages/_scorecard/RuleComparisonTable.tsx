'use client'
import { useState } from 'react'
import { Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { Chip, type StatusTone } from '@/components/ui/Chip'
import type { RuleComparisonEntry } from '@/lib/types'
import { ruleTitle } from '@/lib/ruleTitle'

const STATUS_TONE: Record<RuleComparisonEntry['status'], StatusTone> = {
  fixed: 'success',
  regressed: 'danger',
  worsened: 'danger',
  improved: 'warning',
  unchanged: 'neutral',
}

function Cell({ passed, failures }: { passed: boolean; failures: number }) {
  return (
    <span className={`flex items-center gap-1.5 ${passed ? 'text-success-deep' : 'text-danger-deep'}`}>
      {passed ? <Check size={12} strokeWidth={2.5} /> : <X size={12} strokeWidth={2.5} />}
      {passed ? '0 fail' : `${failures.toLocaleString()} fail`}
    </span>
  )
}

function FailingRows({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null
  const columns = Object.keys(rows[0])
  return (
    <div className="mt-2">
      <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
        Sample failing rows
        <span className="ml-2 normal-case tracking-normal">showing {rows.length}</span>
      </span>
      <div className="mt-1 overflow-x-auto border border-border rounded-md">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="bg-elevated">
              {columns.map((c) => (
                <th key={c} className="text-left font-semibold text-fg-subtle px-2 py-1 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {columns.map((c) => (
                  <td key={c} className="px-2 py-1 font-mono text-fg-muted whitespace-nowrap">
                    {row[c] === null || row[c] === undefined ? '—' : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ r }: { r: RuleComparisonEntry }) {
  const [open, setOpen] = useState(false)
  const failingRows = r.final_sample_failing_rows ?? []
  const hasDetail = !r.final_passed && failingRows.length > 0
  const title = ruleTitle(r)

  return (
    <div className="border-b border-border last:border-0">
      <div className="grid grid-cols-[20px_2fr_1fr_1fr_110px] px-4 py-2.5 text-xs gap-2 items-center">
        <div className="w-4 h-4 flex items-center justify-center text-fg-subtle">
          {hasDetail ? (
            <button
              type="button"
              aria-label={title}
              onClick={() => setOpen((v) => !v)}
              className="hover:text-fg"
            >
              {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
            </button>
          ) : null}
        </div>
        <span className="text-fg truncate">
          {title}
          {r.column ? <span className="text-fg-subtle font-mono"> · {r.column}</span> : null}
        </span>
        <Cell passed={r.initial_passed} failures={r.initial_failures} />
        <Cell passed={r.final_passed} failures={r.final_failures} />
        <span className="justify-self-start">
          <Chip variant="status" tone={STATUS_TONE[r.status]}>{r.status}</Chip>
        </span>
      </div>
      {open && hasDetail && (
        <div className="mx-4 mb-3 px-4 py-3 bg-canvas rounded-md border border-border-strong text-xs">
          <div className="text-fg-muted font-mono">check: {r.check}</div>
          <FailingRows rows={failingRows} />
        </div>
      )}
    </div>
  )
}

export function RuleComparisonTable({ rows }: { rows: RuleComparisonEntry[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-fg-muted text-sm">
        Per-rule comparison unavailable for this session.
      </div>
    )
  }
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  const summary = (['fixed', 'improved', 'worsened', 'regressed', 'unchanged'] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ')

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-fg-muted">{summary}</div>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[20px_2fr_1fr_1fr_110px] px-4 py-2 bg-elevated border-b border-border text-xs uppercase tracking-widest text-fg-subtle font-semibold gap-2">
          <span /><span>Rule</span><span>Initial</span><span>Final</span><span>Status</span>
        </div>
        {rows.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </div>
    </div>
  )
}
