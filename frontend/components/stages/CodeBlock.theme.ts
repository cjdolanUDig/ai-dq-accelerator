// frontend/components/stages/CodeBlock.theme.ts
// A brightened, higher-contrast Prism theme derived from oneDark. Keeps a dark
// background but bolds keywords/functions and lifts token colors for legibility.
import type { CSSProperties } from 'react'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export const brightTheme: Record<string, CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': { ...(oneDark['pre[class*="language-"]'] ?? {}), color: '#e6edf3' },
  'code[class*="language-"]': { ...(oneDark['code[class*="language-"]'] ?? {}), color: '#e6edf3' },
  keyword: { color: '#79c0ff', fontWeight: '600' },
  function: { color: '#ffd866', fontWeight: '600' },
  'class-name': { color: '#7ee787', fontWeight: '600' },
  string: { color: '#ffab70' },
  number: { color: '#a5d6ff' },
  comment: { color: '#8b949e', fontStyle: 'italic' },
  operator: { color: '#e6edf3' },
  builtin: { color: '#79c0ff' },
}
