"""Shared helpers for read endpoints that touch Temporal workflows."""
from __future__ import annotations

from fastapi import HTTPException
from temporalio.client import WorkflowExecutionStatus
from temporalio.service import RPCError, RPCStatusCode


async def is_workflow_running(handle) -> bool:
    """Return True only if the workflow is currently RUNNING.

    Uses ``handle.describe()`` — a lightweight status RPC that does **not**
    replay workflow history — unlike ``handle.query()``, which forces the worker
    to replay the full history of a closed workflow. Read endpoints gate live
    queries on this so that viewing a completed session is served from DB
    snapshots instead of hammering the worker with replays (which, under the
    frontend's 2s polling, saturates the worker's gRPC connection).

    Closed workflows and NOT_FOUND both return False; callers fall back to the DB.
    """
    try:
        desc = await handle.describe()
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            return False
        raise HTTPException(status_code=500, detail=str(e))
    return desc.status == WorkflowExecutionStatus.RUNNING
