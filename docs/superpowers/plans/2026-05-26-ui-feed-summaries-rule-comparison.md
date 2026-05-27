# UI Changes: Feed Clipping, Collapsible Markdown Summaries, Scorecard Rule Comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the AI-panel Feed card clipping, render AI summaries as collapsible markdown, and add a per-rule initial-vs-final comparison to the Scorecard.

**Architecture:** Three independent changes. (1) A one-class CSS fix in `EventFeed`. (2) A dependency-free `Markdown` renderer + reusable collapsible `AISummary`, adopted across four stages. (3) A unit-tested pure backend helper that joins the persisted `validate` snapshot's per-rule results with the final per-rule state from the transform log, exposed as a new `rule_comparison` field on the scorecard endpoint and rendered in a new Scorecard "Rules" tab.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind 3 / Jest + Testing Library (frontend); FastAPI + Pydantic v2 / pytest (backend). Run jest with `npx jest` from `frontend/`; pytest with `.venv/bin/pytest` from repo root. `tsc --noEmit` and `npm run build` (from `frontend/`) must stay green.

**Spec:** `docs/superpowers/specs/2026-05-26-ui-feed-summaries-rule-comparison-design.md`

**Conventions established during planning:**
- jest moduleNameMapper maps `@/` → `frontend/`. jsdom env. No `npm test` script — use `npx jest`.
- AI prose card chrome used across stages: `bg-accent-purple/15 border border-accent-purple/30 rounded-xl` with title `text-xs font-semibold uppercase tracking-widest text-accent-purple-deep`.
- Backend `TransformationLogEntry` has `model_config = {"extra": "allow"}`, so `post_step_per_rule` rides along in `full_state["transformation_log"]` raw dicts.
- Repo `dq_app` schema; the `validate` snapshot payload is `{"validation_results": {"per_rule": [...]}, ...}`; each per-rule dict has `id`, `check`, `column`, `passed`, `failure_count`, `failure_rate`.

---

## File Structure

- `frontend/components/ai-panel/EventFeed.tsx` — add `shrink-0` to `cardBase` (Task 1).
- `frontend/lib/markdown.tsx` — new dependency-free `Markdown` renderer (Task 2).
- `frontend/components/ui/AISummary.tsx` — new collapsible markdown card (Task 3).
- `frontend/components/stages/{ProfileStage,ScorecardStage,ValidateStage,PlanReviewStage}.tsx` — adopt `AISummary` (Task 4).
- `backend/api/rule_comparison.py` — new pure helpers `build_rule_comparison`, `latest_post_step_per_rule` (Task 5).
- `backend/api/schemas.py`, `backend/api/routers/pipeline.py` — add `RuleComparisonEntry` + wire endpoint (Task 6).
- `frontend/lib/types.ts`, `frontend/components/stages/ScorecardStage.tsx`, `frontend/components/stages/_scorecard/RuleComparisonTable.tsx` — Rules tab (Task 7).

---

## Task 1: Fix Feed card vertical clipping

**Root cause:** `EventFeed`'s scroller is a flex column; each card has `overflow-hidden`, which forces the flex item's automatic `min-height` to 0, so flexbox shrinks every card instead of scrolling. Fix: make cards non-shrinkable.

**Files:**
- Modify: `frontend/components/ai-panel/EventFeed.tsx`
- Test: `frontend/__tests__/components/ai-panel/EventFeed.test.tsx`

- [ ] **Step 1: Add a failing test asserting cards don't shrink**

Add this test to `frontend/__tests__/components/ai-panel/EventFeed.test.tsx` (keep existing tests):
```tsx
it('renders event cards as non-shrinking so the scroller scrolls instead of squishing them', () => {
  const events = [
    { event: 'tool_call', ts: 1, tool: 'dq_get_value_counts', input: { column: 'email' } },
    { event: 'tool_result', ts: 2, tool: 'dq_get_value_counts', preview: 'x'.repeat(400) },
  ] as any
  const { container } = render(<EventFeed events={events} />)
  // Each direct card wrapper under the scroller must carry shrink-0.
  const scroller = container.querySelector('[data-testid="event-feed-scroller"]')!
  const cards = Array.from(scroller.children).filter(
    (el) => el.className.includes('rounded-lg') && el.className.includes('border'),
  )
  expect(cards.length).toBeGreaterThan(0)
  cards.forEach((c) => expect(c.className).toContain('shrink-0'))
})
```
Ensure the file imports `render` and `EventFeed`:
```tsx
import { render } from '@testing-library/react'
import { EventFeed } from '@/components/ai-panel/EventFeed'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx jest EventFeed -t "non-shrinking"`
Expected: FAIL — cards' className does not contain `shrink-0`.

- [ ] **Step 3: Add `shrink-0` to the card base**

In `frontend/components/ai-panel/EventFeed.tsx`, change the `cardBase` constant from:
```tsx
const cardBase = 'bg-surface rounded-lg p-3 flex flex-col gap-1.5 border min-w-0 overflow-hidden'
```
to:
```tsx
const cardBase = 'bg-surface rounded-lg p-3 flex flex-col gap-1.5 border min-w-0 overflow-hidden shrink-0'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx jest EventFeed`
Expected: PASS (all EventFeed tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/Connor/claude/ai-dq-accelerator
git add frontend/components/ai-panel/EventFeed.tsx frontend/__tests__/components/ai-panel/EventFeed.test.tsx
git commit -m "$(cat <<'EOF'
fix(frontend): stop AI-panel Feed cards from being vertically clipped

The feed scroller is a flex column and each card had overflow-hidden, which
forces the flex item's auto min-height to 0 — so flexbox shrank every card to
fit instead of scrolling, clipping the chip/tool-name top and bottom. Add
shrink-0 so cards keep natural height and the scroller scrolls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Dependency-free `Markdown` renderer

**Files:**
- Create: `frontend/lib/markdown.tsx`
- Test: `frontend/__tests__/lib/markdown.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/__tests__/lib/markdown.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx jest markdown`
Expected: FAIL — `Cannot find module '@/lib/markdown'`.

- [ ] **Step 3: Implement the renderer**

Create `frontend/lib/markdown.tsx`:
```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx jest markdown`
Expected: PASS (7 tests). If a TS/JSX issue appears with `React.createElement` and dynamic tag names, it is acceptable to keep `React.createElement` (it returns `ReactElement`) — do not switch to `<Tag>` generics.

- [ ] **Step 5: Commit**

```bash
cd /Users/Connor/claude/ai-dq-accelerator
git add frontend/lib/markdown.tsx frontend/__tests__/lib/markdown.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): dependency-free Markdown renderer for AI prose

Renders the markdown subset AI summaries use (bold/italic/code, fenced code,
ordered/unordered lists, headings, links) without react-markdown, whose ESM
dependency tree breaks jest in this repo. Degrades unknown markup to plain text.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Collapsible `AISummary` card

**Files:**
- Create: `frontend/components/ui/AISummary.tsx`
- Test: `frontend/__tests__/components/ui/AISummary.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/__tests__/components/ui/AISummary.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx jest AISummary`
Expected: FAIL — `Cannot find module '@/components/ui/AISummary'`.

- [ ] **Step 3: Implement the component**

Create `frontend/components/ui/AISummary.tsx`:
```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx jest AISummary`
Expected: PASS (4 tests). The accessible name comes from the button's text content (the `title`), so `getByRole('button', { name: /ai summary/i })` matches.

- [ ] **Step 5: Commit**

```bash
cd /Users/Connor/claude/ai-dq-accelerator
git add frontend/components/ui/AISummary.tsx frontend/__tests__/components/ui/AISummary.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): collapsible AISummary card with markdown body

Reusable accent-purple summary card: titled header toggles expand/collapse
(expanded by default), renders the body via the Markdown component, and renders
nothing when the body is empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Adopt `AISummary` across the four stages

**Files:**
- Modify: `frontend/components/stages/ProfileStage.tsx`, `ScorecardStage.tsx`, `ValidateStage.tsx`, `PlanReviewStage.tsx`

- [ ] **Step 1: ProfileStage — replace the raw ai_summary card**

In `frontend/components/stages/ProfileStage.tsx`, add the import after the existing imports:
```tsx
import { AISummary } from '@/components/ui/AISummary'
```
Replace this block:
```tsx
      {session.ai_summary ? (
        <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-xl pt-3.5 px-4 pb-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent-purple-deep">
            ✦ AI SUMMARY
          </div>
          <p className="text-xs text-accent-purple-deep leading-relaxed">
            {session.ai_summary}
          </p>
        </div>
      ) : (
```
with:
```tsx
      {session.ai_summary ? (
        <AISummary title="✦ AI SUMMARY" body={session.ai_summary} />
      ) : (
```

- [ ] **Step 2: ScorecardStage — replace the raw narrative card**

In `frontend/components/stages/ScorecardStage.tsx`, add the import after the existing imports:
```tsx
import { AISummary } from '@/components/ui/AISummary'
```
Replace this block:
```tsx
      {data.narrative && (
        <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-xl p-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent-purple-deep">
            ✦ AI NARRATIVE
          </div>
          <p className="text-xs text-accent-purple-deep leading-relaxed">{data.narrative}</p>
        </div>
      )}
```
with:
```tsx
      {data.narrative && <AISummary title="✦ AI NARRATIVE" body={data.narrative} />}
```

- [ ] **Step 3: ValidateStage — replace ProseSection with AISummary**

In `frontend/components/stages/ValidateStage.tsx`, add the import after the existing imports:
```tsx
import { AISummary } from '@/components/ui/AISummary'
```
Delete the local `ProseSection` function (the block starting `function ProseSection({ label, body }: ...` through its closing `}` — currently lines ~134–146). Then replace its two usages:
```tsx
      <ProseSection label="✦ VALIDATION ANALYSIS" body={session?.validation_summary ?? ''} />
      <ProseSection label="✦ ANOMALY ANALYSIS" body={session?.anomaly_summary ?? ''} />
```
with:
```tsx
      <AISummary title="✦ VALIDATION ANALYSIS" body={session?.validation_summary ?? ''} />
      <AISummary title="✦ ANOMALY ANALYSIS" body={session?.anomaly_summary ?? ''} />
```

- [ ] **Step 4: PlanReviewStage — replace the raw summary card**

In `frontend/components/stages/PlanReviewStage.tsx`, add the import after the existing imports:
```tsx
import { AISummary } from '@/components/ui/AISummary'
```
Replace this block:
```tsx
          {transform_plan.summary && (
            <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-lg p-3 flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-widest text-accent-purple-deep">
                ✦ AI SUMMARY
              </div>
              <p className="text-xs text-accent-purple-deep leading-relaxed">
                {transform_plan.summary}
              </p>
            </div>
          )}
```
with:
```tsx
          {transform_plan.summary && <AISummary title="✦ AI SUMMARY" body={transform_plan.summary} />}
```

- [ ] **Step 5: Verify nothing regressed (full FE suite + types)**

Run: `cd frontend && npx jest 2>&1 | tail -6 && npx tsc --noEmit && echo "tsc clean"`
Expected: all jest suites pass; `tsc clean`. If an existing ValidateStage/ProfileStage/Scorecard test asserted the old raw-text DOM shape, update that assertion to match the `AISummary` output (title text still present; body text still present when expanded).

- [ ] **Step 6: Commit**

```bash
cd /Users/Connor/claude/ai-dq-accelerator
git add frontend/components/stages/ProfileStage.tsx frontend/components/stages/ScorecardStage.tsx frontend/components/stages/ValidateStage.tsx frontend/components/stages/PlanReviewStage.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): render AI summaries as collapsible markdown across stages

Replace the raw-text AI prose blocks in Profile, Scorecard, Validate, and
PlanReview with the shared AISummary component (markdown + collapse). Removes
the ad-hoc ProseSection in ValidateStage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Backend pure helpers for rule comparison

**Files:**
- Create: `backend/api/rule_comparison.py`
- Test: `tests/backend/api/test_rule_comparison.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/api/test_rule_comparison.py`:
```python
from backend.api.rule_comparison import build_rule_comparison, latest_post_step_per_rule


def _rule(rid, passed, fails, check="chk", column="col"):
    return {"id": rid, "check": check, "column": column, "passed": passed, "failure_count": fails}


def test_status_fixed_regressed_unchanged():
    initial = [_rule("r1", False, 10), _rule("r2", True, 0), _rule("r3", True, 0)]
    final = [_rule("r1", True, 0), _rule("r2", False, 5), _rule("r3", True, 0)]
    out = {e["id"]: e for e in build_rule_comparison(initial, final)}
    assert out["r1"]["status"] == "fixed"
    assert out["r2"]["status"] == "regressed"
    assert out["r3"]["status"] == "unchanged"


def test_status_improved_and_worsened_when_still_failing():
    initial = [_rule("a", False, 100), _rule("b", False, 10)]
    final = [_rule("a", False, 40), _rule("b", False, 25)]
    out = {e["id"]: e for e in build_rule_comparison(initial, final)}
    assert out["a"]["status"] == "improved"
    assert out["b"]["status"] == "worsened"


def test_missing_final_falls_back_to_initial():
    initial = [_rule("only", False, 7)]
    out = build_rule_comparison(initial, [])
    assert out[0]["final_passed"] is False
    assert out[0]["final_failures"] == 7
    assert out[0]["status"] == "unchanged"
    assert out[0]["check"] == "chk" and out[0]["column"] == "col"


def test_empty_initial_returns_empty():
    assert build_rule_comparison([], [_rule("x", True, 0)]) == []
    assert build_rule_comparison(None, None) == []


def test_latest_post_step_per_rule_picks_last_nonempty():
    log = [
        {"id": "s1", "post_step_per_rule": [_rule("r1", False, 5)]},
        {"id": "s2"},  # no post_step
        {"id": "s3", "post_step_per_rule": [_rule("r1", True, 0)]},
        {"id": "s4", "post_step_per_rule": []},
    ]
    final = latest_post_step_per_rule(log)
    assert final == [_rule("r1", True, 0)]


def test_latest_post_step_per_rule_empty_when_none():
    assert latest_post_step_per_rule([{"id": "s1"}, {"id": "s2"}]) == []
    assert latest_post_step_per_rule([]) == []
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/backend/api/test_rule_comparison.py -q`
Expected: FAIL — `ModuleNotFoundError: backend.api.rule_comparison`. (If `tests/backend/api/__init__.py` is needed for collection, create an empty one — check whether sibling test dirs have it.)

- [ ] **Step 3: Implement the helpers**

Create `backend/api/rule_comparison.py`:
```python
"""Pure helpers to build the Scorecard's per-rule initial-vs-final comparison."""
from __future__ import annotations

from typing import Any

STATUS_FIXED = "fixed"
STATUS_REGRESSED = "regressed"
STATUS_IMPROVED = "improved"
STATUS_WORSENED = "worsened"
STATUS_UNCHANGED = "unchanged"


def _status(init_passed: bool, init_fail: int, final_passed: bool, final_fail: int) -> str:
    if not init_passed and final_passed:
        return STATUS_FIXED
    if init_passed and not final_passed:
        return STATUS_REGRESSED
    if init_passed and final_passed:
        return STATUS_UNCHANGED
    # both still failing — compare failure counts
    if final_fail < init_fail:
        return STATUS_IMPROVED
    if final_fail > init_fail:
        return STATUS_WORSENED
    return STATUS_UNCHANGED


def latest_post_step_per_rule(transformation_log: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Return the most recent non-empty post_step_per_rule from the transform log,
    i.e. the final per-rule state. Empty list if no step recorded one."""
    for entry in reversed(transformation_log or []):
        psr = entry.get("post_step_per_rule")
        if psr:
            return psr
    return []


def build_rule_comparison(
    initial_per_rule: list[dict[str, Any]] | None,
    final_per_rule: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Join initial + final per-rule results by id. When a rule is missing from
    final, fall back to its initial state (no observed change)."""
    final_by_id = {r.get("id"): r for r in (final_per_rule or [])}
    out: list[dict[str, Any]] = []
    for r in initial_per_rule or []:
        rid = r.get("id")
        fin = final_by_id.get(rid, r)
        init_passed = bool(r.get("passed", False))
        init_fail = int(r.get("failure_count", 0) or 0)
        final_passed = bool(fin.get("passed", False))
        final_fail = int(fin.get("failure_count", 0) or 0)
        out.append({
            "id": rid,
            "check": r.get("check", ""),
            "column": r.get("column"),
            "initial_passed": init_passed,
            "initial_failures": init_fail,
            "final_passed": final_passed,
            "final_failures": final_fail,
            "status": _status(init_passed, init_fail, final_passed, final_fail),
        })
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/backend/api/test_rule_comparison.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/Connor/claude/ai-dq-accelerator
git add backend/api/rule_comparison.py tests/backend/api/test_rule_comparison.py
git commit -m "$(cat <<'EOF'
feat(api): pure helpers for scorecard per-rule comparison

build_rule_comparison joins initial vs final per-rule results by id and derives
a status (fixed/regressed/improved/worsened/unchanged). latest_post_step_per_rule
extracts the final per-rule state from the transform log. Both pure + unit-tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add `rule_comparison` to the scorecard schema + endpoint

**Files:**
- Modify: `backend/api/schemas.py`, `backend/api/routers/pipeline.py`
- Test: `tests/backend/api/test_rule_comparison.py` (add a schema acceptance test)

- [ ] **Step 1: Add `RuleComparisonEntry` and the response field**

In `backend/api/schemas.py`, add this class immediately **above** `class ScorecardResponse(BaseModel):`:
```python
class RuleComparisonEntry(BaseModel):
    id: str
    check: str = ""
    column: str | None = None
    initial_passed: bool
    initial_failures: int
    final_passed: bool
    final_failures: int
    status: str  # fixed | regressed | improved | worsened | unchanged
```
Then add this field to `ScorecardResponse` (after `transformation_log`):
```python
    rule_comparison: list[RuleComparisonEntry] = []
```

- [ ] **Step 2: Add a schema acceptance test and run it (RED→GREEN for the schema)**

Append to `tests/backend/api/test_rule_comparison.py`:
```python
def test_scorecard_response_accepts_rule_comparison():
    from backend.api.schemas import ScorecardResponse, RuleComparisonEntry, WorkflowStage
    entry = RuleComparisonEntry(
        id="r1", check="not_null", column="email",
        initial_passed=False, initial_failures=412,
        final_passed=True, final_failures=0, status="fixed",
    )
    resp = ScorecardResponse(
        stage=WorkflowStage.COMPLETE, baseline_score=0.5, final_score=0.9, delta=0.4,
        rule_comparison=[entry],
    )
    assert resp.rule_comparison[0].status == "fixed"
    assert ScorecardResponse(stage=WorkflowStage.COMPLETE, baseline_score=0, final_score=0, delta=0).rule_comparison == []
```
Run: `.venv/bin/pytest tests/backend/api/test_rule_comparison.py -q`
Expected: PASS (now 7 tests). (If `WorkflowStage.COMPLETE` is not the exact member name, use the correct terminal member from `backend/api/schemas.py`'s `WorkflowStage` enum.)

- [ ] **Step 3: Wire the endpoint to compute `rule_comparison`**

In `backend/api/routers/pipeline.py`, extend the imports:
```python
from backend.api.schemas import (
    PipelineGenerateRequest,
    PipelineGenerateResponse,
    RuleComparisonEntry,
    ScorecardResponse,
    TransformationLogEntry,
    WorkflowStage,
)
from backend.api.rule_comparison import build_rule_comparison, latest_post_step_per_rule
from backend.db.engine import get_sessionmaker
from backend.db.repository import get_snapshot
import uuid as _uuid
```
In `get_scorecard`, after the `transformation_log` try/except block and before the `return ScorecardResponse(...)`, insert:
```python
    # ── Per-rule initial→final comparison ────────────────────────────────────
    rule_comparison: list[RuleComparisonEntry] = []
    try:
        raw_log = full_state.get("transformation_log", []) if "full_state" in dir() else []
    except Exception:
        raw_log = []
    try:
        initial_per_rule: list = []
        sid_uuid = _uuid.UUID(session_id)
        sm = get_sessionmaker()
        async with sm() as db:
            snap = await get_snapshot(db, sid_uuid, "validate")
        if snap is not None:
            initial_per_rule = (snap.payload or {}).get("validation_results", {}).get("per_rule", [])
        final_per_rule = latest_post_step_per_rule(raw_log)
        rule_comparison = [
            RuleComparisonEntry(**e) for e in build_rule_comparison(initial_per_rule, final_per_rule)
        ]
    except Exception:
        rule_comparison = []
```
Note: `full_state` is defined inside the earlier `try` for `transformation_log`. To make it available here, hoist its declaration — change the earlier block from:
```python
    try:
        full_state = await handle.query(DQAcceleratorWorkflow.get_full_state)
        transformation_log = [
            TransformationLogEntry(**e) for e in full_state.get("transformation_log", [])
        ]
    except Exception:
        transformation_log = []
```
to:
```python
    full_state: dict = {}
    try:
        full_state = await handle.query(DQAcceleratorWorkflow.get_full_state)
        transformation_log = [
            TransformationLogEntry(**e) for e in full_state.get("transformation_log", [])
        ]
    except Exception:
        transformation_log = []
```
and simplify the `raw_log` line to:
```python
    raw_log = full_state.get("transformation_log", [])
```
Finally add `rule_comparison=rule_comparison,` to the `return ScorecardResponse(...)` call (after `transformation_log=transformation_log,`).

- [ ] **Step 4: Verify the full backend suite stays green**

Run: `.venv/bin/pytest -q 2>&1 | tail -3`
Expected: all tests pass (≥ 213: prior 207 + 6 new helper tests + 1 schema test, minus any renumbering). No import errors from `pipeline.py`.

- [ ] **Step 5: Commit**

```bash
cd /Users/Connor/claude/ai-dq-accelerator
git add backend/api/schemas.py backend/api/routers/pipeline.py tests/backend/api/test_rule_comparison.py
git commit -m "$(cat <<'EOF'
feat(api): expose rule_comparison on the scorecard endpoint

Adds RuleComparisonEntry to ScorecardResponse and computes it in get_scorecard
from the persisted validate snapshot (initial per-rule) joined with the final
per-rule state from the transform log. Degrades to [] if the snapshot is absent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Scorecard "Rules" tab (frontend)

**Files:**
- Modify: `frontend/lib/types.ts`, `frontend/components/stages/ScorecardStage.tsx`
- Create: `frontend/components/stages/_scorecard/RuleComparisonTable.tsx`
- Test: `frontend/__tests__/components/stages/ScorecardStage.test.tsx`

- [ ] **Step 1: Add the type**

In `frontend/lib/types.ts`, add this interface immediately above `export interface ScorecardResponse {`:
```tsx
export interface RuleComparisonEntry {
  id: string
  check: string
  column?: string
  initial_passed: boolean
  initial_failures: number
  final_passed: boolean
  final_failures: number
  status: 'fixed' | 'regressed' | 'improved' | 'worsened' | 'unchanged'
}
```
And add this field inside `ScorecardResponse` (after `transformation_log`):
```tsx
  rule_comparison: RuleComparisonEntry[]
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/__tests__/components/stages/ScorecardStage.test.tsx` (mock CodeBlock to avoid the react-syntax-highlighter ESM issue, and mock the api fetch):
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ScorecardStage } from '@/components/stages/ScorecardStage'
import type { ScorecardResponse } from '@/lib/types'

jest.mock('@/components/stages/CodeBlock', () => ({ CodeBlock: () => <div /> }))

const base: ScorecardResponse = {
  stage: 'COMPLETE' as ScorecardResponse['stage'],
  baseline_score: 0.5, final_score: 0.9, delta: 0.4,
  original_rows: 100, final_rows: 90, rows_removed: 10, rows_modified: 5,
  rules_passing: 3, rules_total: 4, narrative: '', transformation_log: [],
  rule_comparison: [
    { id: 'r1', check: 'not_null', column: 'email', initial_passed: false, initial_failures: 412, final_passed: true, final_failures: 0, status: 'fixed' },
    { id: 'r2', check: 'regex', column: 'phone', initial_passed: true, initial_failures: 0, final_passed: false, final_failures: 5, status: 'regressed' },
  ],
}

it('shows Overview by default and switches to the Rules tab', () => {
  render(<ScorecardStage sessionId="s1" data={base} />)
  expect(screen.getByText('Quality Score')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /rules/i }))
  expect(screen.getByText('not_null')).toBeInTheDocument()
  expect(screen.getByText('regex')).toBeInTheDocument()
  expect(screen.getByText(/fixed/i)).toBeInTheDocument()
  expect(screen.getByText(/regressed/i)).toBeInTheDocument()
})

it('shows an unavailable message on the Rules tab when comparison is empty', () => {
  render(<ScorecardStage sessionId="s1" data={{ ...base, rule_comparison: [] }} />)
  fireEvent.click(screen.getByRole('button', { name: /rules/i }))
  expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument()
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx jest ScorecardStage`
Expected: FAIL — no Rules tab / `RuleComparisonTable` not rendered.

- [ ] **Step 4: Create the comparison table component**

Create `frontend/components/stages/_scorecard/RuleComparisonTable.tsx`:
```tsx
'use client'
import { Check, X } from 'lucide-react'
import { Chip, type StatusTone } from '@/components/ui/Chip'
import type { RuleComparisonEntry } from '@/lib/types'

const STATUS_TONE: Record<RuleComparisonEntry['status'], StatusTone> = {
  fixed: 'success',
  regressed: 'danger',
  worsened: 'danger',
  improved: 'warning',
  unchanged: 'neutral',
}

function Cell({ passed, failures }: { passed: boolean; failures: number }) {
  return (
    <span className={`flex items-center gap-1.5 ${passed ? 'text-success-deep' : 'text-danger-deep'}`}>
      {passed ? <Check size={12} strokeWidth={2.5} /> : <X size={12} strokeWidth={2.5} />}
      {passed ? '0 fail' : `${failures.toLocaleString()} fail`}
    </span>
  )
}

export function RuleComparisonTable({ rows }: { rows: RuleComparisonEntry[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-fg-muted text-sm">
        Per-rule comparison unavailable for this session.
      </div>
    )
  }
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  const summary = (['fixed', 'improved', 'worsened', 'regressed', 'unchanged'] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ')

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-fg-muted">{summary}</div>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_110px] px-4 py-2 bg-elevated border-b border-border text-xs uppercase tracking-widest text-fg-subtle font-semibold gap-2">
          <span>Rule</span><span>Initial</span><span>Final</span><span>Status</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[2fr_1fr_1fr_110px] px-4 py-2.5 text-xs gap-2 items-center border-b border-border last:border-0">
            <span className="text-fg truncate">
              {r.check}
              {r.column ? <span className="text-fg-subtle font-mono"> · {r.column}</span> : null}
            </span>
            <Cell passed={r.initial_passed} failures={r.initial_failures} />
            <Cell passed={r.final_passed} failures={r.final_failures} />
            <span className="justify-self-start">
              <Chip variant="status" tone={STATUS_TONE[r.status]}>{r.status}</Chip>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```
Note: confirm `StatusTone` includes `'neutral'`, `'success'`, `'danger'`, `'warning'` by checking `frontend/components/ui/Chip.tsx`; if a tone name differs (e.g. `'muted'` instead of `'neutral'`), use the actual member for the `unchanged` mapping.

- [ ] **Step 5: Add the segmented tab to ScorecardStage**

In `frontend/components/stages/ScorecardStage.tsx`:
1. Add imports:
```tsx
import { RuleComparisonTable } from './_scorecard/RuleComparisonTable'
```
2. Inside the component, add view state after the `data` state:
```tsx
  const [view, setView] = useState<'overview' | 'rules'>('overview')
```
(`useState` is already imported.)
3. Wrap the existing rendered content. Find the top-level returned markup that starts with:
```tsx
  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Quality Scorecard</h1>
        <p className="text-xs text-fg-muted">
          Summary of every improvement made to your dataset across the transform pass.
        </p>
      </div>
```
Replace the heading block above with a heading + segmented control row, and gate the body on `view`:
```tsx
  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-base font-bold text-fg">Quality Scorecard</h1>
          <p className="text-xs text-fg-muted">
            Summary of every improvement made to your dataset across the transform pass.
          </p>
        </div>
        <div className="h-7 flex items-center bg-elevated rounded-md p-0.5 gap-0.5 shrink-0">
          {(['overview', 'rules'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={[
                'text-xs px-3 py-1 rounded-md capitalize transition-colors',
                view === v ? 'bg-surface text-fg border border-border' : 'text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'rules' ? (
        <RuleComparisonTable rows={data.rule_comparison ?? []} />
      ) : (
        <>
```
Then, at the very end of the existing returned JSX (just before the final closing `</div>` of the `p-5` container), close the fragment:
```tsx
        </>
      )}
    </div>
  )
```
The existing summary/stat/narrative/transform-log blocks stay exactly as-is, now nested inside the `<>...</>` Overview branch.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx jest ScorecardStage`
Expected: PASS (2 tests). If `getByRole('button', { name: /rules/i })` is ambiguous (matches another control), scope with `screen.getByRole('button', { name: 'rules' })`.

- [ ] **Step 7: Type-check and commit**

Run: `cd frontend && npx tsc --noEmit && echo "tsc clean"`
Expected: clean.
```bash
cd /Users/Connor/claude/ai-dq-accelerator
git add frontend/lib/types.ts frontend/components/stages/ScorecardStage.tsx frontend/components/stages/_scorecard/RuleComparisonTable.tsx frontend/__tests__/components/stages/ScorecardStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): Scorecard Rules tab with per-rule before-after comparison

Adds an Overview | Rules segmented control to the Scorecard. The Rules tab
renders rule_comparison as an initial→final table with fixed/improved/worsened/
regressed/unchanged status chips and a count summary; shows an unavailable
message when no comparison data is present.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full verification gate

- [ ] **Step 1: Backend**

Run: `cd /Users/Connor/claude/ai-dq-accelerator && .venv/bin/pytest -q 2>&1 | tail -3`
Expected: all pass (prior 207 + 7 new).

- [ ] **Step 2: Frontend tests**

Run: `cd /Users/Connor/claude/ai-dq-accelerator/frontend && npx jest 2>&1 | tail -6`
Expected: all suites pass, 0 failing.

- [ ] **Step 3: Type-check + build**

Run: `cd /Users/Connor/claude/ai-dq-accelerator/frontend && npx tsc --noEmit && npm run build 2>&1 | tail -8`
Expected: tsc clean; `next build` compiles successfully.

- [ ] **Step 4: Manual smoke (hand to user)**

With `./dev.sh` running: confirm (a) the AI panel Feed cards are no longer clipped; (b) an AI summary on Profile renders markdown and collapses/expands; (c) on a COMPLETE session, the Scorecard shows Overview | Rules and the Rules tab lists per-rule initial→final with status chips.

---

## Self-Review

- **Spec coverage:** #1 → Task 1. #2 markdown renderer → Task 2; AISummary → Task 3; adoption in the 4 stages → Task 4. #3 backend helper → Task 5; schema+endpoint `rule_comparison` → Task 6; Scorecard Rules tab + table + unavailable state → Task 7. Cross-cutting verification → Task 8.
- **Placeholder scan:** No TBD/TODO. New files include full code; edits show exact old→new. The only conditional guidance is "if a tone/enum member name differs, use the actual one" — these are verification hooks, not placeholders, since exact current names (`StatusTone`, `WorkflowStage`) are referenced from real files.
- **Type consistency:** `RuleComparisonEntry` fields match between backend schema (Task 6), the pure helper output keys (Task 5: `id/check/column/initial_passed/initial_failures/final_passed/final_failures/status`), and the frontend type (Task 7). Status string union (`fixed|regressed|improved|worsened|unchanged`) matches the backend `_status` returns. `latest_post_step_per_rule` + `build_rule_comparison` names are consistent across Tasks 5–6 and their tests.
- **Risk note:** Task 4 Step 5 and Task 7 may require updating pre-existing stage tests that assumed raw-text DOM; the steps call this out explicitly.
