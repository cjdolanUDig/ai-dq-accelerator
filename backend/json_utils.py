"""JSON-safe serialization helpers.

Python's ``json.dumps`` emits the bare literals ``NaN``, ``Infinity`` and
``-Infinity`` for non-finite floats. Those are valid Python-JSON but invalid per
the JSON spec, so PostgreSQL's JSONB parser and the browser's ``JSON.parse``
both reject them. pandas/numpy routinely produce ``NaN`` (ratios with a zero
denominator, ``std()`` of a single row, the mean of an all-null column), which
flows into snapshot payloads and API responses. Sanitize at the serialization
boundary so non-finite floats can never reach the database or the wire.
"""
from __future__ import annotations

import json
import math
from typing import Any


def json_safe(obj: Any) -> Any:
    """Recursively replace non-finite floats (NaN/Inf/-Inf) with ``None``."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj


def dumps_safe(obj: Any, **kwargs: Any) -> str:
    """``json.dumps`` that never emits ``NaN``/``Infinity`` tokens."""
    return json.dumps(json_safe(obj), **kwargs)
