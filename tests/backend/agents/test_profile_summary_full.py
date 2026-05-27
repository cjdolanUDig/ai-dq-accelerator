"""The propose_rules node must not truncate the data passport in ai_summary."""


def test_ai_summary_keeps_full_passport():
    from backend.agents.graphs import profile_analyzer

    # build a passport longer than the old 1500-char cap
    long_passport = "A" + ("x" * 4000) + "Z"
    state = {
        "overview_notes": "OVERVIEW",
        "data_passport": long_passport,
    }
    # _assemble_ai_summary is the extracted pure helper (Step 3)
    summary = profile_analyzer._assemble_ai_summary(state)

    assert summary.startswith("OVERVIEW")
    assert summary.endswith("Z")            # tail not chopped
    assert long_passport in summary          # full passport present
