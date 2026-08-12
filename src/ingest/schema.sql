-- Apple Health local monitor schema

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Full raw dump of Record / Category-like samples (unknown types included)
CREATE TABLE IF NOT EXISTS raw_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL,
    source_name TEXT,
    source_version TEXT,
    unit TEXT,
    creation_date TEXT,
    start_date TEXT,
    end_date TEXT,
    value TEXT,
    device TEXT,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_raw_type_start ON raw_records(record_type, start_date);
CREATE INDEX IF NOT EXISTS idx_raw_start ON raw_records(start_date);

CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_activity_type TEXT,
    duration REAL,
    duration_unit TEXT,
    total_distance REAL,
    total_distance_unit TEXT,
    total_energy_burned REAL,
    total_energy_burned_unit TEXT,
    source_name TEXT,
    source_version TEXT,
    creation_date TEXT,
    start_date TEXT,
    end_date TEXT,
    device TEXT,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_workouts_start ON workouts(start_date);

-- Explicit mood / state-of-mind / manual diary
CREATE TABLE IF NOT EXISTS mood_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    score REAL,
    valence TEXT,
    labels TEXT,
    source TEXT NOT NULL DEFAULT 'inferred',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(entry_date, source)
);

CREATE INDEX IF NOT EXISTS idx_mood_date ON mood_entries(entry_date);

CREATE TABLE IF NOT EXISTS habit_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    tags TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_journal_day ON habit_journal(day);

CREATE TABLE IF NOT EXISTS daily_triad (
    day TEXT PRIMARY KEY,
    recovery_pct REAL,
    recovery_band TEXT,
    strain REAL,
    strain_trimp REAL,
    strain_from_hr REAL,
    strain_from_effort REAL,
    hr_samples INTEGER,
    sleep_performance REAL,
    sleep_need_h REAL,
    sleep_debt_h REAL,
    target_low REAL,
    target_high REAL,
    target_intent TEXT,
    hrv_ratio REAL,
    rhr_ratio REAL,
    payload_json TEXT
);

-- Daily rolled-up metrics
CREATE TABLE IF NOT EXISTS daily_metrics (
    day TEXT PRIMARY KEY,
    steps REAL,
    distance_km REAL,
    flights_climbed REAL,
    active_energy_kcal REAL,
    basal_energy_kcal REAL,
    exercise_minutes REAL,
    stand_hours REAL,
    resting_hr REAL,
    avg_hr REAL,
    walking_hr_avg REAL,
    hrv_sdnn_ms REAL,
    spo2_avg REAL,
    sleep_hours REAL,
    sleep_asleep_hours REAL,
    sleep_deep_hours REAL,
    sleep_rem_hours REAL,
    sleep_core_hours REAL,
    sleep_bedtime_min REAL,
    sleep_wake_min REAL,
    sleep_consistency REAL,
    weight_kg REAL,
    body_fat_pct REAL,
    mindful_minutes REAL,
    headphone_db_avg REAL,
    environmental_db_avg REAL,
    workout_count INTEGER,
    workout_minutes REAL,
    training_load REAL,
    ctl REAL,
    atl REAL,
    tsb REAL,
    mood_score REAL,
    mood_source TEXT,
    recovery_score REAL,
    activity_score REAL,
    sleep_score REAL,
    overall_score REAL,
    preferred_sources_json TEXT,
    extras_json TEXT
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    title TEXT,
    body_md TEXT NOT NULL,
    file_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(report_type, period_start, period_end)
);
