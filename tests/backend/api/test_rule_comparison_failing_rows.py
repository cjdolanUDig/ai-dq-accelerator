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
