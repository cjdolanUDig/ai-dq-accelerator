"""Each graph module must tag emitted events with its frontend stage id."""
import json

import pytest

CASES = [
    ("backend.agents.graphs.deep_rule_review", "_emit", "rules"),
    ("backend.agents.graphs.validation_analyzer", "emit", "validate"),
    ("backend.agents.graphs.triage_agent", "_emit", "triage"),
    ("backend.agents.graphs.deep_plan", "_emit", "plan"),
    ("backend.agents.graphs.transform_planner", "emit", "plan"),
    ("backend.agents.graphs.transformation_advisor", "emit", "transform"),
    ("backend.agents.graphs.custom_code_generator", "emit", "transform"),
    ("backend.agents.graphs.scorecard_narrator", "emit", "scorecard"),
]


@pytest.mark.parametrize("module_path, fn_name, expected_stage", CASES)
def test_graph_emit_wrapper_tags_stage(module_path, fn_name, expected_stage, tmp_path, monkeypatch):
    import importlib

    import backend.agents.emit as emit_mod

    monkeypatch.setattr(emit_mod, "_find_project_root", lambda: tmp_path)
    mod = importlib.import_module(module_path)
    wrapper = getattr(mod, fn_name)
    wrapper("sess-x", "thinking", text="hello")

    line = (tmp_path / "data" / "sessions" / "sess-x" / "investigation_progress.jsonl").read_text().strip()
    assert json.loads(line)["stage"] == expected_stage
