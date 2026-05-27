from backend.temporal.workflows.dq_workflow import (
    _cap_failing_rows,
    _strip_log_failing_rows,
    MAX_FAILING_ROWS,
)


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


def _entry(step_id, n_rules=36, n_rows=20):
    return {
        "id": step_id,
        "status": "applied",
        "post_step_per_rule": [
            {"id": f"r{i}", "check": "x", "passed": False, "failure_count": n_rows,
             "sample_failing_rows": [{"a": j} for j in range(n_rows)]}
            for i in range(n_rules)
        ],
    }


def test_strip_blanks_failing_rows_but_keeps_rule_structure():
    log = [_entry("s1"), _entry("s2")]
    out = _strip_log_failing_rows(log)
    for entry in out:
        assert len(entry["post_step_per_rule"]) == 36  # rules preserved
        for r in entry["post_step_per_rule"]:
            assert r["sample_failing_rows"] == []  # rows blanked
            assert r["failure_count"] == 20  # other fields preserved


def test_strip_leaves_non_post_step_entries_untouched():
    log = [{"id": "skip", "status": "skipped", "regressions": []}]
    assert _strip_log_failing_rows(log) == log


def test_strip_does_not_mutate_input():
    log = [_entry("s1")]
    _strip_log_failing_rows(log)
    assert log[0]["post_step_per_rule"][0]["sample_failing_rows"] != []  # original intact


def test_append_pattern_keeps_rows_only_on_latest_and_stays_bounded():
    """Mirror the workflow: strip prior entries, then append a rows-bearing one."""
    import json
    log = []
    for step in range(15):
        log = _strip_log_failing_rows(log)
        log.append(_entry(f"s{step}"))
        size = len(json.dumps(log, default=str))
        # Only one entry should ever carry failing rows, so the log cannot grow
        # without bound across steps.
        assert size < 200_000, f"log grew to {size} bytes at step {step}"
    with_rows = [e for e in log if any(r["sample_failing_rows"] for r in e["post_step_per_rule"])]
    assert len(with_rows) == 1
    assert with_rows[0]["id"] == "s14"  # the latest
