"""SQLAlchemy ORM models.

The schema is intentionally generic so it can absorb the many different metric
shapes Apple Health / Health Auto Export emit (simple quantities, heart-rate
min/avg/max aggregates, sleep stages, blood pressure, ...). The full original
JSON for every record is kept in ``extra`` so no information is ever lost and
new analyses can be added later without re-importing.
"""

from __future__ import annotations

from sqlalchemy import Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class MetricSample(Base):
    """A single health metric sample (one point in a time series)."""

    __tablename__ = "metric_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    metric: Mapped[str] = mapped_column(String(64), index=True)
    units: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Local naive timestamp, "YYYY-MM-DD HH:MM:SS".
    ts: Mapped[str] = mapped_column(String(32), index=True)
    # Local date, "YYYY-MM-DD" (denormalized for fast daily grouping).
    date: Mapped[str] = mapped_column(String(10), index=True)
    qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    vmin: Mapped[float | None] = mapped_column(Float, nullable=True)
    vavg: Mapped[float | None] = mapped_column(Float, nullable=True)
    vmax: Mapped[float | None] = mapped_column(Float, nullable=True)
    # "" (never NULL) so the uniqueness constraint dedups reliably in SQLite.
    source: Mapped[str] = mapped_column(String(128), default="")
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("metric", "ts", "source", name="uq_metric_ts_source"),
        Index("ix_metric_date", "metric", "date"),
    )


class Workout(Base):
    """A workout / activity session."""

    __tablename__ = "workouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    start: Mapped[str] = mapped_column(String(32), index=True)
    end: Mapped[str | None] = mapped_column(String(32), nullable=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    active_energy_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_hr: Mapped[float | None] = mapped_column(Float, nullable=True)
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("name", "start", name="uq_workout_name_start"),)
