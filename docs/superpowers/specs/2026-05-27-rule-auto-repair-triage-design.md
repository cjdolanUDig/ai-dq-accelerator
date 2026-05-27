# Rule Auto-Repair in Triage — Design

**Date:** 2026-05-27
**Status:** Approved for planning

## Problem

When a rule's SQL throws an error during validation (bad regex, missing column,
malformed `custom_sql`, etc.), `run_rules` catches it, marks the rule
`passed=False` with `failure_count=0`, and stores the message in an `error`
field (`dq_tools/rule_engine.py:329-352`). Triage then classifies it as
`eval_error` and defaults to `proposed_remove=True`
(`backend/agents/graphs/triage_agent.py`). The user never sees a working rule —
only a removal proposal.

## Goal

When a rule is classified `eval_error`, rewrite it and re-validate it against
DuckDB *before* showing the user. Present a working corrected rule flagged
"auto-repaired" instead of proposing removal. Fall back to removal only if the
rewrite cannot be made to execute within a small attempt budget.

Scope is **`eval_error` only** — genuine execution errors. Rules that run fine
but resolve little are out of scope.

## Current Behavior (as-is)

- Rules are dicts: `id`, `check`, `column`, `category`, `threshold`,
  `rationale`, plus type-specific params (`pattern`, `values`, `min`/`max`,
  `format`, `condition`, `col_a`/`col_b`).
- `run_rules` builds a failing-row SQL condition per rule
  (`_build_failing_condition` `:57-119`), executes it, and on exception sets
  `error = str(exc)` (`:329-352`).
- Triage (`triage_agent.py:208-349`) classifies failing rules into
  `transform_fixable` / `threshold_too_strict` / `unfixable` / `eval_error`.
  The agent already has tools: `run_sql`, `check_regex_pattern`,
  `get_column_detail`, `get_sample_rows`.
- AWAITING_TRIAGE_APPROVAL (`dq_workflow.py:575-604`) presents amendments
  (`accepted_threshold_changes`, `rejected_rule_ids`) for human decision; on
  accept they are applied to `approved_rules`.

## Design

### Single-rule validation helper

Add to `dq_tools/rule_engine.py`:

- `validate_single_rule(session_id, rule) -> dict` — run one rule and return
  its per-rule result including `error`. (May wrap `run_rules` with a one-rule
  list to reuse the existing condition builder and error handling.)

### Repair node

Add a repair node to `triage_agent.py`, running for each rule classified
`eval_error`. Budget: **2 attempts** (configurable constant).

For each attempt:
1. Feed Claude the DuckDB error message, the rule dict, and the table schema;
   ask for a corrected rule preserving the original check type and intent
   (fix the `pattern` / `column` / `condition` / `custom_sql`).
2. Re-validate via `validate_single_rule`.
3. **Executes cleanly** (no `error`) → set classification `auto_repaired`,
   attach `proposed_fix` (the corrected rule dict). Break.
   **Still erroring** → next attempt.

Budget exhausted → fall back to `eval_error` with `proposed_remove=True`
(current behavior).

### Data-structure additions

Triage result per rule gains:
- `classification` value `auto_repaired` (new enum member).
- `proposed_fix: dict | None` — the corrected rule, validated to execute.

AWAITING_TRIAGE_APPROVAL amendment payload gains a `repaired_rules` section:
`[{rule_id, original_rule, proposed_fix, error, confidence}]`. Accepting a
repair swaps the broken rule for `proposed_fix` in `approved_rules`; rejecting
falls back to removal.

### Telemetry

Emit `repairing rule {id} (attempt n/2)` and the outcome
(`auto_repaired` / `removal`).

## Components Touched

- `dq_tools/rule_engine.py` — `validate_single_rule` helper.
- `backend/agents/graphs/triage_agent.py` — repair node, prompt, emit; extend
  classification validation (`_validate_classifications`) for `auto_repaired`
  and `proposed_fix`.
- `backend/temporal/workflows/dq_workflow.py` — carry `proposed_fix` through
  triage state; apply the swap in the amendment-accept path.
- `backend/api/schemas.py` — triage/amendment response gains `repaired_rules`.
- Frontend triage view — render auto-repaired rules with a before/after diff
  and an "auto-repaired" badge.

## Error Handling

- A corrected rule that itself errors consumes one attempt; final fallback is
  removal so the pipeline always has a clean decision.
- The repair node must never *broaden* a rule into a no-op (e.g. a condition
  that matches nothing): require `proposed_fix` to keep the same `check` type
  and target column(s); reject fixes that change check type.

## Testing

- A rule with an invalid regex is rewritten to a valid one and re-validates;
  classification becomes `auto_repaired` with a `proposed_fix`.
- A rule referencing a missing column is repaired to the correct column.
- An unrepairable rule falls back to `proposed_remove` after the budget.
- Accepting a `repaired_rules` amendment swaps the rule in `approved_rules`;
  rejecting removes it.
- `_validate_classifications` accepts the new `auto_repaired` / `proposed_fix`
  shape and rejects a `proposed_fix` that changes the check type.

## Out of Scope

- Repairing rules that execute successfully but are low-value.
- Auto-accepting repairs without the human approval gate.
