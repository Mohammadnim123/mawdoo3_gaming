"""SQLite database wrapper.

Metadata store only — game bodies live in object storage (StoragePort).
SQLite keeps the MVP dependency-free; the repository layer is the seam for a
later Postgres swap.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import aiosqlite

_SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id               TEXT PRIMARY KEY,
    title_en         TEXT NOT NULL,
    title_ar         TEXT NOT NULL,
    genre            TEXT NOT NULL,
    summary          TEXT NOT NULL DEFAULT '',
    default_locale   TEXT NOT NULL,
    prompt           TEXT NOT NULL,
    blueprint_json   TEXT NOT NULL,
    template_version TEXT NOT NULL,
    blueprint_model  TEXT NOT NULL,
    code_model       TEXT NOT NULL,
    storage_prefix   TEXT NOT NULL,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_jobs (
    id               TEXT PRIMARY KEY,
    status           TEXT NOT NULL,
    stage            TEXT NOT NULL,
    kind             TEXT NOT NULL DEFAULT 'create',
    prompt           TEXT NOT NULL,
    requested_locale TEXT,
    game_id          TEXT,
    error_code       TEXT,
    error_message    TEXT,
    gate_report_json TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id        TEXT,
    stage         TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_created_at ON games (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_job_id ON llm_calls (job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_game_status ON generation_jobs (game_id, status);
"""

# Additive, idempotent migrations for databases created before a column
# existed: {table: {column: DDL}}. Extend this map whenever a column is added.
_ADDITIVE_COLUMNS: dict[str, dict[str, str]] = {
    "generation_jobs": {
        "kind": "TEXT NOT NULL DEFAULT 'create'",
    },
    "games": {
        "summary": "TEXT NOT NULL DEFAULT ''",
    },
}


class Database:
    def __init__(self, sqlite_path: Path) -> None:
        self._path = sqlite_path
        self._conn: aiosqlite.Connection | None = None
        # Serializes execute+commit pairs so concurrent tasks can never commit
        # each other's half-finished writes on the shared connection.
        self._write_lock = asyncio.Lock()

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database.connect() was not called")
        return self._conn

    async def execute_write(self, sql: str, params: tuple = ()) -> int:
        """One atomic write: execute + commit under the write lock, with a
        rollback if anything (including cancellation) interrupts the pair.
        Returns the affected row count."""
        async with self._write_lock:
            try:
                cursor = await self.connection.execute(sql, params)
                await self.connection.commit()
                return cursor.rowcount
            except BaseException:
                await self.connection.rollback()
                raise

    async def connect(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self._path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.executescript(_SCHEMA)
        await self._migrate()
        await self._conn.commit()

    async def _migrate(self) -> None:
        assert self._conn is not None
        for table, columns in _ADDITIVE_COLUMNS.items():
            cursor = await self._conn.execute(f"PRAGMA table_info({table})")
            existing = {row[1] for row in await cursor.fetchall()}
            for column, ddl in columns.items():
                if column not in existing:
                    await self._conn.execute(
                        f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"
                    )

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
