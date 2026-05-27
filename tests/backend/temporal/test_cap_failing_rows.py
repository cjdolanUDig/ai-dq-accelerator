from backend.temporal.workflows.dq_workflow import _cap_failing_rows, MAX_FAILING_ROWS


def test_caps_rows_to_limit():
    vr = {"per_rule": [{"id": "r1", "sample_failing_rows": [{"x": i} for i in range(100)]}]}
    out = _cap_failing_rows(vr)
    assert len(out["per_rule"][0]["sample_failing_rows"]) == MAX_FAILING_ROWS


def test_preserves_other_fields_and_short_rows():
    vr = {
        "baseline_quality_score": 0.5,
        "per_rule": [
            {"id": "r1", "failure_count": 2, "sample_failing_rows": [{"x": 1}, {"x": 2}]},
            {"id": "r2", "passed": True},  # no sample_failing_rows key
        ],
    }
    out = _cap_failing_rows(vr)
    assert out["baseline_quality_score"] == 0.5
    assert out["per_rule"][0]["sample_failing_rows"] == [{"x": 1}, {"x": 2}]
    assert out["per_rule"][0]["failure_count"] == 2
    assert out["per_rule"][1] == {"id": "r2", "passed": True}


def test_empty_or_missing_per_rule_is_noop():
    assert _cap_failing_rows({}) == {}
    assert _cap_failing_rows({"per_rule": []}) == {"per_rule": []}


def test_does_not_mutate_input():
    rows = [{"x": i} for i in range(50)]
    vr = {"per_rule": [{"id": "r1", "sample_failing_rows": rows}]}
    _cap_failing_rows(vr)
    assert len(vr["per_rule"][0]["sample_failing_rows"]) == 50  # original untouched
