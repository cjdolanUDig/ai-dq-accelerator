import json

from backend.agents.emit import cap_result, emit


def test_cap_result_limits_list_length():
    out = cap_result(list(range(200)), max_items=50)
    assert out == list(range(50))


def test_cap_result_caps_nested_list_values_in_dict():
    src = {"total_rows": 70000, "sample": list(range(100))}
    out = cap_result(src, max_items=10)
    assert out["total_rows"] == 70000
    assert out["sample"] == list(range(10))


def test_cap_result_truncates_long_strings():
    out = cap_result("y" * 5000, max_str=100)
    assert out.endswith("…")
    assert len(out) == 101  # 100 chars + ellipsis


def test_cap_result_passes_through_scalars():
    assert cap_result(5) == 5
    assert cap_result(None) is None
    assert cap_result(True) is True


def test_emit_includes_stage_when_provided(tmp_path, monkeypatch):
    import backend.agents.emit as emit_mod

    monkeypatch.setattr(emit_mod, "_find_project_root", lambda: tmp_path)
    emit("sess-1", "tool_call", stage="profile", tool="dq_profile")

    line = (tmp_path / "data" / "sessions" / "sess-1" / "investigation_progress.jsonl").read_text().strip()
    payload = json.loads(line)
    assert payload["stage"] == "profile"
    assert payload["event"] == "tool_call"
    assert payload["tool"] == "dq_profile"


def test_emit_omits_stage_when_absent(tmp_path, monkeypatch):
    import backend.agents.emit as emit_mod

    monkeypatch.setattr(emit_mod, "_find_project_root", lambda: tmp_path)
    emit("sess-2", "done")

    line = (tmp_path / "data" / "sessions" / "sess-2" / "investigation_progress.jsonl").read_text().strip()
    payload = json.loads(line)
    assert "stage" not in payload
