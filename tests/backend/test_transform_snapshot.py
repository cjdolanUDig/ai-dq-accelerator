import pytest
import pandas as pd

from dq_tools.db import duckdb_connect
from dq_tools.transformation_executor import (
    _db_path,
    _session_dir,
    drop_working_snapshot,
    restore_working,
    snapshot_working,
)


def _make_session(tmp_path, monkeypatch, df):
    """Create a session DuckDB with a working_data table under a temp project root."""
    monkeypatch.setattr(
        "dq_tools.transformation_executor._find_project_root", lambda: tmp_path
    )
    sdir = _session_dir("sess1")
    sdir.mkdir(parents=True, exist_ok=True)
    con = duckdb_connect(str(_db_path("sess1")))
    con.register("seed", df)
    con.execute("CREATE TABLE working_data AS SELECT * FROM seed")
    con.close()


def test_snapshot_then_restore_round_trips(tmp_path, monkeypatch):
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    _make_session(tmp_path, monkeypatch, df)

    snapshot_working("sess1", "pre_step_0")

    # Mutate working_data after the snapshot
    con = duckdb_connect(str(_db_path("sess1")))
    con.execute("DELETE FROM working_data WHERE a = 1")
    con.close()

    restore_working("sess1", "pre_step_0")

    con = duckdb_connect(str(_db_path("sess1")))
    restored = con.execute("SELECT * FROM working_data ORDER BY a").fetchdf()
    con.close()
    pd.testing.assert_frame_equal(restored.reset_index(drop=True), df)


def test_drop_working_snapshot_removes_table(tmp_path, monkeypatch):
    df = pd.DataFrame({"a": [1, 2]})
    _make_session(tmp_path, monkeypatch, df)
    snapshot_working("sess1", "pre_step_0")
    drop_working_snapshot("sess1", "pre_step_0")

    con = duckdb_connect(str(_db_path("sess1")))
    tables = {row[0] for row in con.execute("SHOW TABLES").fetchall()}
    con.close()
    assert "working_data__pre_step_0" not in tables
    assert "working_data" in tables


def test_unsafe_label_is_rejected(tmp_path, monkeypatch):
    df = pd.DataFrame({"a": [1]})
    _make_session(tmp_path, monkeypatch, df)
    with pytest.raises(ValueError):
        snapshot_working("sess1", "bad-label!")
