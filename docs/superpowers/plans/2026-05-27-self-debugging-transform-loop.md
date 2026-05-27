# Self-Debugging Transform Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a transform produces no effect or makes the dataset worse, automatically synthesize a custom-code block achieving the step's intent, roll back the failed step, re-apply, and re-measure — escalating to the human only if auto-repair also fails.

**Architecture:** Add a DuckDB table snapshot/restore primitive to `dq_tools`, expose it as Temporal activities, extend the custom-code generator to accept failure context, and insert a bounded repair sub-loop into the `TRANSFORMATION_LOOP` stage of the workflow before the existing human escalation.

**Tech Stack:** Python, DuckDB, Temporal (`temporalio`), Anthropic SDK, pytest (`asyncio_mode=auto`).

Spec: `docs/superpowers/specs/2026-05-27-self-debugging-transform-loop-design.md`

---

## File Structure

- `dq_tools/transformation_executor.py` — add `snapshot_working` / `restore_working` / `drop_working_snapshot`.
- `backend/temporal/activities/transform_activities.py` — wrap the three snapshot functions as activities; pass `failure_context` into `generate_custom_code_activity`.
- `backend/agents/graphs/custom_code_generator.py` — accept and use `failure_context` in the prompt.
- `backend/temporal/workflows/dq_workflow.py` — snapshot before each step, run the repair sub-loop, add log fields.
- `tests/backend/test_transform_snapshot.py` — new unit tests for snapshot/restore.
- `tests/backend/test_custom_code_failure_context.py` — new unit test for failure-context prompt wiring.

Tests run with `uv run pytest` (bare `pytest` uses a broken env in this repo).

---

## Task 1: DuckDB snapshot / restore primitive

**Files:**
- Modify: `dq_tools/transformation_executor.py` (add after `_write_df`, ~line 69)
- Test: `tests/backend/test_transform_snapshot.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/backend/test_transform_snapshot.py
import pandas as pd
import pytest

from dq_tools.db import duckdb_connect
from dq_tools.transformation_executor import (
    _db_path,
    _session_dir,
    drop_working_snapshot,
    restore_working,
    snapshot_working,
)


def _make_session(tmp_path, monkeypatch, df):
    """Create a session DuckDB with a working_data table under a temp project root."""
    monkeypatch.setattr(
        "dq_tools.transformation_executor._find_project_root", lambda: tmp_path
    )
    sdir = _session_dir("sess1")
    sdir.mkdir(parents=True, exist_ok=True)
    con = duckdb_connect(str(_db_path("sess1")))
    con.register("seed", df)
    con.execute("CREATE TABLE working_data AS SELECT * FROM seed")
    con.close()


def test_snapshot_then_restore_round_trips(tmp_path, monkeypatch):
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    _make_session(tmp_path, monkeypatch, df)

    snapshot_working("sess1", "pre_step_0")

    # Mutate working_data after the snapshot
    con = duckdb_connect(str(_db_path("sess1")))
    con.execute("DELETE FROM working_data WHERE a = 1")
    con.close()

    restore_working("sess1", "pre_step_0")

    con = duckdb_connect(str(_db_path("sess1")))
    restored = con.execute("SELECT * FROM working_data ORDER BY a").fetchdf()
    con.close()
    pd.testing.assert_frame_equal(restored.reset_index(drop=True), df)


def test_drop_working_snapshot_removes_table(tmp_path, monkeypatch):
    df = pd.DataFrame({"a": [1, 2]})
    _make_session(tmp_path, monkeypatch, df)
    snapshot_working("sess1", "pre_step_0")
    drop_working_snapshot("sess1", "pre_step_0")

    con = duckdb_connect(str(_db_path("sess1")))
    tables = {row[0] for row in con.execute("SHOW TABLES").fetchall()}
    con.close()
    assert "working_data__pre_step_0" not in tables
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/backend/test_transform_snapshot.py -v`
Expected: FAIL with `ImportError: cannot import name 'snapshot_working'`.

- [ ] **Step 3: Implement the three helpers**

Add to `dq_tools/transformation_executor.py` immediately after `_write_df` (after line 69). The label is restricted to a safe charset so it can be interpolated into the table name without SQL injection risk.

```python
import re as _re  # already imported as `re` at module top — reuse `re` instead


def _snapshot_table(label: str) -> str:
    """Return the snapshot table name for a label, rejecting unsafe characters."""
    if not re.fullmatch(r"[A-Za-z0-9_]+", label or ""):
        raise ValueError(f"Unsafe snapshot label: {label!r}")
    return f"working_data__{label}"


def snapshot_working(session_id: str, label: str) -> None:
    """Copy ``working_data`` into a labelled snapshot table for later rollback."""
    table = _snapshot_table(label)
    with session_db_lock(session_id):
        con = duckdb_connect(str(_db_path(session_id)))
        try:
            con.execute(f'DROP TABLE IF EXISTS "{table}"')
            con.execute(f'CREATE TABLE "{table}" AS SELECT * FROM working_data')
        finally:
            con.close()


def restore_working(session_id: str, label: str) -> None:
    """Replace ``working_data`` with the contents of a labelled snapshot table."""
    table = _snapshot_table(label)
    with session_db_lock(session_id):
        con = duckdb_connect(str(_db_path(session_id)))
        try:
            con.execute("DROP TABLE IF EXISTS working_data")
            con.execute(f'CREATE TABLE working_data AS SELECT * FROM "{table}"')
        finally:
            con.close()


def drop_working_snapshot(session_id: str, label: str) -> None:
    """Delete a labelled snapshot table; no-op if it does not exist."""
    table = _snapshot_table(label)
    with session_db_lock(session_id):
        con = duckdb_connect(str(_db_path(session_id)))
        try:
            con.execute(f'DROP TABLE IF EXISTS "{table}"')
        finally:
            con.close()
```

Remove the stray `import re as _re` line — `re` is already imported at the top of the module (line 10). Do not add a duplicate import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/backend/test_transform_snapshot.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Lint**

Run: `ruff check dq_tools/transformation_executor.py tests/backend/test_transform_snapshot.py`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add dq_tools/transformation_executor.py tests/backend/test_transform_snapshot.py
git commit -m "feat(dq_tools): add working_data snapshot/restore primitive for transform rollback"
```

---

## Task 2: Snapshot activities

**Files:**
- Modify: `backend/temporal/activities/transform_activities.py` (append after `verify_transform_activity`, line 228)

- [ ] **Step 1: Add the three activities**

Append to `backend/temporal/activities/transform_activities.py`:

```python
@activity.defn
async def snapshot_working_activity(params: dict) -> dict:
    """params: {session_id, label}. Returns {ok: bool}."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_snapshot_working_sync, params))

def _snapshot_working_sync(params: dict) -> dict:
    from dq_tools.transformation_executor import snapshot_working
    snapshot_working(params["session_id"], params["label"])
    return {"ok": True}


@activity.defn
async def restore_working_activity(params: dict) -> dict:
    """params: {session_id, label}. Returns {ok: bool}."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_restore_working_sync, params))

def _restore_working_sync(params: dict) -> dict:
    from dq_tools.transformation_executor import restore_working
    restore_working(params["session_id"], params["label"])
    return {"ok": True}


@activity.defn
async def drop_working_snapshot_activity(params: dict) -> dict:
    """params: {session_id, label}. Returns {ok: bool}."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_drop_working_snapshot_sync, params))

def _drop_working_snapshot_sync(params: dict) -> dict:
    from dq_tools.transformation_executor import drop_working_snapshot
    drop_working_snapshot(params["session_id"], params["label"])
    return {"ok": True}
```

- [ ] **Step 2: Register the activities on the worker**

Open `backend/temporal/worker.py`, find the activity import block from `backend.temporal.activities.transform_activities` and the `activities=[...]` list passed to the `Worker(...)` constructor. Add the three new names to BOTH the import and the list:

```python
# in the import from transform_activities
snapshot_working_activity,
restore_working_activity,
drop_working_snapshot_activity,
```

```python
# in the Worker(activities=[...]) list
snapshot_working_activity,
restore_working_activity,
drop_working_snapshot_activity,
```

- [ ] **Step 3: Verify the worker imports cleanly**

Run: `uv run python -c "import backend.temporal.worker"`
Expected: exits 0, no ImportError.

- [ ] **Step 4: Lint**

Run: `ruff check backend/temporal/activities/transform_activities.py backend/temporal/worker.py`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/temporal/activities/transform_activities.py backend/temporal/worker.py
git commit -m "feat(temporal): expose snapshot/restore/drop transform activities"
```

---

## Task 3: Failure context in custom-code generator

**Files:**
- Modify: `backend/agents/graphs/custom_code_generator.py` (`run_custom_code_generator`, lines 119-193)
- Modify: `backend/temporal/activities/transform_activities.py` (`_generate_custom_code_sync`, lines 166-172)
- Test: `tests/backend/test_custom_code_failure_context.py`

- [ ] **Step 1: Write the failing test**

The generator makes Anthropic calls, so the test patches `call_claude_with_retry` and the investigation/dry-run helpers, and asserts the failure context reaches the generation prompt.

```python
# tests/backend/test_custom_code_failure_context.py
from types import SimpleNamespace

import backend.agents.graphs.custom_code_generator as ccg


def _fake_response(code: str):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=f"```python\n{code}\n```")])


def test_failure_context_is_included_in_prompt(monkeypatch):
    captured = {}

    def fake_call(client, **kwargs):
        captured["messages"] = kwargs["messages"]
        return _fake_response("def transform(df):\n    return df")

    monkeypatch.setattr(ccg, "call_claude_with_retry", fake_call)
    monkeypatch.setattr(ccg, "_investigate_context", lambda sid, step: [])
    monkeypatch.setattr(ccg, "_dry_run", lambda code, df: None)
    # Force the dry-run sample to be non-empty so _dry_run runs and we accept the code
    monkeypatch.setattr(ccg.pd, "DataFrame", ccg.pd.DataFrame)

    result = ccg.run_custom_code_generator(
        session_id="s1",
        step={"id": "step_1", "intent": "null out invalid emails", "target_columns": ["email"]},
        prior_context="",
        human_instruction=None,
        failure_context="Prebuilt null_invalid had no effect: 0 rows affected.",
    )

    assert result["validation_passed"] is True
    prompt_text = "".join(
        m["content"] for m in captured["messages"] if isinstance(m.get("content"), str)
    )
    assert "no effect" in prompt_text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/backend/test_custom_code_failure_context.py -v`
Expected: FAIL — `run_custom_code_generator() got an unexpected keyword argument 'failure_context'`.

- [ ] **Step 3: Add the `failure_context` parameter and weave it into the prompt**

In `backend/agents/graphs/custom_code_generator.py`, change the signature (line 119) and the first-attempt prompt construction (lines 150-161):

```python
def run_custom_code_generator(
    session_id: str,
    step: dict,
    prior_context: str,
    human_instruction: str | None,
    failure_context: str | None = None,
) -> dict:
```

Inside the `if attempt == 0:` branch, add a failure line alongside the existing `prior_str` / `instruction_str`:

```python
            prior_str = f"\nPrior execution context: {prior_context}" if prior_context else ""
            instruction_str = f"\n\nEngineer instruction: {human_instruction}" if human_instruction else ""
            failure_str = (
                f"\n\nA previous transform for this step FAILED. Reason: {failure_context}\n"
                "Write custom code that achieves the step's intent and avoids that failure."
                if failure_context else ""
            )
            generate_prompt = (
                f"Step intent: {step.get('intent', '')}\n"
                f"Target columns: {step.get('target_columns', [])}\n"
                f"Approach: {step.get('approach', '')}"
                f"{prior_str}{instruction_str}{failure_str}\n\n"
                "Write the Python transform function. Output ONLY the function in a ```python block."
            )
```

- [ ] **Step 4: Pass `failure_context` through the activity**

In `backend/temporal/activities/transform_activities.py`, update `_generate_custom_code_sync` (lines 166-172):

```python
def _generate_custom_code_sync(params: dict) -> dict:
    return run_custom_code_generator(
        session_id=params["session_id"],
        step=params["step"],
        prior_context=params.get("prior_context", ""),
        human_instruction=params.get("human_instruction"),
        failure_context=params.get("failure_context"),
    )
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `uv run pytest tests/backend/test_custom_code_failure_context.py -v`
Expected: PASS.

- [ ] **Step 6: Lint + commit**

```bash
ruff check backend/agents/graphs/custom_code_generator.py backend/temporal/activities/transform_activities.py tests/backend/test_custom_code_failure_context.py
git add backend/agents/graphs/custom_code_generator.py backend/temporal/activities/transform_activities.py tests/backend/test_custom_code_failure_context.py
git commit -m "feat(agents): thread failure_context into custom-code generation"
```

---

## Task 4: Repair helper on the workflow

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py` (imports near top; add a method to the workflow class; add a module constant)

This task adds the repair machinery as a self-contained method. Task 5 wires it into the loop.

- [ ] **Step 1: Import the new activities and add the budget constant**

In `dq_workflow.py`, the activities are imported inside a `with workflow.unsafe.imports_passed_through():` block near the top. Add the three snapshot activities to that import from `backend.temporal.activities.transform_activities` (alongside `apply_transformation_activity`, `verify_transform_activity`, etc.). Then add a module-level constant near the other timeouts/constants:

```python
MAX_REPAIR_ATTEMPTS = 2
```

- [ ] **Step 2: Add the `_attempt_repair` method to the workflow class**

Add this method to the `DQAcceleratorWorkflow` class (place it near `_escalate`). It assumes `working_data` was snapshotted to `pre_step_{i}` before the step was applied (Task 5 does that). It returns a dict describing the outcome.

```python
    async def _build_repair_step(self, step: dict, failure_reason: str) -> dict:
        """Translate a failed (prebuilt or custom) step into a custom-code step
        spec the generator can act on, carrying the original intent."""
        column = step.get("column") or ""
        params = step.get("params", {})
        target_columns = (
            params.get("columns")
            or ([column] if column else [])
            or step.get("target_columns", [])
        )
        intent = step.get("rationale") or step.get("intent") or (
            f"Achieve the effect of a '{step.get('type')}' transform on {target_columns}"
        )
        return {
            "id": f"{step['id']}_repair",
            "type": "custom",
            "intent": intent,
            "target_columns": target_columns,
            "approach": (
                f"Original transform was type '{step.get('type')}' with params {params}. "
                f"Reproduce its intent in pandas."
            ),
            "targets_rules": step.get("targets_rules", []),
        }

    async def _attempt_repair(
        self,
        steps: list,
        i: int,
        failure_reason: str,
        pre_step_score: float,
        pre_step_total_failures: int,
        pre_step_passing: set,
        snapshot_label: str,
    ) -> dict:
        """Bounded custom-code repair of a failed step.

        Returns {repaired: bool, custom_code: str|None, attempts: int,
        actual_score_delta: float, actual_resolution: float, regressions: list,
        new_per_rule: list}. On failure, restores working_data from the snapshot.
        """
        step = steps[i]
        repair_step = await self._build_repair_step(step, failure_reason)
        attempts = 0
        last_code: str | None = None

        while attempts < MAX_REPAIR_ATTEMPTS:
            attempts += 1
            self._emit("transform", f"auto-repairing {step['id']} (attempt {attempts}/{MAX_REPAIR_ATTEMPTS})")

            # 1. Roll back to the pre-step state before each attempt
            await workflow.execute_activity(
                restore_working_activity,
                {"session_id": self.session_id, "label": snapshot_label},
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )

            # 2. Generate custom code with the failure reason as context
            code_result = await workflow.execute_activity(
                generate_custom_code_activity,
                {
                    "session_id": self.session_id,
                    "step": repair_step,
                    "prior_context": "",
                    "human_instruction": None,
                    "failure_context": failure_reason,
                },
                start_to_close_timeout=AI_ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            if not code_result.get("validation_passed"):
                continue
            last_code = code_result.get("custom_code")

            # 3. Apply the custom code
            repair_spec = {
                "id": f"{step['id']}_repair_{attempts}",
                "type": "custom",
                "params": {},
                "custom_code": last_code,
                "rationale": f"Auto-repair of {step['id']}: {failure_reason}",
            }
            try:
                apply_result = await workflow.execute_activity(
                    apply_transformation_activity,
                    {"session_id": self.session_id, "transformation_spec": repair_spec},
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
            except Exception:
                continue

            # 4. Re-measure
            scorecard_result = await workflow.execute_activity(
                update_scorecard_activity,
                {"session_id": self.session_id, "approved_rules": self.approved_rules},
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
            new_score = scorecard_result.get("quality_score", pre_step_score)
            new_per_rule = scorecard_result.get("per_rule", [])
            score_delta = new_score - pre_step_score
            post_failures = _total_failures(new_per_rule)
            resolution = _resolution_from_counts(pre_step_total_failures, post_failures)
            targets = set(step.get("targets_rules", []))
            regressions = [
                {
                    "rule_id": r.get("id"),
                    "column": r.get("column"),
                    "check": r.get("check"),
                    "failure_count": r.get("failure_count", 0),
                    "rationale": (r.get("rationale", "") or "")[:80],
                }
                for r in new_per_rule
                if r.get("id") in pre_step_passing
                and not r.get("passed")
                and r.get("id") not in targets
            ]

            # 5. Improvement check: affected rows, no new regressions, non-negative score
            improved = (
                apply_result.get("affected_rows", 0) > 0
                and not regressions
                and score_delta >= 0
            )
            if improved:
                self.current_score = new_score
                return {
                    "repaired": True,
                    "custom_code": last_code,
                    "attempts": attempts,
                    "actual_score_delta": score_delta,
                    "actual_resolution": resolution,
                    "regressions": regressions,
                    "new_per_rule": new_per_rule,
                }

        # Exhausted — restore the pre-step state so escalation sees clean data
        await workflow.execute_activity(
            restore_working_activity,
            {"session_id": self.session_id, "label": snapshot_label},
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=ACTIVITY_RETRY,
        )
        return {"repaired": False, "custom_code": last_code, "attempts": attempts}
```

If a `self._emit` helper does not already exist on the class, use whatever emit pattern the workflow already uses for stage messages (search the file for an existing emit/`workflow.logger` call and match it). Do not invent a new emit channel.

- [ ] **Step 3: Verify the workflow module imports cleanly**

Run: `uv run python -c "import backend.temporal.workflows.dq_workflow"`
Expected: exits 0.

- [ ] **Step 4: Lint + commit**

```bash
ruff check backend/temporal/workflows/dq_workflow.py
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat(temporal): add bounded custom-code repair helper to workflow"
```

---

## Task 5: Wire repair into the transformation loop

**Files:**
- Modify: `backend/temporal/workflows/dq_workflow.py` (TRANSFORMATION_LOOP, lines 738-1158)

- [ ] **Step 1: Snapshot before applying each step**

In the loop, immediately after the pre-step snapshot block (the `pre_step_passing` / `pre_step_score` / `pre_step_total_failures` assignment ending ~line 744), add a working-data snapshot and capture the label:

```python
            snapshot_label = f"pre_step_{i}"
            await workflow.execute_activity(
                snapshot_working_activity,
                {"session_id": self.session_id, "label": snapshot_label},
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
```

- [ ] **Step 2: Detect failure and attempt repair before escalation**

The escalation decision currently begins at the `if escalation_type:` block (line 1051). Insert a repair attempt directly before it. The failure condition reuses the already-computed signals (`escalation_type`, `affected_rows`, `actual_score_delta`). Add this block immediately before `if escalation_type:`:

```python
            # 7c. Auto-repair: before escalating, try to achieve the step's intent
            # with custom code. Reuses the pre-step snapshot for rollback.
            affected_rows_now = apply_result.get("affected_rows", 0)
            failed = bool(escalation_type) or affected_rows_now == 0 or actual_score_delta < 0
            repair_attempts_used = 0
            repaired_from: str | None = None
            if failed:
                if affected_rows_now == 0:
                    failure_reason = "Transform had no effect (0 rows affected)."
                elif actual_score_delta < 0:
                    failure_reason = f"Transform lowered the quality score by {actual_score_delta:+.4f}."
                else:
                    failure_reason = escalation_desc or "Transform did not achieve its goal."

                repair = await self._attempt_repair(
                    steps, i, failure_reason,
                    pre_step_score, pre_step_total_failures, pre_step_passing,
                    snapshot_label,
                )
                repair_attempts_used = repair.get("attempts", 0)
                if repair.get("repaired"):
                    # Adopt the repaired result and clear the escalation
                    repaired_from = step.get("type", "")
                    steps[i]["custom_code"] = repair.get("custom_code")
                    actual_score_delta = repair.get("actual_score_delta", actual_score_delta)
                    actual_resolution = repair.get("actual_resolution", actual_resolution)
                    regressions = repair.get("regressions", [])
                    new_per_rule = repair.get("new_per_rule", new_per_rule)
                    self.validation_results = _cap_failing_rows({
                        "per_rule": new_per_rule or self.validation_results.get("per_rule", []),
                        "category_scores": self.validation_results.get("category_scores", {}),
                        "baseline_quality_score": self.baseline_quality_score,
                    })
                    steps[i]["actual_resolution"] = round(actual_resolution, 4)
                    escalation_type = None  # repaired — skip human escalation
                else:
                    # Repair failed; pre-step data already restored. Carry context.
                    escalation_context = {
                        **escalation_context,
                        "repair_attempts": repair_attempts_used,
                        "last_repair_code": repair.get("custom_code"),
                    }
                    if escalation_type is None:
                        escalation_type = "transform_verification_failed"
                        escalation_desc = failure_reason
```

- [ ] **Step 3: Record repair fields on the log entry**

In the log-append block (lines 1139-1158), add the two new fields to the appended dict:

```python
                    "regressions": regressions,
                    "post_step_per_rule": post_step_per_rule,
                    "repair_attempts": repair_attempts_used,
                    "repaired_from": repaired_from,
```

- [ ] **Step 4: Drop the snapshot once the step settles**

After the log-append block, still inside the `for i, step` loop, drop the snapshot so snapshot tables do not accumulate:

```python
            await workflow.execute_activity(
                drop_working_snapshot_activity,
                {"session_id": self.session_id, "label": snapshot_label},
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
```

- [ ] **Step 5: Verify the module imports cleanly**

Run: `uv run python -c "import backend.temporal.workflows.dq_workflow"`
Expected: exits 0.

- [ ] **Step 6: Lint + commit**

```bash
ruff check backend/temporal/workflows/dq_workflow.py
git add backend/temporal/workflows/dq_workflow.py
git commit -m "feat(temporal): auto-repair failed transforms with custom code before escalating"
```

---

## Task 6: Workflow-level repair test

**Files:**
- Test: `tests/backend/test_transform_repair_loop.py`

This is an integration-style test of `_attempt_repair` using a stub workflow harness, since driving the full Temporal workflow is heavy. It patches `workflow.execute_activity` to return canned activity results.

- [ ] **Step 1: Write the test**

```python
# tests/backend/test_transform_repair_loop.py
import pytest

import backend.temporal.workflows.dq_workflow as wf


class _Harness(wf.DQAcceleratorWorkflow):
    """Subclass that bypasses __init__ to test _attempt_repair in isolation."""
    def __init__(self):
        self.session_id = "s1"
        self.approved_rules = [{"id": "r1", "category": "validity", "threshold": 0.0}]
        self.current_score = 0.5
        self.baseline_quality_score = 0.5
        self.validation_results = {"per_rule": [], "category_scores": {}}

    def _emit(self, *a, **k):
        pass


@pytest.fixture
def patched_activities(monkeypatch):
    """Queue of canned results keyed by activity function."""
    calls = []

    async def fake_execute_activity(fn, params, **kwargs):
        calls.append((getattr(fn, "__name__", str(fn)), params))
        name = getattr(fn, "__name__", str(fn))
        if name == "restore_working_activity":
            return {"ok": True}
        if name == "generate_custom_code_activity":
            return {"custom_code": "def transform(df):\n    return df", "validation_passed": True}
        if name == "apply_transformation_activity":
            return {"affected_rows": 10, "row_count_before": 100, "row_count_after": 100}
        if name == "update_scorecard_activity":
            return {"quality_score": 0.9, "per_rule": [{"id": "r1", "passed": True, "failure_count": 0}]}
        return {}

    monkeypatch.setattr(wf.workflow, "execute_activity", fake_execute_activity)
    return calls


async def test_attempt_repair_succeeds_and_keeps_result(patched_activities):
    h = _Harness()
    steps = [{"id": "step_1", "type": "null_invalid", "params": {"columns": ["email"]},
              "column": "email", "targets_rules": ["r1"]}]
    result = await h._attempt_repair(
        steps, 0, "no effect", 0.5, 5, set(), "pre_step_0",
    )
    assert result["repaired"] is True
    assert result["attempts"] == 1
    assert h.current_score == 0.9
    # The successful path must NOT issue a final restore beyond per-attempt rollback
    restores = [c for c in patched_activities if c[0] == "restore_working_activity"]
    assert len(restores) == 1  # one pre-attempt rollback only


async def test_attempt_repair_exhausts_budget_and_restores(monkeypatch):
    h = _Harness()

    async def fake_execute_activity(fn, params, **kwargs):
        name = getattr(fn, "__name__", str(fn))
        if name == "generate_custom_code_activity":
            return {"custom_code": None, "validation_passed": False}
        return {"ok": True}

    monkeypatch.setattr(wf.workflow, "execute_activity", fake_execute_activity)
    steps = [{"id": "step_1", "type": "null_invalid", "params": {}, "column": "email"}]
    result = await h._attempt_repair(steps, 0, "no effect", 0.5, 5, set(), "pre_step_0")
    assert result["repaired"] is False
    assert result["attempts"] == wf.MAX_REPAIR_ATTEMPTS
```

- [ ] **Step 2: Run the test**

Run: `uv run pytest tests/backend/test_transform_repair_loop.py -v`
Expected: PASS (2 passed). If `_attempt_repair`'s control flow differs, adjust the canned results — do not weaken the assertions about repaired/attempts.

- [ ] **Step 3: Run the full backend suite to check for regressions**

Run: `uv run pytest tests/backend -q`
Expected: no NEW failures vs. the pre-existing baseline (the repo baseline is 9 DB errors + ruff items per project memory; confirm the count is unchanged).

- [ ] **Step 4: Lint + commit**

```bash
ruff check tests/backend/test_transform_repair_loop.py
git add tests/backend/test_transform_repair_loop.py
git commit -m "test(temporal): cover transform auto-repair success and budget-exhaustion paths"
```

---

## Self-Review Notes (for the implementer)

- The snapshot label is validated against `[A-Za-z0-9_]+` so `pre_step_{i}` is always safe to interpolate.
- `_attempt_repair` rolls back **before each attempt** so attempts never stack on each other.
- The success path adopts the repaired per-rule state into `self.validation_results` via `_cap_failing_rows`, matching how the normal path updates it (lines 949-955).
- `repaired_from`/`repair_attempts` are additive log fields — existing consumers ignore unknown keys.
- If the existing class uses `workflow.logger.info` instead of a `_emit` helper, swap the emit calls accordingly (noted in Task 4 Step 2).
