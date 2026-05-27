import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AIEvent } from '@/hooks/useAIStream'
import { summarizeResult, resultDetail } from '@/lib/eventFormat'

export function ResultView({ event }: { event: AIEvent }) {
  const [open, setOpen] = useState(false)
  const summary = summarizeResult(event)
  const detail = resultDetail(event)
  if (!summary && !detail) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {detail && (
          <button
            type="button"
            aria-label={open ? 'collapse result' : 'expand result'}
            onClick={() => setOpen((v) => !v)}
            className="text-fg-subtle hover:text-fg shrink-0"
          >
            {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
          </button>
        )}
        <span className="text-xs text-fg-muted break-words">{summary}</span>
      </div>
      {open && detail?.kind === 'kv' && (
        <div className="flex flex-col gap-0.5 pl-4">
          {detail.entries.map(({ key, value }) => (
            <div key={key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-2 text-xs">
              <span className="font-mono text-fg-subtle truncate">{key}</span>
              <span className="font-mono text-fg break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
      {open && detail?.kind === 'table' && (
        <div className="pl-4 overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                {detail.columns.map((c) => (
                  <th key={c} className="text-left font-semibold text-fg-subtle px-2 py-0.5 border-b border-border">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row, i) => (
                <tr key={i}>
                  {detail.columns.map((c) => (
                    <td key={c} className="px-2 py-0.5 font-mono text-fg-muted whitespace-nowrap">
                      {row[c] === null || row[c] === undefined ? '—' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
