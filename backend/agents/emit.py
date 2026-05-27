import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def _find_project_root() -> Path:
    p = Path(__file__).resolve()
    while p != p.parent:
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(".")


def cap_result(value, max_items: int = 50, max_str: int = 2000):
    """Bound a tool result for streaming: cap list lengths and string sizes,
    recursing into nested lists/dicts. Never slices mid-structure in a way that
    loses whole values — it limits element COUNT, not characters within a value
    (except oversized standalone strings, which get an explicit ellipsis)."""
    if isinstance(value, list):
        return [cap_result(v, max_items, max_str) for v in value[:max_items]]
    if isinstance(value, dict):
        return {k: cap_result(v, max_items, max_str) for k, v in value.items()}
    if isinstance(value, str):
        return value if len(value) <= max_str else value[:max_str] + "…"
    return value


def emit(session_id: str, event: str, *, stage: str | None = None, **kwargs) -> None:
    """Append a progress event to data/sessions/{session_id}/investigation_progress.jsonl."""
    payload = {"ts": datetime.now(timezone.utc).isoformat(), "event": event}
    if stage is not None:
        payload["stage"] = stage
    payload.update(kwargs)
    try:
        path = _find_project_root() / "data" / "sessions" / session_id / "investigation_progress.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(payload, default=str) + "\n")
    except Exception:
        pass
