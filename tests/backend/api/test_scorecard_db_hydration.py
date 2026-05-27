import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from temporalio.service import RPCError, RPCStatusCode
from temporalio.client import WorkflowExecutionStatus

from backend.api.routers import pipeline as pipeline_router
from backend.db.repository import insert_session, upsert_snapshot


def _build(app, *, status=None, not_found=False):
    handle = MagicMock()
    if not_found:
        handle.describe = AsyncMock(side_effect=RPCError("gone", RPCStatusCode.NOT_FOUND, None))
    else:
        handle.describe = AsyncMock(return_value=MagicMock(status=status))
    handle.query = AsyncMock(return_value={})
    client = MagicMock()
    client.get_workflow_handle = MagicMock(return_value=handle)
    app.state.temporal_client = client
    app.state.task_queue = "test-queue"
    return handle


@pytest.fixture
def app(app_engine):
    a = FastAPI()
    a.include_router(pipeline_router.router, prefix="/api/v1")
    return a


async def _seed_completed(app_sessionmaker, sid):
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(
            s, session_id=sid, stage="validate",
            payload={"validation_results": {"per_rule": [
                {"id": "r1", "check": "not_null", "column": "x", "passed": False,
                 "failure_count": 3, "sample_failing_rows": [{"x": None}]},
            ]}},
            session_updates=None,
        )
        await upsert_snapshot(
            s, session_id=sid, stage="transform",
            payload={"transformation_log": []},
            session_updates=None,
        )
        await upsert_snapshot(
            s, session_id=sid, stage="scorecard",
            payload={"scorecard": {"rules_passing": 1, "rules_total": 1, "original_rows": 10},
                     "narrative": "all good", "current_score": 0.9},
            session_updates={"stage": "COMPLETE", "current_score": 0.9, "baseline_score": 0.4},
        )
        await s.commit()


async def test_scorecard_closed_workflow_served_from_db_without_querying(app, app_sessionmaker):
    sid = uuid.uuid4()
    await _seed_completed(app_sessionmaker, sid)
    handle = _build(app, status=WorkflowExecutionStatus.COMPLETED)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/sessions/{sid}/scorecard")

    assert res.status_code == 200
    body = res.json()
    assert body["narrative"] == "all good"
    assert body["baseline_score"] == 0.4
    assert body["final_score"] == 0.9
    assert body["rules_passing"] == 1
    # The fix: a completed scorecard must not trigger any workflow query/replay.
    handle.query.assert_not_called()


async def test_scorecard_404_when_closed_and_no_db(app):
    sid = uuid.uuid4()
    handle = _build(app, not_found=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/sessions/{sid}/scorecard")
    assert res.status_code == 404
    handle.query.assert_not_called()
