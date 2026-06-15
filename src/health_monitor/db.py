"""Database engine, session helper and initialization."""

from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings
from .models import Base


def _make_engine() -> Engine:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    eng = create_engine(
        settings.db_url,
        future=True,
        # FastAPI may touch the connection from a worker thread.
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(eng, "connect")
    def _set_sqlite_pragma(dbapi_conn, _record):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    return eng


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)

_initialized = False


def init_db() -> None:
    """Create tables if they do not exist (idempotent, cheap to call often)."""
    global _initialized
    if not _initialized:
        Base.metadata.create_all(engine)
        _initialized = True


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session context manager."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
