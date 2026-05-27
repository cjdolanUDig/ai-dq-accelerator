# Plan — Seven fixes (2026-05-27)

Context gathered via investigation agents + direct reads. Approved approach for item 6: meaningful per-step % + real divergence.

## 1. Pass passing+failing rules to triage (contradiction detection)
- `dq_workflow.py` TRIAGING stage (~521): also pass `passing_rules` (per_rule where passed) alongside `failing_rules`.
- `triage_activities.py`: accept `passing_rules`, forward to `run_triage_agent`.
- `triage_agent.py` + `state.py`: add `passing_rules` to state; include them in the `_detect_triage_contradictions` prompt so fix-cascades against currently-passing rules can be found.
- `prompts.py` TRIAGE_CONTRADICTION_SYSTEM: instruct detection of fixes that would break currently-passing rules.
- Test: triage agent contradiction prompt includes passing rules; activity forwards them.

## 2. Downloads: custom-step code empty + wrong dbt template
- Concrete bug: generated `dbt_project/models/staging/custom_step_*.py` have `code=""` and emit an Airflow `PythonOperator` (wrong for dbt).
- Trace `pipeline_generator.generate()` custom-step handling; ensure `custom_code` from transformation_log flows in (load from disk log / pass through).
- Fix the dbt custom-step template to embed the real code (and not be an Airflow operator).
- Verify cleaned_data.parquet = transformed `working_data`.
- Test: generate() writes non-empty custom code into the dbt/python artifacts.

## 3. AIPanel "This stage"/"AI Activity" text wrap
- `AIPanel.tsx:185-199` scope buttons — allow wrap (remove nowrap/relax fixed height). Also check the "AI Activity" header label.

## 4. Plan stage AI Activity not appearing
- Root cause hypothesis: SSE stream closes 30s after a `done` (sessions.py `POST_DONE_TIMEOUT`), and human-approval gaps before PLANNING exceed that → stream dead before plan emits; `useAIStream` may also close on done.
- Fix: keep stream alive across approval gaps (don't early-close while workflow running / rely on Last-Event-ID reconnect; bump/remove POST_DONE_TIMEOUT and ensure frontend reconnects).

## 5. plan_transforms_activity: deep agent or loop? — ANSWERED
- It is a `deepagents` multi-turn agent (`create_deep_agent`, `deep_plan.py`). No code change; informs item 6.

## 6. Score deltas (+100% custom / 0.0% prebuilt) + every-step stall  [APPROVED: meaningful % + real divergence]
- `transformation_executor.preview`: also return per-rule before/after failure info (so we can compute targeted-rule resolution).
- Compute per-step metric = expected % of the step's targeted-rule failures resolved (custom + prebuilt), surfaced as the displayed estimate.
- Divergence escalation (dq_workflow ~908): compare actual vs the REAL execution-time preview delta (already computed per step at ~772), not the plan-time Claude estimate.
- Frontend PlanReviewStage/ExecutionStage: display the new metric sensibly.
- Tests: metric computation; divergence uses execution preview.

## 7. Custom code readability on Transform page
- `CodeBlock.theme.ts`: remove inherited `textShadow` (the blur) and switch to dark, high-contrast token colors for the light background.

## Verify
ruff + uv pytest tests/backend + frontend jest; spot-check generated artifacts.
