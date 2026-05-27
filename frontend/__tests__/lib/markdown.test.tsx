import { render } from '@testing-library/react'
import { Markdown } from '@/lib/markdown'

function md(src: string) {
  return render(<Markdown>{src}</Markdown>).container
}

it('renders bold and italic', () => {
  const c = md('Some **bold** and *em* text')
  expect(c.querySelector('strong')?.textContent).toBe('bold')
  expect(c.querySelector('em')?.textContent).toBe('em')
})

it('renders inline code', () => {
  const c = md('use `npx jest` now')
  expect(c.querySelector('code')?.textContent).toBe('npx jest')
})

it('renders links with safe attributes', () => {
  const a = md('see [docs](https://example.com)').querySelector('a')!
  expect(a.getAttribute('href')).toBe('https://example.com')
  expect(a.getAttribute('target')).toBe('_blank')
  expect(a.getAttribute('rel')).toContain('noopener')
  expect(a.textContent).toBe('docs')
})

it('renders unordered and ordered lists', () => {
  const ul = md('- one\n- two').querySelector('ul')!
  expect(ul.querySelectorAll('li')).toHaveLength(2)
  const ol = md('1. a\n2. b').querySelector('ol')!
  expect(ol.querySelectorAll('li')).toHaveLength(2)
})

it('renders headings', () => {
  expect(md('## Title').querySelector('h2')?.textContent).toBe('Title')
})

it('renders fenced code blocks', () => {
  const pre = md('```\nline1\nline2\n```').querySelector('pre')!
  expect(pre.textContent).toBe('line1\nline2')
})

it('renders paragraphs and does not throw on unbalanced markup', () => {
  const c = md('first para\n\nsecond **oops')
  expect(c.querySelectorAll('p')).toHaveLength(2)
  expect(c.textContent).toContain('oops')
})
