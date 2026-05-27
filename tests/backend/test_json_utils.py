"""JSON sanitization: non-finite floats (NaN/Inf) must never reach JSONB or HTTP.

PostgreSQL JSONB and browser JSON.parse both reject the bare ``NaN``/``Infinity``
tokens that Python's ``json.dumps`` emits by default.
"""
import json

from backend.json_utils import dumps_safe, json_safe


def test_json_safe_replaces_non_finite_floats_with_none():
    out = json_safe(
        {"a": float("nan"), "b": [float("inf"), 1.5], "c": {"d": float("-inf")}}
    )
    assert out == {"a": None, "b": [None, 1.5], "c": {"d": None}}


def test_json_safe_preserves_finite_values():
    payload = {"score": 0.701961, "ints": [1, 2], "s": "ok", "none": None, "b": True}
    assert json_safe(payload) == payload


def test_dumps_safe_emits_no_nan_or_infinity_tokens():
    s = dumps_safe({"x": float("nan"), "y": float("inf"), "z": float("-inf")})
    assert "NaN" not in s
    assert "Infinity" not in s
    # Re-parsing yields nulls for the non-finite values.
    assert json.loads(s) == {"x": None, "y": None, "z": None}
