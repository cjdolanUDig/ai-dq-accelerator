# Self-Debugging Transform Loop — Design

**Date:** 2026-05-27
**Status:** Approved for planning

## Problem

In the `TRANSFORMATION_LOOP` stage, when a prebuilt transform produces no
effect or makes the dataset worse, the workflow escalates directly to a human
(`abort_plan` / `apply_suggestion` / `skip_step` / `provide_instruction`).
There is no automatic attempt to *fix* the step. We want the agent to first try
to achieve the step's intent by writing a custom-code block — falling back to
the human only when auto-repair also fails.

## Goal

When a step is judged failed, run a bounded auto-repair sub-loop that:
1. synthesizes a custom-code transform achieving the original step's intent,
2. rolls back the failed step, applies the custom code, and re-measures,
3. keeps the result if improved, retries within a budget, and escalates to the
   human only when the budget is exhausted — carrying the repair attempts as
   context.

This applies to failed **custom** steps too (regenerate with failure feedback),
not only prebuilt steps.

## Current Behavior (as-is)

`backend/temporal/workflows/dq_workflow.py` TRANSFORMATION_LOOP:

- Apply transform — `apply_transformation_activity` (`:871-936`)
- Update scorecard + per-rule state — `update_scorecard_activity` (`:938-955`)
- Measure resolution — `actual_resolution` (`:957-965`)
- Regression detection — passing→failing outside targets (`:967-986`)
- Divergence check — `actual_resolution < projected * 0.3` (`:1003-1007`)
- Agent verification — `verify_transform_activity` returns
  `{verdict, explanation, suggestion}` (`:1022-1049`)
- **If bad → escalate to human** (`:1051-1122`)

Custom-code generation already exists and is reusable:
`generate_custom_code_activity` → `run_custom_code_generator`
(`backend/agents/graphs/custom_code_generator.py:119-193`) does
context-investigation, an unsafe-pattern safety check, a dry-run against a
50-row DuckDB sample, and an internal 3-attempt fix loop.

Transforms write to DuckDB **in place** with no undo
(`dq_tools/transformation_executor.py` `apply_transformation` `:621-687`;
`_apply_transform` `:71-290`).

## Design

### Repair trigger ("failed / made worse")

After the existing per-step measurement, classify the step as failed if **any**
of these hold (all already computed today):

- `affected_rows == 0` (the existing `no_effect` status)
- `verify_transform_activity` verdict == `"incorrect"`
- net `score_delta < 0`
- new regressions introduced outside `targets_rules`

### Rollback primitive (new)

Add to `dq_tools/transformation_executor.py`:

- `snapshot_working(session_id, label) -> None` — copy `working_data` to
  `working_data__{label}` in the session DuckDB.
- `restore_working(session_id, label) -> None` — replace `working_data` from
  the snapshot.
- `drop_working_snapshot(session_id, label) -> None` — cleanup.

The workflow snapshots before applying a step (`label = pre_step_{i}`) and:
- drops the snapshot once the step settles successfully, or
- restores from it before each repair attempt and on final escalation.

### Repair sub-loop

Inserted in `dq_workflow.py` between measurement and the human escalation
block. Budget: **2 attempts** (configurable constant).

For each attempt:
1. Build a repair brief: original step intent + params, *why it failed*
   (no_effect / negative score / regression details / verifier explanation),
   before/after sample, and `targets_rules`.
2. Call `generate_custom_code_activity` with this brief (extend its input to
   accept `failure_context`). For a prebuilt step, the generated code must
   reproduce the prebuilt step's intent; for a failed custom step, regenerate
   with the failure as feedback.
3. `restore_working(pre_step_i)`, then apply the custom code via
   `apply_transformation_activity` (type `custom`).
4. Re-run `update_scorecard_activity`, recompute resolution / regressions, and
   re-run `verify_transform_activity`.
5. **Improved** (no longer matches the failed trigger) → keep; log the step
   with `repaired_from = <original type>` and `repair_attempts = n`. Break.
   **Not improved** → next attempt.

If the budget is exhausted: `restore_working(pre_step_i)` and escalate to the
human exactly as today, but include `repair_attempts` and the last generated
code/verdict in the escalation context.

### Transformation-log additions

Log entry (`dq_workflow.py:1139-1158`) gains:
- `repair_attempts: int` — number of custom-code repair tries.
- `repaired_from: str | None` — original step type if a repair replaced it.

`custom_code` is already logged for custom steps; the repaired code lands there.

### Telemetry

Emit stage-tagged events: `auto-repairing step {id} (attempt n/2)` and the
outcome (`repaired` / `escalated`).

## Components Touched

- `dq_tools/transformation_executor.py` — snapshot/restore/drop helpers.
- `backend/temporal/activities/transform_activities.py` — pass `failure_context`
  into `generate_custom_code_activity`.
- `backend/temporal/workflows/dq_workflow.py` — repair sub-loop, snapshot
  lifecycle, log fields, emit events.
- `backend/agents/graphs/custom_code_generator.py` — accept and use
  `failure_context` in the prompt.

## Error Handling

- Snapshot/restore failures abort repair and escalate (data integrity first).
- Generated code failing its own dry-run consumes one repair attempt.
- All snapshots are dropped on stage exit (success or escalation) to avoid
  DuckDB table bloat.

## Testing

- Unit: `snapshot_working` / `restore_working` round-trip restores row-identical
  data; `drop_working_snapshot` removes the table.
- Workflow: a no-effect prebuilt step triggers repair; a successful custom-code
  repair is kept and logged with `repaired_from`.
- Workflow: repair budget exhaustion restores pre-step data and escalates with
  repair context attached.
- Workflow: a step that succeeds normally never snapshots beyond the transient
  pre-step copy and leaves no lingering snapshot tables.

## Out of Scope

- Multi-step rollback / replanning the whole plan branch.
- Changing the existing human escalation options.
