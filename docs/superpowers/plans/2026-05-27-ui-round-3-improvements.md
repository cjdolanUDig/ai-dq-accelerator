# UI Round 3 Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI activity feed readable (no raw/severed JSON), stop AI summaries from being cut off, scope activity per stage, brighten Python code, give rules human titles, enlarge the notebook, and let users drill into scorecard rules to see failing rows.

**Architecture:** Mostly frontend display logic backed by small backend data-availability fixes. Backend stops three lossy operations (a 1500-char summary slice, an 80-char result-preview truncation, and a `sample_failing_rows` strip) and tags streamed events with the originating stage. Frontend adds pure formatting helpers (`eventFormat.ts`, `ruleTitle`), a structured feed renderer, a per-stage activity filter, expandable scorecard rows, a brighter code theme, and a taller notebook.

**Tech Stack:** Next.js (client components) + React + TypeScript + Jest/RTL (frontend); FastAPI + Temporal + LangGraph + pytest (backend). `react-syntax-highlighter` for code.

**Spec:** `docs/superpowers/specs/2026-05-27-ui-round-3-improvements-design.md`

> **Environment note:** `frontend/AGENTS.md` warns this is a non-standard Next.js. None of these tasks touch Next.js routing/server APIs — they are client React components, pure TS helpers, and Python. No `node_modules/next/dist/docs/` reading required.

> **Test commands:**
> - Frontend: `cd frontend && npx jest <path>` ; full check `npx jest && npx tsc --noEmit`
> - Backend: `uv run pytest tests/backend/<path> -v` — **MUST use `uv run`**; the bare `pytest` resolves to a broken Anaconda env (langchain_core mismatch). Backend tests live under `tests/backend/`.

---

## File Structure

**Backend — created:**
- (none; all modifications)

**Backend — modified:**
- `backend/agents/emit.py` — add optional kw-only `stage` to `emit()`; add pure `cap_result()` helper.
- `backend/agents/graphs/profile_analyzer.py` — remove `[:1500]` summary slice; stage-tag emits; emit structured `result`.
- `backend/agents/graphs/deep_investigate.py` — stage-tag emits; emit structured `result` (parse tool content).
- `backend/agents/graphs/{deep_rule_review,validation_analyzer,triage_agent,deep_plan,transform_planner,transformation_advisor,custom_code_generator,scorecard_narrator}.py` — stage-tag emits (wrapper pattern).
- `backend/temporal/workflows/dq_workflow.py` — keep capped `sample_failing_rows` in `post_step_per_rule`.
- `backend/api/rule_comparison.py` — pass `final_sample_failing_rows` (+ category) through.
- `backend/api/schemas.py` — add fields to `RuleComparisonEntry`.

**Frontend — created:**
- `frontend/lib/eventFormat.ts` — pure formatters for tool-call inputs and tool results.
- `frontend/lib/ruleTitle.ts` — pure `ruleTitle()` + `humanizeColumn()`.
- `frontend/components/ai-panel/_feed/ToolInputView.tsx` — renders structured key/value input.
- `frontend/components/ai-panel/_feed/ResultView.tsx` — result summary + expandable detail.
- `frontend/components/stages/CodeBlock.theme.ts` — brightened syntax theme.

**Frontend — modified:**
- `frontend/lib/types.ts` — extend `RuleComparisonEntry`.
- `frontend/components/ai-panel/EventFeed.tsx` — use structured views.
- `frontend/components/ai-panel/AIPanel.tsx` — per-stage filter + toggle; new `viewingStage` prop.
- `frontend/app/sessions/[id]/page.tsx` — pass `displayStage` to `AIPanel`.
- `frontend/components/stages/CodeBlock.tsx` — use brightened theme + 12px.
- `frontend/components/rules/RuleCard.tsx` — show `ruleTitle` as primary label.
- `frontend/components/stages/_scorecard/RuleComparisonTable.tsx` — `ruleTitle` + expandable failing-rows.
- `frontend/components/stages/ExplorationStage.tsx` — taller notebook.

---

# PART A — Backend data fixes

## Task A1: Stop slicing the Data Profile AI summary (#2)

**Files:**
- Modify: `backend/agents/graphs/profile_analyzer.py:548`
- Test: `tests/backend/agents/test_profile_summary_full.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/agents/test_profile_summary_full.py
"""The propose_rules node must not truncate the data passport in ai_summary."""


def test_ai_summary_keeps_full_passport():
    from backend.agents.graphs import profile_analyzer

    # build a passport longer than the old 1500-char cap
    long_passport = "A" + ("x" * 4000) + "Z"
    state = {
        "overview_notes": "OVERVIEW",
        "data_passport": long_passport,
    }
    # _assemble_ai_summary is the extracted pure helper (Step 3)
    summary = profile_analyzer._assemble_ai_summary(state)

    assert summary.startswith("OVERVIEW")
    assert summary.endswith("Z")            # tail not chopped
    assert long_passport in summary          # full passport present
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/backend/agents/test_profile_summary_full.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_assemble_ai_summary'`

- [ ] **Step 3: Extract a pure helper and drop the slice**

In `backend/agents/graphs/profile_analyzer.py`, add near the other module helpers:

```python
def _assemble_ai_summary(state: dict) -> str:
    """Combine overview notes with the FULL data passport (no truncation)."""
    overview = state.get("overview_notes", "") or ""
    passport = state.get("data_passport", "") or ""
    return f"{overview}\n\n{passport}" if passport else overview
```

Then replace line 548:

```python
    ai_summary = state["overview_notes"] + "\n\n" + state["data_passport"][:1500]
```

with:

```python
    ai_summary = _assemble_ai_summary(state)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/backend/agents/test_profile_summary_full.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/profile_analyzer.py tests/backend/agents/test_profile_summary_full.py
git commit -m "fix(profile): stop truncating data passport in AI summary"
```

---

## Task A2: `cap_result()` helper + `stage` param on `emit()` (#1, #2, #3)

**Files:**
- Modify: `backend/agents/emit.py`
- Test: `tests/backend/agents/test_emit.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/agents/test_emit.py
import json

from backend.agents.emit import cap_result, emit


def test_cap_result_limits_list_length():
    out = cap_result(list(range(200)), max_items=50)
    assert out == list(range(50))


def test_cap_result_caps_nested_list_values_in_dict():
    src = {"total_rows": 70000, "sample": list(range(100))}
    out = cap_result(src, max_items=10)
    assert out["total_rows"] == 70000
    assert out["sample"] == list(range(10))


def test_cap_result_truncates_long_strings():
    out = cap_result("y" * 5000, max_str=100)
    assert out.endswith("…")
    assert len(out) == 101  # 100 chars + ellipsis


def test_cap_result_passes_through_scalars():
    assert cap_result(5) == 5
    assert cap_result(None) is None
    assert cap_result(True) is True


def test_emit_includes_stage_when_provided(tmp_path, monkeypatch):
    import backend.agents.emit as emit_mod

    monkeypatch.setattr(emit_mod, "_find_project_root", lambda: tmp_path)
    emit("sess-1", "tool_call", stage="profile", tool="dq_profile")

    line = (tmp_path / "data" / "sessions" / "sess-1" / "investigation_progress.jsonl").read_text().strip()
    payload = json.loads(line)
    assert payload["stage"] == "profile"
    assert payload["event"] == "tool_call"
    assert payload["tool"] == "dq_profile"


def test_emit_omits_stage_when_absent(tmp_path, monkeypatch):
    import backend.agents.emit as emit_mod

    monkeypatch.setattr(emit_mod, "_find_project_root", lambda: tmp_path)
    emit("sess-2", "done")

    line = (tmp_path / "data" / "sessions" / "sess-2" / "investigation_progress.jsonl").read_text().strip()
    payload = json.loads(line)
    assert "stage" not in payload
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/backend/agents/test_emit.py -v`
Expected: FAIL — `ImportError: cannot import name 'cap_result'`

- [ ] **Step 3: Implement in `backend/agents/emit.py`**

Add the helper above `emit`:

```python
def cap_result(value, max_items: int = 50, max_str: int = 2000):
    """Bound a tool result for streaming: cap list lengths and string sizes,
    recursing into nested lists/dicts. Never slices mid-structure in a way that
    loses whole values — it limits element COUNT, not characters within a value
    (except oversized standalone strings, which get an explicit ellipsis)."""
    if isinstance(value, list):
        return [cap_result(v, max_items, max_str) for v in value[:max_items]]
    if isinstance(value, dict):
        return {k: cap_result(v, max_items, max_str) for k, v in value.items()}
    if isinstance(value, str):
        return value if len(value) <= max_str else value[:max_str] + "…"
    return value
```

Change the `emit` signature to accept a kw-only `stage`:

```python
def emit(session_id: str, event: str, *, stage: str | None = None, **kwargs) -> None:
    """Append a progress event to data/sessions/{session_id}/investigation_progress.jsonl."""
    payload = {"ts": datetime.now(timezone.utc).isoformat(), "event": event}
    if stage is not None:
        payload["stage"] = stage
    payload.update(kwargs)
    try:
        path = _find_project_root() / "data" / "sessions" / session_id / "investigation_progress.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(payload, default=str) + "\n")
    except Exception:
        pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/backend/agents/test_emit.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/agents/emit.py tests/backend/agents/test_emit.py
git commit -m "feat(emit): add cap_result helper and optional stage tag"
```

---

## Task A3: Emit structured (capped) tool results instead of 80-char previews (#1, #2)

**Files:**
- Modify: `backend/agents/graphs/profile_analyzer.py:286-311`
- Modify: `backend/agents/graphs/deep_investigate.py:418-427`
- Test: `tests/backend/agents/test_emit_structured_result.py` (create)

> Both emit sites currently send only a lossy `preview` string. We add a full,
> capped `result` field (the frontend prefers it and derives its own summary;
> `preview` stays for backward compatibility). `deep_investigate` tool content is
> a string, so we parse JSON when possible.

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/agents/test_emit_structured_result.py
from backend.agents.graphs.deep_investigate import _result_payload


def test_result_payload_parses_json_string():
    payload = _result_payload('{"total_rows": 70000, "null_count": 0}')
    assert payload == {"total_rows": 70000, "null_count": 0}


def test_result_payload_caps_parsed_list():
    raw = "[" + ",".join("0" for _ in range(200)) + "]"
    payload = _result_payload(raw)
    assert isinstance(payload, list)
    assert len(payload) == 50  # capped by cap_result default


def test_result_payload_passthrough_non_json_string():
    payload = _result_payload("not json at all")
    assert payload == "not json at all"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/backend/agents/test_emit_structured_result.py -v`
Expected: FAIL — `ImportError: cannot import name '_result_payload'`

- [ ] **Step 3a: `deep_investigate.py` — add helper + structured emit**

At the top of `backend/agents/graphs/deep_investigate.py`, update the emit import and add a helper:

```python
from backend.agents.emit import _find_project_root
from backend.agents.emit import emit as _emit_raw, cap_result
import json as _json


_STAGE = "explore"


def _emit(session_id: str, event: str, **kw) -> None:
    _emit_raw(session_id, event, stage=_STAGE, **kw)


def _result_payload(content):
    """Best-effort: parse JSON tool content into structured data, else return the
    raw string. Always capped for streaming."""
    if isinstance(content, str):
        try:
            return cap_result(_json.loads(content))
        except (ValueError, TypeError):
            return cap_result(content)
    return cap_result(content)
```

Then change the `tool_result` emit (lines 422-427) to:

```python
                elif isinstance(msg, ToolMessage):
                    content = getattr(msg, "content", "")
                    _emit(
                        session_id,
                        "tool_result",
                        tool=getattr(msg, "name", "unknown"),
                        preview=str(content)[:80],
                        result=_result_payload(content),
                    )
```

> The existing `from backend.agents.emit import emit as _emit` (line 25) is now
> replaced by the wrapper above — delete the old line 25 import.

- [ ] **Step 3b: `profile_analyzer.py` — structured emit + stage wrapper**

In `backend/agents/graphs/profile_analyzer.py`, replace the import (line 16):

```python
from backend.agents.emit import emit as _emit, _find_project_root
```

with:

```python
from backend.agents.emit import emit as _emit_raw, _find_project_root, cap_result


_STAGE = "profile"


def _emit(session_id: str, event: str, **kw) -> None:
    _emit_raw(session_id, event, stage=_STAGE, **kw)
```

Then change the `tool_result` emit (line 311) to include the structured result:

```python
            _emit(session_id, "tool_result", tool=block.name, preview=preview, result=cap_result(result))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/backend/agents/test_emit_structured_result.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/deep_investigate.py backend/agents/graphs/profile_analyzer.py tests/backend/agents/test_emit_structured_result.py
git commit -m "feat(agents): emit full capped tool results for the activity feed"
```

---

## Task A4: Stage-tag the remaining graphs (#3)

**Files:**
- Modify: `backend/agents/graphs/deep_rule_review.py`
- Modify: `backend/agents/graphs/validation_analyzer.py`
- Modify: `backend/agents/graphs/triage_agent.py`
- Modify: `backend/agents/graphs/deep_plan.py`
- Modify: `backend/agents/graphs/transform_planner.py`
- Modify: `backend/agents/graphs/transformation_advisor.py`
- Modify: `backend/agents/graphs/custom_code_generator.py`
- Modify: `backend/agents/graphs/scorecard_narrator.py`
- Test: `tests/backend/agents/test_graph_stage_tags.py` (create)

> Each graph maps to exactly one frontend stage id. Apply the SAME wrapper
> pattern in every file: import the raw emit, define `_STAGE`, define a local
> wrapper, and route all existing emit calls through it. **Call sites stay
> unchanged** — only the import line + wrapper differ per file. The local
> wrapper name must match what the file already calls (`emit` or `_emit`).

Per-file table:

| File | `_STAGE` | Local wrapper name | Current import to replace |
|------|----------|--------------------|---------------------------|
| `deep_rule_review.py` | `"rules"` | `_emit` | `from backend.agents.emit import emit as _emit` |
| `validation_analyzer.py` | `"validate"` | `emit` | `from backend.agents.emit import emit` |
| `triage_agent.py` | `"triage"` | `_emit` | `from backend.agents.emit import emit as _emit` |
| `deep_plan.py` | `"plan"` | `_emit` | `from backend.agents.emit import _find_project_root, emit as _emit` |
| `transform_planner.py` | `"plan"` | `emit` | `from backend.agents.emit import emit` |
| `transformation_advisor.py` | `"transform"` | `emit` | `from backend.agents.emit import emit` |
| `custom_code_generator.py` | `"transform"` | `emit` | `from backend.agents.emit import emit` |
| `scorecard_narrator.py` | `"scorecard"` | `emit` | `from backend.agents.emit import emit` |

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/agents/test_graph_stage_tags.py
"""Each graph module must tag emitted events with its frontend stage id."""
import json

import pytest

CASES = [
    ("backend.agents.graphs.deep_rule_review", "_emit", "rules"),
    ("backend.agents.graphs.validation_analyzer", "emit", "validate"),
    ("backend.agents.graphs.triage_agent", "_emit", "triage"),
    ("backend.agents.graphs.deep_plan", "_emit", "plan"),
    ("backend.agents.graphs.transform_planner", "emit", "plan"),
    ("backend.agents.graphs.transformation_advisor", "emit", "transform"),
    ("backend.agents.graphs.custom_code_generator", "emit", "transform"),
    ("backend.agents.graphs.scorecard_narrator", "emit", "scorecard"),
]


@pytest.mark.parametrize("module_path, fn_name, expected_stage", CASES)
def test_graph_emit_wrapper_tags_stage(module_path, fn_name, expected_stage, tmp_path, monkeypatch):
    import importlib

    import backend.agents.emit as emit_mod

    monkeypatch.setattr(emit_mod, "_find_project_root", lambda: tmp_path)
    mod = importlib.import_module(module_path)
    wrapper = getattr(mod, fn_name)
    wrapper("sess-x", "thinking", text="hello")

    line = (tmp_path / "data" / "sessions" / "sess-x" / "investigation_progress.jsonl").read_text().strip()
    assert json.loads(line)["stage"] == expected_stage
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/backend/agents/test_graph_stage_tags.py -v`
Expected: FAIL — emitted payloads have no `stage` key (KeyError).

- [ ] **Step 3: Apply the wrapper in each file**

For a file whose existing calls use `_emit` (e.g. `deep_rule_review.py`), replace its import line with:

```python
from backend.agents.emit import emit as _emit_raw

_STAGE = "rules"


def _emit(session_id: str, event: str, **kw) -> None:
    _emit_raw(session_id, event, stage=_STAGE, **kw)
```

For a file whose existing calls use `emit` (e.g. `validation_analyzer.py`), replace its import line with:

```python
from backend.agents.emit import emit as _emit_raw

_STAGE = "validate"


def emit(session_id: str, event: str, **kw) -> None:
    _emit_raw(session_id, event, stage=_STAGE, **kw)
```

Repeat for every row in the table, substituting `_STAGE` and the wrapper name.
For `deep_plan.py`, preserve the `_find_project_root` import it also needs:

```python
from backend.agents.emit import _find_project_root, emit as _emit_raw

_STAGE = "plan"


def _emit(session_id: str, event: str, **kw) -> None:
    _emit_raw(session_id, event, stage=_STAGE, **kw)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/backend/agents/test_graph_stage_tags.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/agents/graphs/*.py tests/backend/agents/test_graph_stage_tags.py
git commit -m "feat(agents): tag streamed events with their pipeline stage"
```

---

## Task A5: Keep capped failing-row samples in final per-rule state (#7 backend)

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py:1005-1008`
- Modify: `backend/api/rule_comparison.py:53-62`
- Modify: `backend/api/schemas.py:297-305`
- Test: `tests/backend/api/test_rule_comparison_failing_rows.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/api/test_rule_comparison_failing_rows.py
from backend.api.rule_comparison import build_rule_comparison


def test_comparison_carries_final_failing_rows_and_category():
    initial = [{"id": "r1", "check": "not_null", "column": "email",
                "category": "completeness", "passed": False, "failure_count": 12}]
    final = [{"id": "r1", "check": "not_null", "column": "email",
              "category": "completeness", "passed": False, "failure_count": 3,
              "sample_failing_rows": [{"email": None, "id": 7}]}]

    out = build_rule_comparison(initial, final)
    assert len(out) == 1
    row = out[0]
    assert row["category"] == "completeness"
    assert row["final_failures"] == 3
    assert row["final_sample_failing_rows"] == [{"email": None, "id": 7}]


def test_comparison_defaults_empty_failing_rows_when_absent():
    initial = [{"id": "r1", "check": "unique", "column": "cid", "passed": True, "failure_count": 0}]
    out = build_rule_comparison(initial, initial)
    assert out[0]["final_sample_failing_rows"] == []
    assert out[0]["category"] == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/backend/api/test_rule_comparison_failing_rows.py -v`
Expected: FAIL — `KeyError: 'final_sample_failing_rows'`

- [ ] **Step 3a: `build_rule_comparison` pass-through**

In `backend/api/rule_comparison.py`, replace the `out.append({...})` block (lines 53-62) with:

```python
        out.append({
            "id": rid,
            "check": r.get("check", ""),
            "column": r.get("column"),
            "category": r.get("category", "") or "",
            "initial_passed": init_passed,
            "initial_failures": init_fail,
            "final_passed": final_passed,
            "final_failures": final_fail,
            "final_sample_failing_rows": list(fin.get("sample_failing_rows") or [])[:20],
            "status": _status(init_passed, init_fail, final_passed, final_fail),
        })
```

- [ ] **Step 3b: Keep capped samples in the workflow log**

In `backend/temporal/workflows/dq_workflow.py`, replace lines 1005-1008:

```python
            # Capture per-rule state after this step (truncate sample rows to save space)
            post_step_per_rule = [
                {k: v for k, v in r.items() if k != "sample_failing_rows"} for r in new_per_rule
            ]
```

with:

```python
            # Capture per-rule state after this step. Keep a CAPPED sample of
            # failing rows (≤20) so the scorecard can show what is still failing.
            post_step_per_rule = [
                {**r, "sample_failing_rows": list(r.get("sample_failing_rows") or [])[:20]}
                for r in new_per_rule
            ]
```

- [ ] **Step 3c: Extend the API schema**

In `backend/api/schemas.py`, replace the `RuleComparisonEntry` class (lines 297-305) with:

```python
class RuleComparisonEntry(BaseModel):
    id: str
    check: str = ""
    column: str | None = None
    category: str = ""
    initial_passed: bool
    initial_failures: int
    final_passed: bool
    final_failures: int
    final_sample_failing_rows: list[dict] = []
    status: str  # fixed | regressed | improved | worsened | unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/backend/api/test_rule_comparison_failing_rows.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/temporal/workflows/dq_workflow.py backend/api/rule_comparison.py backend/api/schemas.py tests/backend/api/test_rule_comparison_failing_rows.py
git commit -m "feat(scorecard): carry capped failing-row samples to rule comparison"
```

---

# PART B — Frontend helpers (pure)

## Task B1: `ruleTitle()` + `humanizeColumn()` (#5)

**Files:**
- Create: `frontend/lib/ruleTitle.ts`
- Test: `frontend/__tests__/lib/ruleTitle.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/__tests__/lib/ruleTitle.test.ts
import { ruleTitle, humanizeColumn } from '@/lib/ruleTitle'

describe('humanizeColumn', () => {
  it('capitalizes first letter of camelCase', () => {
    expect(humanizeColumn('customerID')).toBe('CustomerID')
  })
  it('title-cases snake_case', () => {
    expect(humanizeColumn('total_charges')).toBe('Total Charges')
  })
  it('returns empty string for undefined', () => {
    expect(humanizeColumn(undefined)).toBe('')
  })
})

describe('ruleTitle', () => {
  it('not_null', () => {
    expect(ruleTitle({ check: 'not_null', column: 'email' })).toBe('Email must not be empty')
  })
  it('unique', () => {
    expect(ruleTitle({ check: 'unique', column: 'customerID' })).toBe('CustomerID must be unique')
  })
  it('regex_match', () => {
    expect(ruleTitle({ check: 'regex_match', column: 'email', pattern: '^.+@.+$' }))
      .toBe('Email must match ^.+@.+$')
  })
  it('value_in_set', () => {
    expect(ruleTitle({ check: 'value_in_set', column: 'gender', values: ['Male', 'Female'] }))
      .toBe('Gender must be one of Male, Female')
  })
  it('range with min and max', () => {
    expect(ruleTitle({ check: 'range', column: 'age', min: 0, max: 120 }))
      .toBe('Age must be between 0 and 120')
  })
  it('range with only min', () => {
    expect(ruleTitle({ check: 'range', column: 'age', min: 0 })).toBe('Age must be at least 0')
  })
  it('range with only max', () => {
    expect(ruleTitle({ check: 'range', column: 'age', max: 120 })).toBe('Age must be at most 120')
  })
  it('date_format', () => {
    expect(ruleTitle({ check: 'date_format', column: 'dob', format: 'YYYY-MM-DD' }))
      .toBe('Dob must be a valid date (YYYY-MM-DD)')
  })
  it('cross_column_order', () => {
    expect(ruleTitle({ check: 'cross_column_order', col_a: 'start', col_b: 'end' }))
      .toBe('start must be ≤ end')
  })
  it('custom_sql with rationale', () => {
    expect(ruleTitle({ check: 'custom_sql', rationale: 'TotalCharges parses as number' }))
      .toBe('Custom check: TotalCharges parses as number')
  })
  it('custom_sql without rationale', () => {
    expect(ruleTitle({ check: 'custom_sql' })).toBe('Custom check')
  })
  it('falls back to raw check for unknown type', () => {
    expect(ruleTitle({ check: 'some_future_check', column: 'x' })).toBe('some_future_check')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/lib/ruleTitle.test.ts`
Expected: FAIL — cannot find module `@/lib/ruleTitle`

- [ ] **Step 3: Implement `frontend/lib/ruleTitle.ts`**

```typescript
// frontend/lib/ruleTitle.ts
// Pure helpers to turn a rule's raw `check` type into a human-readable title.

/** A minimal rule shape — works for both Rule and RuleComparisonEntry. */
export interface RuleLike {
  check?: string
  column?: string
  pattern?: string
  values?: unknown[]
  min?: number
  max?: number
  format?: string
  col_a?: string
  col_b?: string
  rationale?: string
}

/** "customerID" -> "CustomerID"; "total_charges" -> "Total Charges". */
export function humanizeColumn(col?: string): string {
  if (!col) return ''
  const spaced = col.replace(/[_-]+/g, ' ').trim()
  if (spaced.includes(' ')) {
    return spaced.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function rangeTitle(col: string, min?: number, max?: number): string {
  if (min != null && max != null) return `${col} must be between ${min} and ${max}`
  if (min != null) return `${col} must be at least ${min}`
  if (max != null) return `${col} must be at most ${max}`
  return `${col} must be within range`
}

export function ruleTitle(rule: RuleLike): string {
  const col = humanizeColumn(rule.column)
  switch (rule.check) {
    case 'not_null':
      return `${col} must not be empty`
    case 'unique':
      return `${col} must be unique`
    case 'regex_match':
      return `${col} must match ${rule.pattern ?? 'a pattern'}`
    case 'value_in_set':
      return `${col} must be one of ${(rule.values ?? []).join(', ')}`
    case 'range':
      return rangeTitle(col, rule.min, rule.max)
    case 'date_format':
      return `${col} must be a valid date (${rule.format ?? ''})`
    case 'cross_column_order':
      return `${rule.col_a} must be ≤ ${rule.col_b}`
    case 'custom_sql':
      return rule.rationale ? `Custom check: ${rule.rationale}` : 'Custom check'
    default:
      return rule.check ?? ''
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/lib/ruleTitle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/ruleTitle.ts frontend/__tests__/lib/ruleTitle.test.ts
git commit -m "feat(frontend): ruleTitle helper for human-readable rule names"
```

---

## Task B2: `eventFormat.ts` — structured input + result summary (#1, #2)

**Files:**
- Create: `frontend/lib/eventFormat.ts`
- Test: `frontend/__tests__/lib/eventFormat.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/__tests__/lib/eventFormat.test.ts
import { formatToolInput, summarizeResult, resultDetail } from '@/lib/eventFormat'

describe('formatToolInput', () => {
  it('returns key/value rows for a flat object', () => {
    expect(formatToolInput({ column: 'customerID', top_n: 5 })).toEqual([
      { key: 'column', value: 'customerID', kind: 'text' },
      { key: 'top_n', value: '5', kind: 'text' },
    ])
  })
  it('renders arrays as list kind, one item per line', () => {
    const out = formatToolInput({ todos: ['Get sample', 'Get schema'] })
    expect(out[0]).toEqual({ key: 'todos', value: 'Get sample\nGet schema', kind: 'list' })
  })
  it('detects SQL strings as code kind', () => {
    const out = formatToolInput({ query: 'SELECT * FROM working_data WHERE x IS NULL' })
    expect(out[0].kind).toBe('code')
  })
  it('returns empty array for non-object input', () => {
    expect(formatToolInput(undefined)).toEqual([])
    expect(formatToolInput('nope')).toEqual([])
  })
})

describe('summarizeResult', () => {
  it('summarizes an array as a row count', () => {
    expect(summarizeResult({ event: 'tool_result', result: [1, 2, 3] })).toBe('3 rows returned')
  })
  it('summarizes 1 row without pluralizing', () => {
    expect(summarizeResult({ event: 'tool_result', result: [1] })).toBe('1 row returned')
  })
  it('summarizes value-count style dicts', () => {
    expect(
      summarizeResult({ event: 'tool_result', result: { total_rows: 70000, null_count: 0 } }),
    ).toBe('70,000 rows · 0 nulls')
  })
  it('surfaces errors', () => {
    expect(summarizeResult({ event: 'tool_result', result: { error: 'boom' } })).toBe('Error: boom')
  })
  it('falls back to preview when no structured result', () => {
    expect(summarizeResult({ event: 'tool_result', preview: 'legacy text' })).toBe('legacy text')
  })
})

describe('resultDetail', () => {
  it('builds a table from a list of row objects', () => {
    const d = resultDetail({ event: 'tool_result', result: [{ a: 1, b: 2 }, { a: 3, b: 4 }] })
    expect(d).toEqual({ kind: 'table', columns: ['a', 'b'], rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }] })
  })
  it('builds key/value entries from a dict', () => {
    const d = resultDetail({ event: 'tool_result', result: { total_rows: 5 } })
    expect(d).toEqual({ kind: 'kv', entries: [{ key: 'total_rows', value: '5' }] })
  })
  it('returns null when there is no structured result', () => {
    expect(resultDetail({ event: 'tool_result', preview: 'x' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/lib/eventFormat.test.ts`
Expected: FAIL — cannot find module `@/lib/eventFormat`

- [ ] **Step 3: Implement `frontend/lib/eventFormat.ts`**

```typescript
// frontend/lib/eventFormat.ts
// Pure formatters that turn raw AI event payloads into display-ready structures.
import type { AIEvent } from '@/hooks/useAIStream'

const SQL_RE = /\b(select|from|where|join|group\s+by|order\s+by|case\s+when|coalesce|cast)\b/i

export type InputKind = 'text' | 'list' | 'code'
export interface InputRow {
  key: string
  value: string
  kind: InputKind
}

function scalar(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function formatToolInput(input: unknown): InputRow[] {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return []
  return Object.entries(input as Record<string, unknown>).map(([key, v]) => {
    if (Array.isArray(v)) {
      return { key, value: v.map(scalar).join('\n'), kind: 'list' as const }
    }
    if (typeof v === 'string' && SQL_RE.test(v)) {
      return { key, value: v, kind: 'code' as const }
    }
    return { key, value: scalar(v), kind: 'text' as const }
  })
}

function resultValue(ev: AIEvent): unknown {
  return 'result' in ev ? (ev as Record<string, unknown>).result : undefined
}

export function summarizeResult(ev: AIEvent): string {
  const r = resultValue(ev)
  if (r === undefined) return 'preview' in ev ? String((ev as Record<string, unknown>).preview) : ''
  if (Array.isArray(r)) return `${r.length} row${r.length === 1 ? '' : 's'} returned`
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>
    if ('error' in o) return `Error: ${String(o.error)}`
    const parts: string[] = []
    if ('total_rows' in o) parts.push(`${Number(o.total_rows).toLocaleString()} rows`)
    if ('null_count' in o) parts.push(`${Number(o.null_count).toLocaleString()} nulls`)
    if (parts.length) return parts.join(' · ')
    return `${Object.keys(o).length} field${Object.keys(o).length === 1 ? '' : 's'}`
  }
  return String(r)
}

export type ResultDetail =
  | { kind: 'table'; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: 'kv'; entries: { key: string; value: string }[] }
  | null

export function resultDetail(ev: AIEvent): ResultDetail {
  const r = resultValue(ev)
  if (Array.isArray(r) && r.length > 0 && typeof r[0] === 'object' && r[0] !== null) {
    const rows = r as Record<string, unknown>[]
    return { kind: 'table', columns: Object.keys(rows[0]), rows }
  }
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    return {
      kind: 'kv',
      entries: Object.entries(r as Record<string, unknown>).map(([key, v]) => ({ key, value: scalar(v) })),
    }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/lib/eventFormat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/eventFormat.ts frontend/__tests__/lib/eventFormat.test.ts
git commit -m "feat(frontend): pure formatters for activity-feed events"
```

---

# PART C — Frontend rendering

## Task C1: Structured input + result views in the feed (#1, #2)

**Files:**
- Create: `frontend/components/ai-panel/_feed/ToolInputView.tsx`
- Create: `frontend/components/ai-panel/_feed/ResultView.tsx`
- Modify: `frontend/components/ai-panel/EventFeed.tsx:23-56`
- Test: `frontend/__tests__/ui/EventFeed.test.tsx` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `frontend/__tests__/ui/EventFeed.test.tsx`. **Keep existing tests, but if any legacy assertion expects raw stripped-brace JSON in a tool-call body (e.g. matching `"column":`), replace it with the structured expectations below — the old JSON rendering is intentionally gone.**

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { EventFeed } from '@/components/ai-panel/EventFeed'

describe('EventFeed structured rendering', () => {
  it('renders tool-call inputs as key/value rows, not raw JSON', () => {
    render(<EventFeed events={[{ event: 'tool_call', ts: 1, tool: 'dq_get_value_counts', input: { column: 'customerID', top_n: 5 } }]} />)
    expect(screen.getByText('column')).toBeInTheDocument()
    expect(screen.getByText('customerID')).toBeInTheDocument()
    expect(screen.getByText('top_n')).toBeInTheDocument()
    // no stripped-brace JSON fragment
    expect(screen.queryByText(/"column":/)).not.toBeInTheDocument()
  })

  it('summarizes a structured result and expands to detail on click', () => {
    render(
      <EventFeed
        events={[{ event: 'tool_result', ts: 2, tool: 'dq_get_value_counts', result: { total_rows: 70000, null_count: 0 } }]}
      />,
    )
    expect(screen.getByText('70,000 rows · 0 nulls')).toBeInTheDocument()
    // detail hidden until expanded
    expect(screen.queryByText('total_rows')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(screen.getByText('total_rows')).toBeInTheDocument()
  })

  it('falls back to preview text for legacy events without result', () => {
    render(<EventFeed events={[{ event: 'tool_result', ts: 3, tool: 'old_tool', preview: 'legacy preview' }]} />)
    expect(screen.getByText('legacy preview')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/ui/EventFeed.test.tsx`
Expected: FAIL — key/value text not found (still raw JSON); no expand button.

- [ ] **Step 3a: Create `ToolInputView.tsx`**

```typescript
// frontend/components/ai-panel/_feed/ToolInputView.tsx
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
```

- [ ] **Step 3b: Create `ResultView.tsx`**

```typescript
// frontend/components/ai-panel/_feed/ResultView.tsx
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AIEvent } from '@/hooks/useAIStream'
import { summarizeResult, resultDetail } from '@/lib/eventFormat'

export function ResultView({ event }: { event: AIEvent }) {
  const [open, setOpen] = useState(false)
  const summary = summarizeResult(event)
  const detail = resultDetail(event)
  if (!summary && !detail) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {detail && (
          <button
            type="button"
            aria-label={open ? 'collapse result' : 'expand result'}
            onClick={() => setOpen((v) => !v)}
            className="text-fg-subtle hover:text-fg shrink-0"
          >
            {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
          </button>
        )}
        <span className="text-xs text-fg-muted break-words">{summary}</span>
      </div>
      {open && detail?.kind === 'kv' && (
        <div className="flex flex-col gap-0.5 pl-4">
          {detail.entries.map(({ key, value }) => (
            <div key={key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-2 text-xs">
              <span className="font-mono text-fg-subtle truncate">{key}</span>
              <span className="font-mono text-fg break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
      {open && detail?.kind === 'table' && (
        <div className="pl-4 overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                {detail.columns.map((c) => (
                  <th key={c} className="text-left font-semibold text-fg-subtle px-2 py-0.5 border-b border-border">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row, i) => (
                <tr key={i}>
                  {detail.columns.map((c) => (
                    <td key={c} className="px-2 py-0.5 font-mono text-fg-muted whitespace-nowrap">
                      {row[c] === null || row[c] === undefined ? '—' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3c: Wire into `EventFeed.tsx`**

Add imports near the top of `frontend/components/ai-panel/EventFeed.tsx`:

```typescript
import { ToolInputView } from './_feed/ToolInputView'
import { ResultView } from './_feed/ResultView'
```

Replace `ToolCallCard` (lines 23-42) body — drop the JSON `body` logic:

```typescript
function ToolCallCard({ event: ev, highlighted }: CardProps) {
  return (
    <div className={[cardBase, highlighted ? 'border-accent-indigo ring-1 ring-accent-indigo/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <Chip variant="status" tone="accent-indigo" className="shrink-0">Tool Call</Chip>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
      </div>
      <ToolInputView input={(ev.input as object) ?? (ev.params as object)} />
    </div>
  )
}
```

Replace `ResultCard` (lines 44-56):

```typescript
function ResultCard({ event: ev, highlighted }: CardProps) {
  return (
    <div className={[cardBase, highlighted ? 'border-success ring-1 ring-success/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <Chip variant="status" tone="success" className="shrink-0">Result</Chip>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
      </div>
      <ResultView event={ev} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/ui/EventFeed.test.tsx`
Expected: PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ai-panel/_feed/ frontend/components/ai-panel/EventFeed.tsx frontend/__tests__/ui/EventFeed.test.tsx
git commit -m "feat(frontend): structured tool-call and result rendering in feed"
```

---

## Task C2: Per-stage activity filter + toggle (#3)

**Files:**
- Modify: `frontend/components/ai-panel/AIPanel.tsx`
- Modify: `frontend/app/sessions/[id]/page.tsx:121-125`
- Test: `frontend/__tests__/ui/AIPanel.test.tsx` (create or extend)

> Backend now tags events with a `stage` id matching the frontend `StageId`
> (`profile`, `explore`, `rules`, `validate`, `triage`, `plan`, `transform`,
> `scorecard`). Events with no `stage` (e.g. `done`, legacy) are always shown.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/__tests__/ui/AIPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { AIPanel } from '@/components/ai-panel/AIPanel'

const events = [
  { event: 'thinking', ts: 1, stage: 'profile', text: 'profiling thought' },
  { event: 'thinking', ts: 2, stage: 'validate', text: 'validating thought' },
  { event: 'thinking', ts: 3, text: 'untagged thought' },
]

describe('AIPanel per-stage filter', () => {
  it('shows only the viewing stage plus untagged events by default', () => {
    render(<AIPanel events={events} isStreaming={false} viewingStage="profile" />)
    expect(screen.getByText('profiling thought')).toBeInTheDocument()
    expect(screen.getByText('untagged thought')).toBeInTheDocument()
    expect(screen.queryByText('validating thought')).not.toBeInTheDocument()
  })

  it('shows all events after toggling to All', () => {
    render(<AIPanel events={events} isStreaming={false} viewingStage="profile" />)
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }))
    expect(screen.getByText('validating thought')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/ui/AIPanel.test.tsx`
Expected: FAIL — `viewingStage` prop unknown; all three events render (no filter).

- [ ] **Step 3a: Update `AIPanel.tsx`**

Add to the `Props` interface (after `waitingMessage`):

```typescript
  /** The stage currently being viewed; activity defaults to this stage. */
  viewingStage?: string
```

Update the destructure and add filter state + logic at the top of the component:

```typescript
export function AIPanel({ events, isStreaming, waitingMessage, viewingStage }: Props) {
  const [view, setView] = useState<'feed' | 'terminal'>('feed')
  const [scope, setScope] = useState<'stage' | 'all'>('stage')
```

Compute the visible events just before the return (after `statusClass`):

```typescript
  const visibleEvents =
    scope === 'all' || !viewingStage
      ? events
      : events.filter((e) => {
          const s = (e as Record<string, unknown>).stage
          return s == null || s === viewingStage
        })
```

In the header segmented control region, add a scope toggle next to the feed/terminal control (inside the header `div`, before the feed/terminal segmented control):

```typescript
        {/* Scope toggle */}
        <div className="h-7 flex items-center bg-elevated rounded-md p-0.5 gap-0.5">
          {(['stage', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={[
                'text-xs px-2.5 py-1 rounded-md capitalize transition-colors',
                scope === s ? 'bg-surface text-fg border border-border' : 'text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              {s === 'stage' ? 'This stage' : 'All'}
            </button>
          ))}
        </div>
```

Pass `visibleEvents` into the feed/terminal (replace line 194):

```typescript
      {view === 'feed' ? <EventFeed events={visibleEvents} /> : <EventTerminal events={visibleEvents} />}
```

- [ ] **Step 3b: Pass `displayStage` from `page.tsx`**

In `frontend/app/sessions/[id]/page.tsx`, update the `<AIPanel ... />` (lines 121-125):

```typescript
        <AIPanel
          events={events}
          isStreaming={isStreaming}
          waitingMessage={WAITING_MESSAGES[stage]}
          viewingStage={displayStage}
        />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/ui/AIPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ai-panel/AIPanel.tsx frontend/app/sessions/[id]/page.tsx frontend/__tests__/ui/AIPanel.test.tsx
git commit -m "feat(frontend): scope AI activity to the viewed stage with All toggle"
```

---

## Task C3: Brighter Python code (#4)

**Files:**
- Create: `frontend/components/stages/CodeBlock.theme.ts`
- Modify: `frontend/components/stages/CodeBlock.tsx`
- Test: `frontend/__tests__/stages/CodeBlock.test.tsx` (create)

> Color output is impractical to assert; the test confirms the component renders
> the code and that the brightened theme object is used (token color present).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/__tests__/stages/CodeBlock.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/stages/CodeBlock.test.tsx`
Expected: FAIL — cannot find module `CodeBlock.theme`.

- [ ] **Step 3a: Create `CodeBlock.theme.ts`**

```typescript
// frontend/components/stages/CodeBlock.theme.ts
// A brightened, higher-contrast Prism theme derived from oneDark. Keeps a dark
// background but bolds keywords/functions and lifts token colors for legibility.
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export const brightTheme: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': { ...oneDark['pre[class*="language-"]'], color: '#e6edf3' },
  'code[class*="language-"]': { ...oneDark['code[class*="language-"]'], color: '#e6edf3' },
  keyword: { color: '#79c0ff', fontWeight: '600' },
  function: { color: '#ffd866', fontWeight: '600' },
  'class-name': { color: '#7ee787', fontWeight: '600' },
  string: { color: '#ffab70' },
  number: { color: '#a5d6ff' },
  comment: { color: '#8b949e', fontStyle: 'italic' },
  operator: { color: '#e6edf3' },
  builtin: { color: '#79c0ff' },
}
```

- [ ] **Step 3b: Update `CodeBlock.tsx`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/stages/CodeBlock.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/stages/CodeBlock.theme.ts frontend/components/stages/CodeBlock.tsx frontend/__tests__/stages/CodeBlock.test.tsx
git commit -m "feat(frontend): brighter high-contrast Python code theme"
```

---

## Task C4: Rule titles in RuleCard (#5)

**Files:**
- Modify: `frontend/components/rules/RuleCard.tsx:120,131`
- Test: `frontend/__tests__/components/RuleCard.test.tsx` (create or extend)

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/__tests__/components/RuleCard.test.tsx
import { render, screen } from '@testing-library/react'
import { RuleCard } from '@/components/rules/RuleCard'
import type { Rule } from '@/lib/types'

const baseRule: Rule = {
  id: 'r1', category: 'completeness', column: 'email', check: 'not_null',
  threshold: 1, modified: false,
}
const noop = () => {}

function renderCard(rule: Rule) {
  return render(
    <RuleCard
      rule={rule} decision="pending" edit={{}} isEditing={false}
      isSelectionMode={false} isSelected={false}
      onDecide={noop} onToggleSelect={noop} onEditOpen={noop}
      onEditClose={noop} onEditChange={noop} onSaveAndApprove={noop}
    />,
  )
}

describe('RuleCard title', () => {
  it('shows the human-readable rule title as the primary label', () => {
    renderCard(baseRule)
    expect(screen.getByText('Email must not be empty')).toBeInTheDocument()
  })
  it('keeps the raw check value visible as secondary detail', () => {
    renderCard(baseRule)
    expect(screen.getByText('check: not_null')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/components/RuleCard.test.tsx`
Expected: FAIL — primary label shows `not_null`, not the title.

- [ ] **Step 3: Update `RuleCard.tsx`**

Add the import:

```typescript
import { ruleTitle } from '@/lib/ruleTitle'
```

Replace the primary label span (line 120):

```typescript
        <span className="font-mono text-[13px] text-fg flex-1 break-words">{edit.check ?? rule.check}</span>
```

with (use the title; reflect any in-progress edit to `check`):

```typescript
        <span className="text-[13px] font-medium text-fg flex-1 break-words">
          {ruleTitle({ ...rule, check: edit.check ?? rule.check })}
        </span>
```

The secondary detail block (lines 129-132) already shows `check: {rule.check}` — leave it; that satisfies the secondary-detail test.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/components/RuleCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/rules/RuleCard.tsx frontend/__tests__/components/RuleCard.test.tsx
git commit -m "feat(frontend): show human-readable rule titles in RuleCard"
```

---

## Task C5: Taller notebook (#6)

**Files:**
- Modify: `frontend/components/stages/ExplorationStage.tsx:198`
- Test: `frontend/__tests__/stages/ExplorationStage.notebook.test.tsx` (create)

> Test asserts the container no longer uses the cramped fixed `h-[520px]` and
> uses the taller responsive height instead.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/__tests__/stages/ExplorationStage.notebook.test.tsx
import fs from 'fs'
import path from 'path'

describe('Exploration notebook height', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'components/stages/ExplorationStage.tsx'),
    'utf8',
  )
  it('drops the cramped fixed 520px height', () => {
    expect(src).not.toContain('h-[520px]')
  })
  it('uses the taller responsive height', () => {
    expect(src).toContain('h-[min(80vh,900px)]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/stages/ExplorationStage.notebook.test.tsx`
Expected: FAIL — still `h-[520px]`.

- [ ] **Step 3: Update `ExplorationStage.tsx`**

Replace line 198:

```typescript
        <div className="border border-border rounded-xl overflow-hidden h-[520px] flex flex-col">
```

with:

```typescript
        <div className="border border-border rounded-xl overflow-hidden h-[min(80vh,900px)] flex flex-col">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/stages/ExplorationStage.notebook.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/stages/ExplorationStage.tsx frontend/__tests__/stages/ExplorationStage.notebook.test.tsx
git commit -m "feat(frontend): enlarge exploration notebook height"
```

---

## Task C6: Drill into scorecard rules + failing rows (#7 frontend)

**Files:**
- Modify: `frontend/lib/types.ts:163-172`
- Modify: `frontend/components/stages/_scorecard/RuleComparisonTable.tsx`
- Test: `frontend/__tests__/stages/RuleComparisonTable.test.tsx` (create or extend)

- [ ] **Step 1: Extend the type**

In `frontend/lib/types.ts`, replace the `RuleComparisonEntry` interface (lines 163-172):

```typescript
export interface RuleComparisonEntry {
  id: string
  check: string
  column?: string
  category?: string
  initial_passed: boolean
  initial_failures: number
  final_passed: boolean
  final_failures: number
  final_sample_failing_rows?: Record<string, unknown>[]
  status: 'fixed' | 'regressed' | 'improved' | 'worsened' | 'unchanged'
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// frontend/__tests__/stages/RuleComparisonTable.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { RuleComparisonTable } from '@/components/stages/_scorecard/RuleComparisonTable'
import type { RuleComparisonEntry } from '@/lib/types'

const rows: RuleComparisonEntry[] = [
  {
    id: 'r1', check: 'not_null', column: 'email', category: 'completeness',
    initial_passed: false, initial_failures: 12,
    final_passed: false, final_failures: 3,
    final_sample_failing_rows: [{ customerID: 'CUST00231', email: null, gender: 'Male' }],
    status: 'improved',
  },
]

describe('RuleComparisonTable drill-in', () => {
  it('shows the human title instead of the raw check', () => {
    render(<RuleComparisonTable rows={rows} />)
    expect(screen.getByText('Email must not be empty')).toBeInTheDocument()
  })
  it('expands a row to show the check definition and failing rows', () => {
    render(<RuleComparisonTable rows={rows} />)
    expect(screen.queryByText(/sample failing rows/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Email must not be empty/i }))
    expect(screen.getByText(/sample failing rows/i)).toBeInTheDocument()
    expect(screen.getByText('CUST00231')).toBeInTheDocument()
    expect(screen.getByText('check: not_null')).toBeInTheDocument()
  })
  it('does not offer expansion when a rule has no failing rows', () => {
    const passing: RuleComparisonEntry[] = [{
      id: 'r2', check: 'unique', column: 'cid', category: 'uniqueness',
      initial_passed: true, initial_failures: 0, final_passed: true, final_failures: 0,
      final_sample_failing_rows: [], status: 'unchanged',
    }]
    render(<RuleComparisonTable rows={passing} />)
    expect(screen.queryByRole('button', { name: /must be unique/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/stages/RuleComparisonTable.test.tsx`
Expected: FAIL — raw `not_null` shown; no expand button.

- [ ] **Step 4: Rewrite `RuleComparisonTable.tsx`**

```typescript
'use client'
import { useState } from 'react'
import { Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { Chip, type StatusTone } from '@/components/ui/Chip'
import type { RuleComparisonEntry } from '@/lib/types'
import { ruleTitle } from '@/lib/ruleTitle'

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

function FailingRows({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null
  const columns = Object.keys(rows[0])
  return (
    <div className="mt-2">
      <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
        Sample failing rows
        <span className="ml-2 normal-case tracking-normal">showing {rows.length}</span>
      </span>
      <div className="mt-1 overflow-x-auto border border-border rounded-md">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="bg-elevated">
              {columns.map((c) => (
                <th key={c} className="text-left font-semibold text-fg-subtle px-2 py-1 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {columns.map((c) => (
                  <td key={c} className="px-2 py-1 font-mono text-fg-muted whitespace-nowrap">
                    {row[c] === null || row[c] === undefined ? '—' : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ r }: { r: RuleComparisonEntry }) {
  const [open, setOpen] = useState(false)
  const failingRows = r.final_sample_failing_rows ?? []
  const hasDetail = !r.final_passed && failingRows.length > 0
  const title = ruleTitle(r)

  return (
    <div className="border-b border-border last:border-0">
      <div className="grid grid-cols-[20px_2fr_1fr_1fr_110px] px-4 py-2.5 text-xs gap-2 items-center">
        <div className="w-4 h-4 flex items-center justify-center text-fg-subtle">
          {hasDetail ? (
            <button
              type="button"
              aria-label={title}
              onClick={() => setOpen((v) => !v)}
              className="hover:text-fg"
            >
              {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
            </button>
          ) : null}
        </div>
        <span className="text-fg truncate">
          {title}
          {r.column ? <span className="text-fg-subtle font-mono"> · {r.column}</span> : null}
        </span>
        <Cell passed={r.initial_passed} failures={r.initial_failures} />
        <Cell passed={r.final_passed} failures={r.final_failures} />
        <span className="justify-self-start">
          <Chip variant="status" tone={STATUS_TONE[r.status]}>{r.status}</Chip>
        </span>
      </div>
      {open && hasDetail && (
        <div className="mx-4 mb-3 px-4 py-3 bg-canvas rounded-md border border-border-strong text-xs">
          <div className="text-fg-muted font-mono">check: {r.check}</div>
          <FailingRows rows={failingRows} />
        </div>
      )}
    </div>
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
        <div className="grid grid-cols-[20px_2fr_1fr_1fr_110px] px-4 py-2 bg-elevated border-b border-border text-xs uppercase tracking-widest text-fg-subtle font-semibold gap-2">
          <span /><span>Rule</span><span>Initial</span><span>Final</span><span>Status</span>
        </div>
        {rows.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/stages/RuleComparisonTable.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/types.ts frontend/components/stages/_scorecard/RuleComparisonTable.tsx frontend/__tests__/stages/RuleComparisonTable.test.tsx
git commit -m "feat(scorecard): drill into rules to inspect failing rows"
```

---

# PART D — Full verification

## Task D1: Full suite green

**Files:** none (verification only)

- [ ] **Step 1: Frontend full check**

Run: `cd frontend && npx jest && npx tsc --noEmit`
Expected: all suites pass; no type errors.

- [ ] **Step 2: Frontend production build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Backend tests + lint**

Run: `uv run pytest tests/backend/agents tests/backend/api -v && uv run ruff check backend`
Expected: all pass (except the 9 pre-existing DB-backed errors when Postgres is down); no lint errors.

- [ ] **Step 4: Manual smoke (if infra is up)**

Run a session through to the scorecard and verify: feed shows readable key/values & expandable results; AI summary is complete; activity filters per stage with an All toggle; Python code is bright; rules show titles; notebook is taller; scorecard rules expand to failing rows. (Requires Docker/Temporal healthy — see project memory on Docker disk pressure.)

- [ ] **Step 5: Commit any fixups, then stop for review**

```bash
git add -A && git commit -m "test: full-suite fixups for UI round 3" || echo "nothing to fix up"
```

---

## Notes for the executor

- **Order:** Part A (backend) → Part B (pure helpers) → Part C (rendering) → Part D. C1/C6 depend on B2/B1 respectively; C2 depends on A2–A4 for real data but its tests stub `stage` directly, so it can be built independently.
- **No new deps:** `oneDark` ships with `react-syntax-highlighter` (already installed). No package installs.
- **Backward compatibility:** the feed prefers `result` but falls back to `preview`; the filter shows untagged events; the scorecard tolerates missing `final_sample_failing_rows`. Old/in-flight sessions keep working.
- **Deferred (not in this plan):** the section-based, agent-editable, cached notebook redesign (spec §#6 follow-up).
