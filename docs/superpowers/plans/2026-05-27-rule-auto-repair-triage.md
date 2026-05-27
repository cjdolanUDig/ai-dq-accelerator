# Rule Auto-Repair in Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a rule throws a SQL/regex error during validation (classified `eval_error`), rewrite it and re-validate it against DuckDB before showing the user — presenting a working corrected rule flagged "auto-repaired" instead of only proposing removal.

**Architecture:** Add a single-rule validation helper to `dq_tools`, add a repair node to the triage graph that rewrites each `eval_error` rule (bounded attempts) and re-validates it, carry a `proposed_fix` through triage state, and apply accepted repairs in the workflow's triage-approval stage.

**Tech Stack:** Python, DuckDB, LangGraph, Anthropic SDK, Temporal, pytest (`asyncio_mode=auto`).

Spec: `docs/superpowers/specs/2026-05-27-rule-auto-repair-triage-design.md`

---

## File Structure

- `dq_tools/rule_engine.py` — add `validate_single_rule(session_id, rule)`.
- `backend/agents/prompts.py` — add `RULE_REPAIR_SYSTEM` prompt.
- `backend/agents/graphs/triage_agent.py` — add a repair pass; extend classifications with `proposed_fix` and the `auto_repaired` value.
- `backend/temporal/workflows/dq_workflow.py` — apply accepted repairs in TRIAGING/AWAITING_TRIAGE_APPROVAL.
- `backend/api/schemas.py` — surface `proposed_fix` in the triage response (additive).
- `tests/backend/test_validate_single_rule.py` — new.
- `tests/backend/test_triage_rule_repair.py` — new.

Tests run with `uv run pytest`.

---

## Task 1: Single-rule validation helper

**Files:**
- Modify: `dq_tools/rule_engine.py` (add after `run_rules`, ~line 398)
- Test: `tests/backend/test_validate_single_rule.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/test_validate_single_rule.py
import pandas as pd

from dq_tools.db import duckdb_connect
from dq_tools.rule_engine import validate_single_rule, _db_path, _session_dir


def _seed(tmp_path, monkeypatch, df):
    monkeypatch.setattr("dq_tools.rule_engine._find_project_root", lambda: tmp_path)
    sdir = _session_dir("s1")
    sdir.mkdir(parents=True, exist_ok=True)
    con = duckdb_connect(str(_db_path("s1")))
    con.register("seed", df)
    con.execute("CREATE TABLE working_data AS SELECT * FROM seed")
    con.close()


def test_valid_rule_returns_clean_result(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch, pd.DataFrame({"email": ["a@x.com", None, "b@y.com"]}))
    rule = {"id": "r1", "check": "not_null", "column": "email",
            "category": "completeness", "threshold": 0.0}
    result = validate_single_rule("s1", rule)
    assert result["error"] is None
    assert result["failure_count"] == 1


def test_broken_rule_surfaces_error(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch, pd.DataFrame({"email": ["a@x.com"]}))
    rule = {"id": "r2", "check": "custom_sql", "column": "email",
            "category": "validity", "threshold": 0.0,
            "condition": "nonexistent_col > 5"}
    result = validate_single_rule("s1", rule)
    assert result["error"] is not None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/backend/test_validate_single_rule.py -v`
Expected: FAIL — `ImportError: cannot import name 'validate_single_rule'`.

- [ ] **Step 3: Implement the helper**

`run_rules` already builds the failing-row condition, executes it, and captures `error` per rule. Reuse it with a one-rule list and return the single per-rule entry:

```python
def validate_single_rule(session_id: str, rule: dict) -> dict:
    """Execute one rule and return its per-rule result dict (including ``error``).

    Thin wrapper over :func:`run_rules` so the condition builder and error
    handling stay in one place. Returns the per-rule dict, or a synthetic
    error result if the rule produced no per-rule entry.
    """
    result = run_rules(session_id, [rule])
    per_rule = result.get("per_rule", [])
    if per_rule:
        return per_rule[0]
    return {
        "id": rule.get("id", "unknown"),
        "check": rule.get("check"),
        "column": rule.get("column"),
        "passed": False,
        "failure_count": 0,
        "failure_rate": 0.0,
        "sample_failing_rows": [],
        "rationale": rule.get("rationale", ""),
        "error": "Rule produced no validation result.",
    }
```

Note: `run_rules` writes `validation_results.json` and `checks.yml` as a side effect. That is acceptable here — the workflow re-runs full validation after triage anyway. If a side-effect-free check is preferred later, that is a follow-up, not part of this plan.

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/backend/test_validate_single_rule.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Lint + commit**

```bash
ruff check dq_tools/rule_engine.py tests/backend/test_validate_single_rule.py
git add dq_tools/rule_engine.py tests/backend/test_validate_single_rule.py
git commit -m "feat(dq_tools): add validate_single_rule helper for rule repair re-checks"
```

---

## Task 2: Rule-repair prompt

**Files:**
- Modify: `backend/agents/prompts.py` (append a new prompt constant)

- [ ] **Step 1: Add the `RULE_REPAIR_SYSTEM` prompt**

Append to `backend/agents/prompts.py`:

```python
RULE_REPAIR_SYSTEM = """You repair a single data-quality rule that failed to EXECUTE (a SQL or regex error), not a rule that merely failed its data check.

You receive: the rule JSON, the exact execution error, and the table schema.

Produce a corrected rule that:
- Keeps the SAME `check` type and the SAME target column(s) — never change the check type.
- Fixes only what caused the error: a malformed regex `pattern`, a wrong/missing `column`, a bad `custom_sql` `condition`, an unparseable `format`, etc.
- Preserves the original intent and `threshold`.
- Must NOT broaden the rule into a no-op (a condition that can never flag a row).

Output ONLY valid JSON, the full corrected rule object with all original keys preserved:
{"id": "...", "check": "...", "column": "...", "category": "...", "threshold": ..., ...}
If the rule cannot be repaired without changing its check type or intent, output exactly: {"unrepairable": true}
"""
```

- [ ] **Step 2: Verify it imports**

Run: `uv run python -c "from backend.agents.prompts import RULE_REPAIR_SYSTEM; print(len(RULE_REPAIR_SYSTEM))"`
Expected: prints a positive integer.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/prompts.py
git commit -m "feat(agents): add RULE_REPAIR_SYSTEM prompt for triage rule repair"
```

---

## Task 3: Repair pass in the triage agent

**Files:**
- Modify: `backend/agents/graphs/triage_agent.py`
- Test: `tests/backend/test_triage_rule_repair.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/test_triage_rule_repair.py
from types import SimpleNamespace

import backend.agents.graphs.triage_agent as ta


def _fix_response(rule_json: str):
    return SimpleNamespace(content=[SimpleNamespace(text=rule_json)])


def test_repair_pass_fixes_eval_error_rule(monkeypatch):
    broken = {"id": "r1", "check": "regex_match", "column": "email",
              "category": "validity", "threshold": 0.0, "pattern": "[", "error": "bad regex"}
    fixed = {"id": "r1", "check": "regex_match", "column": "email",
             "category": "validity", "threshold": 0.0, "pattern": ".+@.+"}

    classifications = [{
        "rule_id": "r1", "check": "regex_match", "column": "email",
        "classification": "eval_error", "proposed_threshold": None,
        "proposed_remove": True, "reason": "regex error", "confidence": "high",
    }]

    monkeypatch.setattr(ta, "call_claude_with_retry",
                        lambda client, **kw: _fix_response('{"id":"r1","check":"regex_match","column":"email","category":"validity","threshold":0.0,"pattern":".+@.+"}'))
    # The re-validation says the fixed rule executes cleanly
    monkeypatch.setattr(ta, "validate_single_rule",
                        lambda sid, rule: {"id": "r1", "error": None, "failure_count": 2, "passed": False})

    out = ta._repair_eval_errors("s1", classifications, [broken])
    repaired = next(c for c in out if c["rule_id"] == "r1")
    assert repaired["classification"] == "auto_repaired"
    assert repaired["proposed_fix"]["pattern"] == ".+@.+"
    assert repaired["proposed_remove"] is False


def test_repair_pass_falls_back_to_removal(monkeypatch):
    broken = {"id": "r2", "check": "custom_sql", "column": "x",
              "category": "validity", "threshold": 0.0, "condition": "bad", "error": "err"}
    classifications = [{
        "rule_id": "r2", "check": "custom_sql", "column": "x",
        "classification": "eval_error", "proposed_threshold": None,
        "proposed_remove": True, "reason": "sql error", "confidence": "high",
    }]
    # Model returns unrepairable
    monkeypatch.setattr(ta, "call_claude_with_retry",
                        lambda client, **kw: _fix_response('{"unrepairable": true}'))
    monkeypatch.setattr(ta, "validate_single_rule", lambda sid, rule: {"error": "still broken"})

    out = ta._repair_eval_errors("s1", classifications, [broken])
    r = next(c for c in out if c["rule_id"] == "r2")
    assert r["classification"] == "eval_error"
    assert r["proposed_remove"] is True
    assert r.get("proposed_fix") is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/backend/test_triage_rule_repair.py -v`
Expected: FAIL — `module 'backend.agents.graphs.triage_agent' has no attribute '_repair_eval_errors'`.

- [ ] **Step 3: Add imports, the enum value, and the repair function**

In `backend/agents/graphs/triage_agent.py`:

Add to the imports (top of file):

```python
from backend.agents.prompts import (
    TRIAGE_SYSTEM_PROMPT,
    TRIAGE_CONTRADICTION_SYSTEM,
    RULE_REPAIR_SYSTEM,
)
from dq_tools.rule_engine import validate_single_rule
```

(Replace the existing `from backend.agents.prompts import TRIAGE_SYSTEM_PROMPT, TRIAGE_CONTRADICTION_SYSTEM` line — do not leave a duplicate.)

Add the `auto_repaired` value to the valid set (line 32):

```python
VALID_CLASSIFICATIONS = {"transform_fixable", "threshold_too_strict", "unfixable", "eval_error", "auto_repaired"}
```

Add a module constant near `MODEL`:

```python
MAX_RULE_REPAIR_ATTEMPTS = 2
```

Add the repair function (place it above `triage_node`):

```python
def _repair_eval_errors(
    session_id: str,
    classifications: list[dict],
    failing_rules: list[dict],
) -> list[dict]:
    """For each classification marked ``eval_error``, attempt to rewrite the rule
    and re-validate it. On success, set classification ``auto_repaired`` and attach
    ``proposed_fix``; otherwise leave it as ``eval_error`` with ``proposed_remove``.
    """
    rules_by_id = {r.get("id"): r for r in failing_rules}
    client = anthropic.Anthropic()

    for c in classifications:
        if c.get("classification") != "eval_error":
            continue
        rule = rules_by_id.get(c["rule_id"])
        if not rule:
            continue
        error = rule.get("error") or c.get("reason", "")
        schema_cols = list((rule.get("sample_failing_rows") or [{}])[0].keys())

        repaired = False
        for attempt in range(MAX_RULE_REPAIR_ATTEMPTS):
            emit(session_id, "thinking",
                 text=f"repairing rule {c['rule_id']} (attempt {attempt+1}/{MAX_RULE_REPAIR_ATTEMPTS})")
            try:
                response = call_claude_with_retry(
                    client, model=MODEL, max_tokens=1024,
                    system=RULE_REPAIR_SYSTEM,
                    messages=[{"role": "user", "content": (
                        f"Rule JSON:\n```json\n{json.dumps(rule, default=str)}\n```\n\n"
                        f"Execution error: {error}\n\n"
                        f"Columns seen in failing-row samples: {schema_cols}\n\n"
                        "Return the corrected rule object, or {\"unrepairable\": true}."
                    )}],
                )
                text = "".join(b.text for b in response.content if hasattr(b, "text"))
                fix = _parse_json(text)
            except Exception:
                fix = None

            if not isinstance(fix, dict) or fix.get("unrepairable"):
                continue
            # Guardrail: never change check type or target column
            if fix.get("check") != rule.get("check") or fix.get("column") != rule.get("column"):
                continue
            # Preserve identity
            fix["id"] = rule["id"]

            check = validate_single_rule(session_id, fix)
            if check.get("error") is None:
                c["classification"] = "auto_repaired"
                c["proposed_fix"] = fix
                c["proposed_remove"] = False
                c["reason"] = f"Auto-repaired: {error[:120]}"
                repaired = True
                break

        if not repaired:
            c.setdefault("proposed_fix", None)
            c["proposed_remove"] = True

    return classifications
```

- [ ] **Step 4: Call the repair pass and accept the new keys in validation**

In `triage_node`, after `classifications = _validate_classifications(classifications, failing_rules)` (line 330) and before `_detect_triage_contradictions`, add:

```python
    classifications = _repair_eval_errors(session_id, classifications, failing_rules)
```

In `_validate_classifications`, add `proposed_fix` to the `required_keys` set (lines 121-130) so it is always present:

```python
    required_keys = {
        "rule_id",
        "check",
        "column",
        "classification",
        "proposed_threshold",
        "proposed_remove",
        "proposed_fix",
        "reason",
        "confidence",
    }
```

In `_build_summary` (line 90-96), add the new bucket so the summary count stays correct:

```python
def _build_summary(classifications: list[dict]) -> dict:
    summary = {"transform_fixable": 0, "threshold_too_strict": 0, "unfixable": 0,
               "eval_error": 0, "auto_repaired": 0}
    for c in classifications:
        bucket = c.get("classification", "transform_fixable")
        if bucket in summary:
            summary[bucket] += 1
    return summary
```

Also add `auto_repaired=summary["auto_repaired"]` to the `emit(session_id, "done", ...)` call (lines 338-346).

- [ ] **Step 5: Run the test to verify it passes**

Run: `uv run pytest tests/backend/test_triage_rule_repair.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Lint + commit**

```bash
ruff check backend/agents/graphs/triage_agent.py tests/backend/test_triage_rule_repair.py
git add backend/agents/graphs/triage_agent.py tests/backend/test_triage_rule_repair.py
git commit -m "feat(triage): auto-repair eval_error rules and re-validate before user review"
```

---

## Task 4: Apply accepted repairs in the workflow

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py` (TRIAGING stage, lines 575-615)

The amendment payload (`self.triage_amendments`) gains an optional `accepted_repairs` list of `rule_id`s. Accepting a repair swaps the broken rule for its `proposed_fix` in `approved_rules`.

- [ ] **Step 1: Include repairs in the amendments-present check**

Update the `has_amendments` predicate (lines 576-579) so a `proposed_fix` also triggers the human gate:

```python
            has_amendments = any(
                c.get("proposed_threshold") is not None
                or c.get("proposed_remove", False)
                or c.get("proposed_fix") is not None
                for c in triage_result.get("classifications", [])
            )
```

- [ ] **Step 2: Apply accepted repairs alongside threshold changes and rejections**

In the amendment-application block (lines 589-604), build a map of accepted repairs from the triage classifications and apply the swap. Replace the block from `threshold_changes = {...}` through the `self.approved_rules = updated_rules` assignment with:

```python
            amendments = self.triage_amendments or {}
            threshold_changes = {
                item["rule_id"]: item["new_threshold"]
                for item in amendments.get("accepted_threshold_changes", [])
            }
            rejected_ids = set(amendments.get("rejected_rule_ids", []))
            accepted_repair_ids = set(amendments.get("accepted_repairs", []))
            repairs_by_id = {
                c["rule_id"]: c["proposed_fix"]
                for c in self.triage_result.get("classifications", [])
                if c.get("proposed_fix") and c["rule_id"] in accepted_repair_ids
            }

            if threshold_changes or rejected_ids or repairs_by_id:
                updated_rules = []
                for rule in self.approved_rules or []:
                    if rule["id"] in rejected_ids:
                        continue
                    if rule["id"] in repairs_by_id:
                        rule = {**repairs_by_id[rule["id"]]}
                    if rule["id"] in threshold_changes:
                        rule = {**rule, "threshold": threshold_changes[rule["id"]]}
                    updated_rules.append(rule)
                self.approved_rules = updated_rules
```

Keep the existing re-validation block (lines 606-615) that runs after — it now establishes the baseline with repaired rules. Confirm it still sits inside the `if threshold_changes or rejected_ids or repairs_by_id:` body so re-validation runs when only repairs were accepted.

- [ ] **Step 3: Verify the module imports cleanly**

Run: `uv run python -c "import backend.temporal.workflows.dq_workflow"`
Expected: exits 0.

- [ ] **Step 4: Lint + commit**

```bash
ruff check backend/temporal/workflows/dq_workflow.py
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat(temporal): apply accepted rule repairs in triage approval"
```

---

## Task 5: Surface `proposed_fix` in the API schema

**Files:**
- Modify: `backend/api/schemas.py`

- [ ] **Step 1: Locate the triage classification schema**

Run: `uv run python -c "import backend.api.schemas as s; print([n for n in dir(s) if 'riage' in n or 'lassif' in n])"`
Expected: prints the relevant model names (e.g. `TriageResultResponse`, `RuleClassification`).

- [ ] **Step 2: Add the additive fields**

In the Pydantic model that represents a single triage classification, add (matching the file's existing style — `Optional`/`= None` defaults):

```python
    proposed_fix: dict | None = None
```

If the triage response model validates `classification` against a literal/enum set, add `"auto_repaired"` to that set. If classifications are passed through as free-form dicts (no strict model), no schema change is needed beyond confirming dict pass-through — note that in the commit message.

- [ ] **Step 3: Verify schemas import**

Run: `uv run python -c "import backend.api.schemas"`
Expected: exits 0.

- [ ] **Step 4: Lint + commit**

```bash
ruff check backend/api/schemas.py
git add backend/api/schemas.py
git commit -m "feat(api): surface proposed_fix and auto_repaired in triage response"
```

---

## Task 6: Regression check

- [ ] **Step 1: Run the full backend suite**

Run: `uv run pytest tests/backend -q`
Expected: no NEW failures vs. the pre-existing baseline (per project memory: ~9 DB errors + ruff items are baseline; confirm the count is unchanged and the new tests pass).

- [ ] **Step 2: Commit any fixups**

If a pre-existing test asserted on the old `_build_summary` keys or `VALID_CLASSIFICATIONS`, update that test to include `auto_repaired` and commit:

```bash
git add -A
git commit -m "test(triage): update fixtures for auto_repaired classification"
```

---

## Frontend follow-up (out of scope for this plan, note for the user)

The triage view (React) should render `auto_repaired` rules with a before/after diff and an "auto-repaired" badge, and send accepted repairs back as `accepted_repairs: [rule_id, ...]` in the triage decision signal. This requires touching the frontend triage component and the decision-signal payload; track it as a separate frontend task once this backend plan lands.

---

## Self-Review Notes (for the implementer)

- The repair guardrail (`check` and `column` must be unchanged) directly enforces the spec's "never turn a rule into a no-op / never change check type" constraint.
- `proposed_fix` is additive everywhere; existing consumers that ignore unknown keys are unaffected.
- `validate_single_rule` reuses `run_rules`, so the corrected rule is checked with the exact same execution path it will run under later.
- Budget is `MAX_RULE_REPAIR_ATTEMPTS = 2`, matching the spec.
