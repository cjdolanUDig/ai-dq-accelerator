"""Pure helpers to build the Scorecard's per-rule initial-vs-final comparison."""
from __future__ import annotations

from typing import Any

STATUS_FIXED = "fixed"
STATUS_REGRESSED = "regressed"
STATUS_IMPROVED = "improved"
STATUS_WORSENED = "worsened"
STATUS_UNCHANGED = "unchanged"


def _status(init_passed: bool, init_fail: int, final_passed: bool, final_fail: int) -> str:
    if not init_passed and final_passed:
        return STATUS_FIXED
    if init_passed and not final_passed:
        return STATUS_REGRESSED
    if init_passed and final_passed:
        return STATUS_UNCHANGED
    # both still failing — compare failure counts
    if final_fail < init_fail:
        return STATUS_IMPROVED
    if final_fail > init_fail:
        return STATUS_WORSENED
    return STATUS_UNCHANGED


def latest_post_step_per_rule(transformation_log: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Return the most recent non-empty post_step_per_rule from the transform log,
    i.e. the final per-rule state. Empty list if no step recorded one."""
    for entry in reversed(transformation_log or []):
        psr = entry.get("post_step_per_rule")
        if psr:
            return psr
    return []


def build_rule_comparison(
    initial_per_rule: list[dict[str, Any]] | None,
    final_per_rule: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Join initial + final per-rule results by id. When a rule is missing from
    final, fall back to its initial state (no observed change)."""
    final_by_id = {r.get("id"): r for r in (final_per_rule or [])}
    out: list[dict[str, Any]] = []
    for r in initial_per_rule or []:
        rid = r.get("id")
        fin = final_by_id.get(rid, r)
        init_passed = bool(r.get("passed", False))
        init_fail = int(r.get("failure_count", 0) or 0)
        final_passed = bool(fin.get("passed", False))
        final_fail = int(fin.get("failure_count", 0) or 0)
        out.append({
            "id": rid,
            "check": r.get("check", ""),
            "column": r.get("column"),
            "category": r.get("category", "") or "",
            "initial_passed": init_passed,
            "initial_failures": init_fail,
            "final_passed": final_passed,
            "final_failures": final_fail,
            "final_sample_failing_rows": list(fin.get("sample_failing_rows") or [])[:20],
            "status": _status(init_passed, init_fail, final_passed, final_fail),
        })
    return out
