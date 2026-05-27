// frontend/components/stages/CodeBlock.theme.ts
// High-contrast LIGHT Prism theme for code shown on the app's light surfaces.
// Derived from oneDark for token coverage, but with dark text, light/transparent
// background, and — importantly — no textShadow (oneDark's shadow made the text
// look faded and blurry on a light background).
import type { CSSProperties } from 'react'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const _base = oneDark['pre[class*="language-"]'] ?? {}
const _baseCode = oneDark['code[class*="language-"]'] ?? {}

export const brightTheme: Record<string, CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ..._base,
    color: '#1f2328',
    background: 'transparent',
    textShadow: 'none',
  },
  'code[class*="language-"]': {
    ..._baseCode,
    color: '#1f2328',
    background: 'transparent',
    textShadow: 'none',
  },
  comment: { color: '#6e7781', fontStyle: 'italic', textShadow: 'none' },
  keyword: { color: '#cf222e', fontWeight: '600', textShadow: 'none' },
  function: { color: '#8250df', fontWeight: '600', textShadow: 'none' },
  'class-name': { color: '#953800', fontWeight: '600', textShadow: 'none' },
  string: { color: '#0a3069', textShadow: 'none' },
  number: { color: '#0550ae', textShadow: 'none' },
  boolean: { color: '#0550ae', textShadow: 'none' },
  operator: { color: '#0550ae', background: 'transparent', textShadow: 'none' },
  builtin: { color: '#0550ae', textShadow: 'none' },
  punctuation: { color: '#1f2328', textShadow: 'none' },
}
