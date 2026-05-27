'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Markdown } from '@/lib/markdown'

interface AISummaryProps {
  title: string
  body: string
  defaultOpen?: boolean
  className?: string
}

export function AISummary({ title, body, defaultOpen = true, className }: AISummaryProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (!body) return null
  return (
    <div
      className={[
        'bg-accent-purple/15 border border-accent-purple/30 rounded-xl px-4 pt-3.5 pb-4 flex flex-col gap-1.5',
        className,
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-widest text-accent-purple-deep"
      >
        <span className="flex-1">{title}</span>
        {open ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
      </button>
      {open && <Markdown className="text-xs text-accent-purple-deep">{body}</Markdown>}
    </div>
  )
}
