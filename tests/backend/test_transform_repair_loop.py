import pytest

import backend.temporal.workflows.dq_workflow as wf


class _Harness(wf.DQAcceleratorWorkflow):
    """Bypass workflow initialization to test _attempt_repair in isolation."""

    def __init__(self):
        self.session_id = "s1"
        self.approved_rules = [{"id": "r1", "category": "validity", "threshold": 0.0}]
        self.current_score = 0.5
        self.baseline_quality_score = 0.5
        self.validation_results = {"per_rule": [], "category_scores": {}}


@pytest.fixture(autouse=True)
def patch_workflow_logger(monkeypatch):
    monkeypatch.setattr(wf.workflow.logger, "info", lambda *args, **kwargs: None)


@pytest.fixture
def patched_activities(monkeypatch):
    """Queue canned activity results by activity function name."""
    calls = []

    async def fake_execute_activity(fn, params, **kwargs):
        calls.append((getattr(fn, "__name__", str(fn)), params))
        name = getattr(fn, "__name__", str(fn))
        if name == "restore_working_activity":
            return {"ok": True}
        if name == "generate_custom_code_activity":
            return {
                "custom_code": "def transform(df):\n    return df",
                "validation_passed": True,
            }
        if name == "apply_transformation_activity":
            return {"affected_rows": 10, "row_count_before": 100, "row_count_after": 100}
        if name == "update_scorecard_activity":
            return {
                "quality_score": 0.9,
                "per_rule": [{"id": "r1", "passed": True, "failure_count": 0}],
            }
        return {}

    monkeypatch.setattr(wf.workflow, "execute_activity", fake_execute_activity)
    return calls


async def test_attempt_repair_succeeds_and_keeps_result(patched_activities):
    h = _Harness()
    steps = [
        {
            "id": "step_1",
            "type": "null_invalid",
            "params": {"columns": ["email"]},
            "column": "email",
            "targets_rules": ["r1"],
        }
    ]

    result = await h._attempt_repair(steps, 0, "no effect", 0.5, 5, set(), "pre_step_0")

    assert result["repaired"] is True
    assert result["attempts"] == 1
    assert h.current_score == 0.9
    restores = [c for c in patched_activities if c[0] == "restore_working_activity"]
    assert len(restores) == 1


async def test_attempt_repair_exhausts_budget_and_restores(monkeypatch):
    h = _Harness()
    calls = []

    async def fake_execute_activity(fn, params, **kwargs):
        calls.append((getattr(fn, "__name__", str(fn)), params))
        name = getattr(fn, "__name__", str(fn))
        if name == "generate_custom_code_activity":
            return {"custom_code": None, "validation_passed": False}
        return {"ok": True}

    monkeypatch.setattr(wf.workflow, "execute_activity", fake_execute_activity)
    steps = [{"id": "step_1", "type": "null_invalid", "params": {}, "column": "email"}]

    result = await h._attempt_repair(steps, 0, "no effect", 0.5, 5, set(), "pre_step_0")

    assert result["repaired"] is False
    assert result["attempts"] == wf.MAX_REPAIR_ATTEMPTS
    restores = [c for c in calls if c[0] == "restore_working_activity"]
    assert len(restores) == wf.MAX_REPAIR_ATTEMPTS + 1
