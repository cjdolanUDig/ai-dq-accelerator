from types import SimpleNamespace

import backend.agents.graphs.custom_code_generator as ccg


def _fake_response(code: str):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=f"```python\n{code}\n```")])


def test_failure_context_is_included_in_prompt(monkeypatch):
    captured = {}

    def fake_call(client, **kwargs):
        captured["messages"] = kwargs["messages"]
        return _fake_response("def transform(df):\n    return df")

    monkeypatch.setattr(ccg, "call_claude_with_retry", fake_call)
    monkeypatch.setattr(ccg, "_investigate_context", lambda sid, step: [])
    monkeypatch.setattr(ccg, "_dry_run", lambda code, df: None)

    result = ccg.run_custom_code_generator(
        session_id="s1",
        step={"id": "step_1", "intent": "null out invalid emails", "target_columns": ["email"]},
        prior_context="",
        human_instruction=None,
        failure_context="Prebuilt null_invalid had no effect: 0 rows affected.",
    )

    assert result["validation_passed"] is True
    prompt_text = "".join(
        m["content"] for m in captured["messages"] if isinstance(m.get("content"), str)
    )
    assert "no effect" in prompt_text
