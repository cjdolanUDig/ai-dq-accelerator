import React from 'react'

// ── Inline: `code`, **bold**, *italic* / _italic_, [text](url) ──
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${i++}`
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-black/5 font-mono text-[0.9em]">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!
      nodes.push(
        <a key={key} href={lm[2]} target="_blank" rel="noopener noreferrer" className="underline">
          {lm[1]}
        </a>,
      )
    } else {
      nodes.push(<em key={key} className="italic">{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

const HEADING_SIZE = ['text-base', 'text-base', 'text-sm', 'text-sm', 'text-xs', 'text-xs']

function parseBlocks(src: string): React.ReactNode[] {
  const lines = (src ?? '').replace(/\r\n/g, '\n').split('\n')
  const out: React.ReactNode[] = []
  const para: string[] = []
  let key = 0
  let i = 0

  const flushPara = () => {
    if (para.length) {
      const text = para.join(' ')
      out.push(
        <p key={`p${key++}`} className="leading-relaxed">
          {renderInline(text, `p${key}`)}
        </p>,
      )
      para.length = 0
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (/^```/.test(trimmed)) {
      flushPara()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i])
        i++
      }
      i++ // closing fence
      out.push(
        <pre
          key={`c${key++}`}
          className="bg-black/5 rounded-md p-2 overflow-x-auto font-mono text-[0.9em] whitespace-pre-wrap break-all"
        >
          {code.join('\n')}
        </pre>,
      )
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      const level = h[1].length
      out.push(
        React.createElement(
          `h${level}`,
          { key: `h${key++}`, className: `font-semibold ${HEADING_SIZE[level - 1]} mt-1` },
          renderInline(h[2], `h${key}`),
        ),
      )
      i++
      continue
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flushPara()
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
        i++
      }
      const liNodes = items.map((it, idx) => (
        <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>
      ))
      out.push(
        ordered ? (
          <ol key={`l${key++}`} className="list-decimal pl-5 flex flex-col gap-0.5">{liNodes}</ol>
        ) : (
          <ul key={`l${key++}`} className="list-disc pl-5 flex flex-col gap-0.5">{liNodes}</ul>
        ),
      )
      continue
    }

    if (trimmed === '') {
      flushPara()
      i++
      continue
    }

    para.push(line)
    i++
  }
  flushPara()
  return out
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return <div className={['flex flex-col gap-2', className].filter(Boolean).join(' ')}>{parseBlocks(children)}</div>
}
