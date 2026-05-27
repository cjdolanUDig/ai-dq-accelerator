# UI Round 3 Improvements — Design Spec

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan

## Overview

Seven UI/UX improvements to the AI DQ Accelerator frontend, several requiring
small supporting backend changes. The items are largely independent and can ship
incrementally. Item #6 is intentionally scoped down to a height change; its larger
redesign is captured as a deferred follow-up.

The changes touch three areas:
- **AI Activity panel** (feed/terminal readability, false cutoffs, per-page filtering)
- **Code & rule presentation** (Python syntax contrast, descriptive rule titles)
- **Scorecard** (drill into a rule and inspect failing rows)

---

## #1 + #2 — Readable activity feed, no false cutoffs

### Problem
- The feed renders tool-call inputs as `JSON.stringify(input, null, 0)` with the
  outer braces stripped (`EventFeed.tsx`), producing fragments like `"n":10` that
  read as broken/incomplete.
- Tool **results** are pre-truncated at emit time to 80 chars, with each value
  capped at 25 chars (`deep_investigate.py:426`, `profile_analyzer.py:290-309`),
  so result cards always look severed.
- The Data Profile **AI summary** ends mid-sentence because
  `profile_analyzer.py:548` slices `data_passport[:1500]` when building `ai_summary`,
  even though the full passport is preserved in state.

### Approach
**Frontend (`EventFeed.tsx`):** Replace the raw `<pre>` body with a small
structured renderer:
- **Tool calls** → key/value rows. Arrays (e.g. `todos`) render as bullet lists;
  long SQL strings render in a code style. No braces, no single-line JSON.
- **Tool results** → a human one-liner derived from structured result metadata
  (e.g. `"10 sample rows returned"`, `"customerID · 70,000 rows · 0 nulls (0.0%)"`),
  with an **"expand"** affordance that reveals the full detail. Nothing is
  visually truncated mid-token.

**Backend (`emit.py` + emit call sites in `deep_investigate.py`,
`profile_analyzer.py`):** Stop hard-truncating result previews to 80 chars /
25-char values. Emit a structured `result_meta` instead — e.g. `row_count`, a few
key stats, and a capped-but-complete payload (cap by row/element count, not by a
mid-token character slice) — so the frontend can both summarize and expand without
anything looking cut off.

**Backend (`profile_analyzer.py:548`):** Stop slicing `data_passport[:1500]`. Use
the full passport already held in state. Other agents (validation, scorecard)
already return prose in full and need no change.

### Notes / risks
- Emitting fuller payloads increases SSE message size. Mitigation: cap result
  payloads by element count (e.g. first N rows / first N keys with full values)
  rather than streaming arbitrarily large results. Confirm payloads stay
  reasonable for the largest tools (e.g. `get_sample_rows`).

---

## #3 — Per-page activity, with an "All" toggle

### Problem
The activity feed is a flat list of all events for the whole run, which is
overwhelming after the pipeline completes. Events carry no pipeline-stage
identifier today (`emit.py` adds only `{ts, event, ...}`).

### Approach
**Backend:** Add a `stage` kwarg to `emit()`. Each graph passes the stage it serves:
- ProfileAnalyzer → `PROFILING`
- ValidationAnalyzer → `VALIDATING`
- TriageAgent → `TRIAGING`
- TransformationAdvisor → `TRANSFORMATION_LOOP`
- ScorecardNarrator → `GENERATING`

Events written to the JSONL log and SSE stream carry `stage`.

**Frontend (`AIPanel.tsx`):** Default to showing only events whose `stage`
matches the stage page currently being viewed. A compact **"This stage / All"**
toggle reveals the full run. Events without a `stage` (older sessions) fall back
to the "All" bucket so nothing disappears.

---

## #4 — Bolder, readable Python code

### Problem
`CodeBlock.tsx` uses `react-syntax-highlighter` with the `vscDarkPlus` theme; the
muted token colors are hard to read at 11px.

### Approach
**Frontend (`CodeBlock.tsx`):** Keep the dark background. Swap `vscDarkPlus` for a
higher-contrast theme (`oneDark`) and/or override token colors to brighter values
with `fontWeight: 600` on keywords and function names. Bump font-size 11px → 12px.

---

## #5 — Descriptive rule titles (frontend-derived)

### Problem
Rules display their raw `check` value (`not_null`, `unique`, `custom_sql`, etc.)
as the label, which is not human-friendly. (`check` is the rule type; `category`
is the quality dimension.)

### Approach
**Frontend:** Add a pure helper `ruleTitle(rule)` mapping `check` + fields to a
readable sentence. Full type coverage (from `dq_tools/rule_engine.py`):

| `check`              | Fields used      | Title                                       |
|----------------------|------------------|---------------------------------------------|
| `not_null`           | column           | "{Column} must not be empty"                |
| `unique`             | column           | "{Column} must be unique"                   |
| `regex_match`        | column, pattern  | "{Column} must match {pattern}"             |
| `value_in_set`       | column, values   | "{Column} must be one of {values}"          |
| `range`              | column, min, max | "{Column} must be between {min} and {max}"  |
| `date_format`        | column, format   | "{Column} must be a valid date ({format})"  |
| `cross_column_order` | col_a, col_b     | "{col_a} must be ≤ {col_b}"                  |
| `custom_sql`         | rationale        | "Custom check" + rationale                  |

Column names are humanized for display (e.g. `customerID` → "CustomerID").
Unknown `check` values fall back to the raw value. The title is used in
`RuleCard.tsx`, `RuleComparisonTable.tsx`, and the scorecard per-step rule list.
The raw `check` and other fields remain visible as secondary detail/description.

Chosen over backend LLM-generated names: instant, free, deterministic, no
regeneration churn.

---

## #6 — Taller notebook (height only)

### Problem
The Exploration notebook iframe is locked to `h-[520px]` in
`ExplorationStage.tsx:198`, which is cramped.

### Approach
**Frontend (`ExplorationStage.tsx`):** Change `h-[520px]` to a taller responsive
height (e.g. `h-[min(80vh,900px)]`) so it fills more of the viewport while leaving
room for the feedback textarea and action buttons below it.

### Deferred follow-up (not in this spec)
A larger redesign replacing the Jupyter iframe with a native, section-based,
agent-editable notebook:
- Each section (markdown + its associated code cell grouped together) editable
  independently or appendable below.
- Per-section caching so unmodified sections are **not** regenerated (no wasted
  code/markdown regeneration).
- Per-section agent interaction (e.g. "dive deeper here", "update knowledge")
  instead of one global text box.

This is a substantial task (section detection, cache keying, partial
regeneration, per-section chat) and deserves its own spec → plan cycle.

---

## #7 — Click into a Scorecard rule, see failing rows

### Problem
The scorecard rule comparison table is static. `sample_failing_rows` (up to 50
rows/rule) is already computed and persisted in `validation_results.json`
(`rule_engine.py:336-363`), but `build_rule_comparison()` drops it, and
`RuleComparisonEntry` does not include it.

### Approach
**Backend (`api/schemas.py`, `api/rule_comparison.py`):** Add `check`, `category`,
and `sample_failing_rows` (capped, e.g. first 20) to `RuleComparisonEntry`, and
pass them through in `build_rule_comparison()` (currently only id/check/column/
pass-fail/counts are carried forward).

**Frontend (`RuleComparisonTable.tsx`):** Make each row expandable inline
(matching the existing `TransformRow` expand pattern in `ScorecardStage.tsx`).
Expanded view shows: the friendly `ruleTitle`, the `check` definition, and a small
scrollable table of sample failing rows when `final_failures > 0`.

---

## Testing

TDD throughout.

- **Jest (frontend):**
  - structured feed renderer (tool call key/values, array/SQL formatting, result
    summary + expand)
  - `ruleTitle()` helper across all `check` types incl. unknown fallback
  - per-page activity filter + "All" toggle (incl. missing-`stage` fallback)
  - scorecard row expand + failing-rows table rendering
- **pytest (backend):**
  - `emit()` includes `stage`; each graph passes the correct stage
  - structured `result_meta` emitted (no mid-token truncation)
  - `data_passport` returned in full (no `[:1500]` slice)
  - `build_rule_comparison()` passes through `check`, `category`,
    `sample_failing_rows`

## Out of scope

- The full section-based notebook redesign (#6 follow-up above).
- Any change to the terminal view beyond what the shared event renderer provides.
