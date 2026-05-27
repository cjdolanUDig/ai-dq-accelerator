// react-syntax-highlighter uses ESM-only refractor internally which Jest (CJS)
// cannot parse — mock the library so we can test CodeBlock and brightTheme directly.
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}))
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {
    'pre[class*="language-"]': { background: '#282c34', color: '#abb2bf' },
    'code[class*="language-"]': { color: '#abb2bf' },
  },
}))

import { render } from '@testing-library/react'
import { CodeBlock } from '@/components/stages/CodeBlock'
import { brightTheme } from '@/components/stages/CodeBlock.theme'

describe('CodeBlock', () => {
  it('renders the provided code', () => {
    const { container } = render(<CodeBlock code={'x = 1\nprint(x)'} />)
    expect(container.textContent).toContain('print')
  })
  it('brightTheme bolds keywords and uses a high-contrast base color', () => {
    expect(brightTheme['keyword'].fontWeight).toBe('600')
    expect(brightTheme['pre[class*="language-"]'].color).toBeTruthy()
  })
})
