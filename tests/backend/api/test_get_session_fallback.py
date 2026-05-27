import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from temporalio.service import RPCError, RPCStatusCode
from temporalio.client import WorkflowExecutionStatus

from backend.api.routers import sessions as sessions_router
from backend.db.repository import insert_session, upsert_snapshot


def _build(app, *, status=None, not_found=False, query_state=None):
    """Wire a mock Temporal client onto the app. Returns the mock handle so tests
    can assert whether query() was called. ``status`` is the describe() status;
    ``not_found=True`` makes describe() raise NOT_FOUND."""
    handle = MagicMock()
    if not_found:
        handle.describe = AsyncMock(side_effect=RPCError("gone", RPCStatusCode.NOT_FOUND, None))
    else:
        handle.describe = AsyncMock(return_value=MagicMock(status=status))
    handle.query = AsyncMock(return_value=query_state if query_state is not None else {})
    client = MagicMock()
    client.get_workflow_handle = MagicMock(return_value=handle)
    app.state.temporal_client = client
    app.state.task_queue = "test-queue"
    return handle


@pytest.fixture
def app(app_engine):
    a = FastAPI()
    a.include_router(sessions_router.router, prefix="/api/v1")
    return a


async def _seed_completed(app_sessionmaker, sid):
    async with app_sessionmaker() as s:
        await insert_session(s, id=sid, filename="a.csv", file_ext="csv")
        await upsert_snapshot(
            s, session_id=sid, stage="scorecard",
            payload={"scorecard": {}, "narrative": "done", "current_score": 0.95},
            session_updates={"stage": "COMPLETE", "current_score": 0.95, "baseline_score": 0.5},
        )
        await s.commit()


async def test_closed_workflow_is_served_from_db_without_querying(app, app_sessionmaker):
    """Regression: viewing a completed session must NOT query the workflow
    (which forces a full-history replay on the worker)."""
    sid = uuid.uuid4()
    await _seed_completed(app_sessionmaker, sid)
    handle = _build(app, status=WorkflowExecutionStatus.COMPLETED)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/sessions/{sid}")

    assert res.status_code == 200
    body = res.json()
    assert body["stage"] == "COMPLETE"
    assert body["current_score"] == 0.95
    assert body["narrative"] == "done"
    handle.query.assert_not_called()


async def test_running_workflow_is_queried_live(app, app_sessionmaker):
    sid = uuid.uuid4()
    await _seed_completed(app_sessionmaker, sid)  # DB also present, but query wins
    handle = _build(
        app,
        status=WorkflowExecutionStatus.RUNNING,
        query_state={"stage": "VALIDATING", "session_id": str(sid), "current_score": 0.42},
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/sessions/{sid}")

    assert res.status_code == 200
    body = res.json()
    assert body["stage"] == "VALIDATING"
    assert body["current_score"] == 0.42
    handle.query.assert_awaited_once()


async def test_falls_back_to_db_when_temporal_not_found(app, app_sessionmaker):
    sid = uuid.uuid4()
    await _seed_completed(app_sessionmaker, sid)
    handle = _build(app, not_found=True)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/sessions/{sid}")

    assert res.status_code == 200
    assert res.json()["stage"] == "COMPLETE"
    handle.query.assert_not_called()


async def test_returns_404_when_neither_temporal_nor_db_has_it(app):
    sid = uuid.uuid4()
    _build(app, not_found=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/sessions/{sid}")
    assert res.status_code == 404
