"""Tests for the per-step 'failures resolved' metric helpers in the workflow."""
from backend.temporal.workflows.dq_workflow import (
    _total_failures,
    _failures_for_rules,
    _resolution_from_counts,
    _preview_resolution,
)


def test_total_failures_sums_failure_counts():
    per_rule = [{"id": "r1", "failure_count": 5}, {"id": "r2", "failure_count": 0},
                {"id": "r3", "failure_count": 12}]
    assert _total_failures(per_rule) == 17


def test_failures_for_rules_restricts_to_targets():
    per_rule = [{"id": "r1", "failure_count": 5}, {"id": "r2", "failure_count": 8},
                {"id": "r3", "failure_count": 12}]
    assert _failures_for_rules(per_rule, ["r1", "r3"]) == 17
    assert _failures_for_rules(per_rule, []) == 0
    assert _failures_for_rules(per_rule, None) == 0


def test_resolution_from_counts():
    assert _resolution_from_counts(100, 25) == 0.75
    assert _resolution_from_counts(0, 0) == 0.0       # nothing to resolve
    assert _resolution_from_counts(10, 15) == 0.0     # regression clamps to 0
    assert _resolution_from_counts(10, 0) == 1.0


def test_preview_resolution_from_fail_counts():
    preview = {
        "rule_fail_counts_before": {"r1": 10, "r2": 10},
        "rule_fail_counts_after": {"r1": 0, "r2": 5},
    }
    assert _preview_resolution(preview) == 0.75  # 20 -> 5 resolved 15/20


def test_preview_resolution_none_without_counts():
    assert _preview_resolution({"rule_fail_counts_before": None}) is None
    assert _preview_resolution({}) is None


def test_preview_resolution_zero_when_no_failures():
    assert _preview_resolution({"rule_fail_counts_before": {"r1": 0}, "rule_fail_counts_after": {"r1": 0}}) == 0.0
