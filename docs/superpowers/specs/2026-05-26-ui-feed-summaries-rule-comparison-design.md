# Design: AI-panel feed clipping, collapsible markdown summaries, per-rule before→after on the Scorecard

**Date:** 2026-05-26
**Status:** Approved (pending spec review)

Three independent frontend UI changes (one with a small additive backend change). All approved in brainstorming.

---

## #1 — AI panel Feed clipping (bug fix)

### Symptom
In the right-side AI Activity panel's **Feed** view, every event card is vertically squished to roughly half its needed height — the chip ("Tool Call" / "Result" / "Thinking") and tool name are clipped top and bottom (confirmed by screenshot). The **Terminal** view is unaffected.

### Root cause
`EventFeed`'s scroller is `relative flex-1 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-2`, and each card (`cardBase`) includes `overflow-hidden`. Per CSS, a flex item with `overflow` other than `visible` gets an automatic `min-height: 0`, so it becomes shrinkable below its content height. Because the cards' total height exceeds the scroller and the scroller is itself a **flex column**, flexbox distributes the overflow by **shrinking every card** instead of letting the container scroll → uniform vertical clipping. The Terminal view uses block-flow `<div>` rows (its scroller is not `display:flex`), so its rows keep natural height.

### Fix
Add `shrink-0` (flex-shrink: 0) to `EventFeed`'s `cardBase` so cards keep their natural content height; the scroller's `overflow-y-auto` then scrolls as intended. No change to Terminal. Keep `overflow-hidden` on the card (needed for horizontal containment / rounded-corner clipping of long `<pre>` bodies).

### Files
- `frontend/components/ai-panel/EventFeed.tsx` — `cardBase` string.

### Test
- `frontend/__tests__/components/ai-panel/EventFeed.test.tsx` (exists) — add a case asserting each rendered card carries the non-shrink class (`shrink-0`) so a regression that re-introduces shrink is caught. (We can't measure pixel clipping in jsdom, so we assert the structural fix.)

---

## #2 — AI summaries: markdown rendering + collapsible

### Today
AI prose is rendered as **raw text** (markdown shows as literal `**`, `-`, `#`, etc.) in:
- `ProfileStage` — `session.ai_summary`
- `ScorecardStage` — `data.narrative`
- `ValidateStage` — `validation_summary`, `anomaly_summary` (via a local `ProseSection`)
- `PlanReviewStage` — `transform_plan.summary`

No markdown library is installed anywhere.

### Components (two new)

**`frontend/lib/markdown.tsx` → `Markdown` component** — a small, dependency-free renderer for the subset AI summaries use. Avoids react-markdown because its ESM/unified dependency tree already broke jest in this repo (the refractor failure). Supported syntax:
- Paragraphs (blank-line separated)
- Headings `#`–`######`
- `**bold**`, `*italic*` / `_italic_`, inline `` `code` ``
- Fenced code blocks ```` ``` ```` (rendered in a `<pre>`; no syntax highlighting — keeps it dependency-free)
- Unordered lists (`-`, `*`, `+`) and ordered lists (`1.`)
- Links `[text](url)` (rendered with `target="_blank" rel="noopener noreferrer"`)
- Everything else passes through as text. Unknown/edge markdown degrades to readable plain text (never throws).

Styling: inherits the surrounding text color/size (so it works inside the accent-purple summary card and elsewhere). Tailwind classes on the rendered elements; no global prose styles.

**`frontend/components/ui/AISummary.tsx` → `AISummary` component** — the reusable titled, collapsible card:
```
interface AISummaryProps {
  title: string            // e.g. "✦ AI SUMMARY", "✦ VALIDATION ANALYSIS"
  body: string             // markdown source
  defaultOpen?: boolean    // default true (expanded)
  tone?: 'accent-purple'   // default accent-purple (matches existing styling); extensible
  className?: string
}
```
- Renders the existing accent-purple card chrome (`bg-accent-purple/15 border border-accent-purple/30 rounded-xl`).
- Header row = title + a chevron toggle button (`ChevronDown`/`ChevronUp` from lucide-react), keyboard-accessible (`<button>`, `aria-expanded`).
- **Expanded by default**; clicking the header (or chevron) collapses to just the title bar.
- When `body` is empty, renders nothing (callers keep their existing loading states).
- Body rendered via `<Markdown>`.

### Adoption
Replace the raw-text prose blocks with `<AISummary title=… body=… />` in `ProfileStage`, `ScorecardStage`, `ValidateStage` (both prose sections; remove the local `ProseSection`), and `PlanReviewStage`. Loading/empty states stay in the parent components unchanged.

### Files
- Create: `frontend/lib/markdown.tsx`, `frontend/components/ui/AISummary.tsx`
- Modify: `ProfileStage.tsx`, `ScorecardStage.tsx`, `ValidateStage.tsx`, `PlanReviewStage.tsx`
- Tests: `__tests__/lib/markdown.test.tsx` (each syntax element + plain-text fallback + no-throw on odd input), `__tests__/components/ui/AISummary.test.tsx` (renders markdown, collapses/expands on click, empty body renders nothing, default expanded).

---

## #3 — Per-rule initial-vs-final comparison on the Scorecard ("Rules" tab)

### Goal
Make it easy to compare each rule's **initial** pass/fail (pre-pipeline) against its **final** pass/fail (post-pipeline). Today the Scorecard shows only aggregate before→after (`baseline→final`, `+delta%`, `rules_passing/total`); viewing a past stage shows only the initial state.

### UX
Add a segmented **`Overview | Rules`** control to the Scorecard header.
- **Overview** = the current Scorecard (unchanged).
- **Rules** = a per-rule before→after table:

```
Quality Scorecard                         [ Overview | Rules ]
3 fixed · 1 regressed · 2 improved · 14 unchanged
-------------------------------------------------------------
Rule                  Initial        Final         Status
not_null(email)       ✗ 412 fail     ✓ 0 fail      Fixed
range(age, 0–120)     ✗ 88 fail      ✗ 12 fail     Improved
unique(id)            ✓ 0 fail       ✓ 0 fail      Unchanged
regex(phone)          ✓ 0 fail       ✗ 5 fail      Regressed
```

- Columns: rule (check + column, monospace), Initial (✗/✓ glyph + failure count), Final (✗/✓ + failure count), Status chip.
- **Status** derivation (per rule, from initial→final `passed` + `failure_count`):
  - `Fixed` — was failing, now passing.
  - `Regressed` — was passing, now failing.
  - `Improved` — still failing but failure_count decreased.
  - `Worsened` — still failing and failure_count increased.
  - `Unchanged` — passed→passed, or failing with same count.
- Status chip tones: Fixed=success, Regressed/Worsened=danger, Improved=warning/accent, Unchanged=neutral.
- Header summary line counts each status.
- Empty/fallback states:
  - No comparison data available (e.g. validate snapshot missing) → Rules tab shows a neutral message: "Per-rule comparison unavailable for this session." Overview still works.
  - Rule present initially but absent from final set → treat final = initial (no data to show a change).

### Data (backend, additive — no Temporal workflow change)
Extend the **scorecard endpoint** to compute and return a new field:

`backend/api/schemas.py`:
```python
class RuleComparisonEntry(BaseModel):
    id: str
    check: str
    column: str | None = None
    initial_passed: bool
    initial_failures: int
    final_passed: bool
    final_failures: int
    status: str  # "fixed" | "regressed" | "improved" | "worsened" | "unchanged"

class ScorecardResponse(BaseModel):
    ...
    rule_comparison: list[RuleComparisonEntry] = []
```

`backend/api/routers/pipeline.py` `get_scorecard`:
- **Initial per-rule:** read the persisted `validate` stage snapshot from the DB (`get_snapshot(db, sid, "validate")` → `payload["validation_results"]["per_rule"]`). The endpoint already has DB access patterns available (`get_sessionmaker`, as used by the snapshot endpoint).
- **Final per-rule:** derive from the scorecard's `transformation_log` — the last entry (chronologically) that has a non-empty `post_step_per_rule`. If no transform applied, final = initial.
- Build `rule_comparison` via a **pure helper** `build_rule_comparison(initial_per_rule, final_per_rule)` (new module, e.g. `backend/api/rule_comparison.py` or a function in the router module) that joins by rule `id` and computes `status`. Pure function → unit-tested directly.
- If the validate snapshot is missing → return `rule_comparison: []` (frontend shows the unavailable message).

### Frontend
- `frontend/lib/types.ts` — add `RuleComparisonEntry` + `rule_comparison` to `ScorecardResponse`.
- `frontend/components/stages/ScorecardStage.tsx` — add `view: 'overview' | 'rules'` state + segmented control; extract the current body into an Overview render; add a `RulesComparison` sub-view (can be a small component in the same file or `_scorecard/RuleComparisonTable.tsx`).
- Read-only/demo: the `readOnly` and `data` props continue to work; `rule_comparison` flows through the same `ScorecardResponse`.

### Files
- Backend create: `backend/api/rule_comparison.py` (pure helper) — or inline + a dedicated test.
- Backend modify: `backend/api/schemas.py`, `backend/api/routers/pipeline.py`.
- Backend test: `tests/backend/api/test_rule_comparison.py` (status derivation: fixed/regressed/improved/worsened/unchanged; rule present initially but missing finally; empty inputs).
- Frontend modify: `frontend/lib/types.ts`, `frontend/components/stages/ScorecardStage.tsx` (+ optional `_scorecard/RuleComparisonTable.tsx`).
- Frontend test: `__tests__/components/stages/ScorecardStage.test.tsx` — Overview/Rules toggle; Rules table renders rows + status chips from `rule_comparison`; unavailable message when `rule_comparison` empty.

---

## Cross-cutting

- **Testing:** jest for all frontend pieces; pytest for the `rule_comparison` helper. Full suites (`pytest`, `npx jest`) + `tsc --noEmit` + `next build` must stay green.
- **No regressions to live wiring:** all changes are additive or localized; the `demoMode`/`data`/`readOnly` props on the affected stages are preserved.
- **Scope:** one implementation plan; the three items are independent tasks and can land in separate commits.

## Out of scope
- Syntax highlighting inside markdown code fences (plain `<pre>` only).
- Full GFM (tables, task lists, footnotes) — add later via react-markdown if needed.
- Changing the Temporal workflow or how snapshots are written.
- Backfilling comparison data for sessions whose `validate` snapshot was never persisted.
