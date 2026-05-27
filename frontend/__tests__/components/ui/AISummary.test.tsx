import { render, screen, fireEvent } from '@testing-library/react'
import { AISummary } from '@/components/ui/AISummary'

it('renders the title and markdown body expanded by default', () => {
  render(<AISummary title="✦ AI SUMMARY" body="hello **world**" />)
  expect(screen.getByText('✦ AI SUMMARY')).toBeInTheDocument()
  expect(screen.getByText('world').tagName).toBe('STRONG')
})

it('collapses and expands when the header is clicked', () => {
  render(<AISummary title="✦ AI SUMMARY" body="secret text" />)
  const toggle = screen.getByRole('button', { name: /ai summary/i })
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(/secret text/)).toBeInTheDocument()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(/secret text/)).not.toBeInTheDocument()
})

it('renders nothing when body is empty', () => {
  const { container } = render(<AISummary title="✦ AI SUMMARY" body="" />)
  expect(container).toBeEmptyDOMElement()
})

it('honors defaultOpen=false', () => {
  render(<AISummary title="✦ AI SUMMARY" body="hidden" defaultOpen={false} />)
  expect(screen.getByRole('button', { name: /ai summary/i })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
})
