'use client'
import { Check, X } from 'lucide-react'
import { Chip, type StatusTone } from '@/components/ui/Chip'
import type { RuleComparisonEntry } from '@/lib/types'

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
        <div className="grid grid-cols-[2fr_1fr_1fr_110px] px-4 py-2 bg-elevated border-b border-border text-xs uppercase tracking-widest text-fg-subtle font-semibold gap-2">
          <span>Rule</span><span>Initial</span><span>Final</span><span>Status</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[2fr_1fr_1fr_110px] px-4 py-2.5 text-xs gap-2 items-center border-b border-border last:border-0">
            <span className="text-fg truncate">
              {r.check}
              {r.column ? <span className="text-fg-subtle font-mono"> · {r.column}</span> : null}
            </span>
            <Cell passed={r.initial_passed} failures={r.initial_failures} />
            <Cell passed={r.final_passed} failures={r.final_failures} />
            <span className="justify-self-start">
              <Chip variant="status" tone={STATUS_TONE[r.status]}>{r.status}</Chip>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
