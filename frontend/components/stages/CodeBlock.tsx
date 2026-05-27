'use client'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { brightTheme } from './CodeBlock.theme'

interface Props {
  code: string
  language?: string
}

export function CodeBlock({ code, language = 'python' }: Props) {
  return (
    <SyntaxHighlighter
      language={language}
      style={brightTheme}
      customStyle={{
        margin: 0,
        borderRadius: '0.375rem',
        fontSize: '12px',
        lineHeight: '1.55',
        background: 'transparent',
        padding: '0.5rem',
      }}
      codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
