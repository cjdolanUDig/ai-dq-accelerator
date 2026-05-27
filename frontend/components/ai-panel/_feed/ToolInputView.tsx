import { formatToolInput } from '@/lib/eventFormat'

export function ToolInputView({ input }: { input: unknown }) {
  const rows = formatToolInput(input)
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {rows.map(({ key, value, kind }) => (
        <div key={key} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 text-xs">
          <span className="font-mono text-fg-subtle truncate">{key}</span>
          {kind === 'code' ? (
            <pre className="font-mono text-fg-muted whitespace-pre-wrap break-all bg-elevated rounded px-1.5 py-1">{value}</pre>
          ) : kind === 'list' ? (
            <ul className="text-fg-muted list-disc pl-4 break-words">
              {value.split('\n').map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <span className="font-mono text-fg break-words">{value}</span>
          )}
        </div>
      ))}
    </div>
  )
}
