"""Per-test Postgres schema fixture using the running container.

We re-create the dq_app schema between tests rather than spinning up a
separate container — simpler and faster on a dev laptop.
"""
import asyncio
import os
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from backend.db.engine import build_engine, dispose_engine, set_engine
from backend.db.models import Base

_REPO_ROOT = Path(__file__).resolve().parents[2]


async def _stamp_alembic_head(dsn: str) -> None:
    """Stamp alembic_version to head so the schema is left in a state the app's
    startup migration (`alembic upgrade head`) accepts.

    Without this, the suite leaves the dq_app tables present but unstamped; the
    next API start then crashes trying to re-create existing tables, which blocks
    dev.sh from ever launching the frontend. env.py runs migrations via
    asyncio.run(), so stamp must happen off the running loop (executor thread)."""
    def _run():
        from alembic import command
        from alembic.config import Config

        cfg = Config(str(_REPO_ROOT / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", dsn)
        command.stamp(cfg, "head")

    await asyncio.get_running_loop().run_in_executor(None, _run)


@pytest.fixture
async def app_engine():
    dsn = os.getenv(
        "APP_DB_DSN_TEST",
        "postgresql+asyncpg://temporal:temporal@localhost:5433/temporal",
    )
    engine = build_engine(dsn)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("DROP SCHEMA IF EXISTS dq_app CASCADE")
        await conn.exec_driver_sql("CREATE SCHEMA dq_app")
        await conn.run_sync(Base.metadata.create_all)
    await _stamp_alembic_head(dsn)
    set_engine(engine)
    yield engine
    await dispose_engine()


@pytest.fixture
def app_sessionmaker(app_engine):
    return async_sessionmaker(app_engine, expire_on_commit=False)
