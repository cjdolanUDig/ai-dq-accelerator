from backend.api.rule_comparison import build_rule_comparison, latest_post_step_per_rule


def _rule(rid, passed, fails, check="chk", column="col"):
    return {"id": rid, "check": check, "column": column, "passed": passed, "failure_count": fails}


def test_status_fixed_regressed_unchanged():
    initial = [_rule("r1", False, 10), _rule("r2", True, 0), _rule("r3", True, 0)]
    final = [_rule("r1", True, 0), _rule("r2", False, 5), _rule("r3", True, 0)]
    out = {e["id"]: e for e in build_rule_comparison(initial, final)}
    assert out["r1"]["status"] == "fixed"
    assert out["r2"]["status"] == "regressed"
    assert out["r3"]["status"] == "unchanged"


def test_status_improved_and_worsened_when_still_failing():
    initial = [_rule("a", False, 100), _rule("b", False, 10)]
    final = [_rule("a", False, 40), _rule("b", False, 25)]
    out = {e["id"]: e for e in build_rule_comparison(initial, final)}
    assert out["a"]["status"] == "improved"
    assert out["b"]["status"] == "worsened"


def test_missing_final_falls_back_to_initial():
    initial = [_rule("only", False, 7)]
    out = build_rule_comparison(initial, [])
    assert out[0]["final_passed"] is False
    assert out[0]["final_failures"] == 7
    assert out[0]["status"] == "unchanged"
    assert out[0]["check"] == "chk" and out[0]["column"] == "col"


def test_empty_initial_returns_empty():
    assert build_rule_comparison([], [_rule("x", True, 0)]) == []
    assert build_rule_comparison(None, None) == []


def test_latest_post_step_per_rule_picks_last_nonempty():
    log = [
        {"id": "s1", "post_step_per_rule": [_rule("r1", False, 5)]},
        {"id": "s2"},
        {"id": "s3", "post_step_per_rule": [_rule("r1", True, 0)]},
        {"id": "s4", "post_step_per_rule": []},
    ]
    final = latest_post_step_per_rule(log)
    assert final == [_rule("r1", True, 0)]


def test_latest_post_step_per_rule_empty_when_none():
    assert latest_post_step_per_rule([{"id": "s1"}, {"id": "s2"}]) == []
    assert latest_post_step_per_rule([]) == []
