"""Postgres database wrapper (asyncpg + connection pool).

Metadata store only — game bodies live in object storage (StoragePort).
Repositories depend on the three helpers below (execute_write / fetch_one /
fetch_all); the domain never sees asyncpg. Swapping the backend again is a
container change, not a domain change.

Repository SQL is written with ``?`` positional placeholders (the historic
SQLite dialect); the wrapper rewrites them to Postgres ``$n`` placeholders so
the repository layer stays driver-agnostic.
"""

from __future__ import annotations

from functools import lru_cache

import asyncpg

_SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id                 TEXT PRIMARY KEY,
    title_en           TEXT NOT NULL,
    title_ar           TEXT NOT NULL,
    genre              TEXT NOT NULL,
    summary            TEXT NOT NULL DEFAULT '',
    default_locale     TEXT NOT NULL,
    prompt             TEXT NOT NULL,
    blueprint_json     TEXT NOT NULL,
    template_version   TEXT NOT NULL,
    blueprint_model    TEXT NOT NULL,
    code_model         TEXT NOT NULL,
    storage_prefix     TEXT NOT NULL,
    current_version_id TEXT,
    current_version_no INTEGER NOT NULL DEFAULT 1,
    cover_file         TEXT,
    created_at         TEXT NOT NULL
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
    questions_json   TEXT,
    answers_json     TEXT,
    analysis_json    TEXT,
    skip_clarify     INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_versions (
    id              TEXT PRIMARY KEY,
    game_id         TEXT NOT NULL,
    version_no      INTEGER NOT NULL,
    parent_id       TEXT,
    job_id          TEXT,
    change_summary  TEXT NOT NULL DEFAULT '',
    storage_prefix  TEXT NOT NULL,
    blueprint_json  TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    UNIQUE (game_id, version_no)
);

CREATE TABLE IF NOT EXISTS llm_calls (
    id            BIGSERIAL PRIMARY KEY,
    job_id        TEXT,
    stage         TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_events (
    job_id     TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    event      TEXT NOT NULL,
    data_json  TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    PRIMARY KEY (job_id, seq)
);

CREATE TABLE IF NOT EXISTS job_drafts (
    job_id     TEXT PRIMARY KEY,
    draft_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_created_at ON games (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_job_id ON llm_calls (job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_game_status ON generation_jobs (game_id, status);
CREATE INDEX IF NOT EXISTS idx_game_versions_game ON game_versions (game_id, version_no);
"""

# Additive, idempotent column migrations for databases created before a column
# existed: {table: {column: DDL}}. On a fresh schema these are no-ops (every
# column already lives in _SCHEMA); the map is the seam for future additions.
_ADDITIVE_COLUMNS: dict[str, dict[str, str]] = {
    "generation_jobs": {
        "kind": "TEXT NOT NULL DEFAULT 'create'",
        "questions_json": "TEXT",
        "answers_json": "TEXT",
        "analysis_json": "TEXT",
        "skip_clarify": "INTEGER NOT NULL DEFAULT 0",
    },
    "games": {
        "summary": "TEXT NOT NULL DEFAULT ''",
        "current_version_id": "TEXT",
        "current_version_no": "INTEGER NOT NULL DEFAULT 1",
        "cover_file": "TEXT",
    },
}

# Games created before immutable versions existed have their bundle directly
# under games/{id} and no version rows. Synthesize a v1 row per such game so
# every consumer (version list, rollback, source view) sees one uniform world.
_BACKFILL_V1_VERSIONS = """
INSERT INTO game_versions (id, game_id, version_no, parent_id, job_id,
                           change_summary, storage_prefix, blueprint_json, created_at)
SELECT substr(md5(random()::text), 1, 12), g.id, 1, NULL, NULL,
       'Initial version', g.storage_prefix, g.blueprint_json, g.created_at
FROM games g
WHERE NOT EXISTS (SELECT 1 FROM game_versions v WHERE v.game_id = g.id)
"""

_BACKFILL_CURRENT_POINTERS = """
UPDATE games SET
    current_version_id = (SELECT v.id FROM game_versions v
                          WHERE v.game_id = games.id
                          ORDER BY v.version_no DESC LIMIT 1),
    current_version_no = (SELECT v.version_no FROM game_versions v
                          WHERE v.game_id = games.id
                          ORDER BY v.version_no DESC LIMIT 1)
WHERE current_version_id IS NULL
"""


@lru_cache(maxsize=512)
def _to_positional(sql: str) -> str:
    """Rewrite ``?`` placeholders to Postgres ``$1, $2, ...``. Repository SQL
    never embeds a literal ``?``, so a plain left-to-right scan is exact."""
    out: list[str] = []
    n = 0
    for ch in sql:
        if ch == "?":
            n += 1
            out.append(f"${n}")
        else:
            out.append(ch)
    return "".join(out)


def _rowcount(status: str) -> int:
    """Affected-row count from an asyncpg command tag ("UPDATE 3",
    "INSERT 0 1", "DELETE 2") — the trailing integer."""
    try:
        return int(status.rsplit(" ", 1)[1])
    except (IndexError, ValueError):
        return 0


class Database:
    def __init__(
        self, dsn: str, *, min_size: int = 1, max_size: int = 10, command_timeout: float = 60.0
    ) -> None:
        self._dsn = dsn
        self._min_size = min_size
        self._max_size = max_size
        self._command_timeout = command_timeout
        self._pool: asyncpg.Pool | None = None

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("Database.connect() was not called")
        return self._pool

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(
            self._dsn,
            min_size=self._min_size,
            max_size=self._max_size,
            command_timeout=self._command_timeout,
        )
        async with self._pool.acquire() as conn:
            # asyncpg runs a multi-statement, parameterless string via the
            # simple query protocol — the whole schema in one round trip.
            await conn.execute(_SCHEMA)
            await self._migrate(conn)

    async def _migrate(self, conn: asyncpg.Connection) -> None:
        for table, columns in _ADDITIVE_COLUMNS.items():
            for column, ddl in columns.items():
                await conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}"
                )
        await conn.execute(_BACKFILL_V1_VERSIONS)
        await conn.execute(_BACKFILL_CURRENT_POINTERS)

    async def execute_write(self, sql: str, params: tuple = ()) -> int:
        """One statement on a pooled connection (autocommit). Returns the
        affected row count — the CAS signal the job repository relies on."""
        async with self.pool.acquire() as conn:
            status = await conn.execute(_to_positional(sql), *params)
            return _rowcount(status)

    async def fetch_one(self, sql: str, params: tuple = ()) -> asyncpg.Record | None:
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(_to_positional(sql), *params)

    async def fetch_all(self, sql: str, params: tuple = ()) -> list[asyncpg.Record]:
        async with self.pool.acquire() as conn:
            return await conn.fetch(_to_positional(sql), *params)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
