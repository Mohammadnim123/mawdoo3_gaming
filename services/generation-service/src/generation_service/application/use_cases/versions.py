"""Version catalog use cases: list, source view, rollback.

Rollback is a pointer flip, not a rebuild: the chosen version's bundle is
already stored immutably, so making it current means repointing the game's
storage_prefix/current_version_* and restoring that version's blueprint (so
future tweaks revise what the player actually sees).
"""

from __future__ import annotations

from generation_service.domain.entities import Game, GameVersion
from generation_service.domain.errors import ConflictError, NotFoundError
from generation_service.domain.ports import (
    GameRepository,
    GameVersionRepository,
    JobRepository,
    StoragePort,
)


class ListVersionsUseCase:
    def __init__(self, games: GameRepository, versions: GameVersionRepository) -> None:
        self._games = games
        self._versions = versions

    async def execute(self, game_id: str) -> tuple[Game, list[GameVersion]]:
        game = await self._games.get(game_id)
        if game is None:
            raise NotFoundError(f"game {game_id!r} not found")
        return game, await self._versions.list_for_game(game_id)


class GetVersionSourceUseCase:
    """The Code view's data: the bundle's human-readable files for one version."""

    def __init__(
        self,
        games: GameRepository,
        versions: GameVersionRepository,
        storage: StoragePort,
    ) -> None:
        self._games = games
        self._versions = versions
        self._storage = storage

    async def execute(self, game_id: str, version_id: str) -> dict[str, str]:
        game = await self._games.get(game_id)
        if game is None:
            raise NotFoundError(f"game {game_id!r} not found")
        version = await self._versions.get(game_id, version_id)
        if version is None:
            raise NotFoundError(f"version {version_id!r} not found")

        async def read(rel_path: str) -> str:
            try:
                return (await self._storage.get(f"{version.storage_prefix}/{rel_path}")).decode(
                    "utf-8", errors="replace"
                )
            except Exception:  # noqa: BLE001 — optional files are simply absent
                return ""

        source_html = await read("index.html")
        if not source_html:
            raise NotFoundError("this version's bundle is no longer stored")
        return {
            "version_id": version.id,
            "source_html": source_html,
            "game_js": await read("game.js"),
            "game_css": await read("game.css"),
        }


class RollbackUseCase:
    def __init__(
        self,
        games: GameRepository,
        versions: GameVersionRepository,
        jobs: JobRepository,
    ) -> None:
        self._games = games
        self._versions = versions
        self._jobs = jobs

    async def execute(self, game_id: str, version_id: str) -> tuple[Game, GameVersion]:
        game = await self._games.get(game_id)
        if game is None:
            raise NotFoundError(f"game {game_id!r} not found")
        version = await self._versions.get(game_id, version_id)
        if version is None:
            raise NotFoundError(f"version {version_id!r} not found")
        if version.id == game.current_version_id:
            raise ConflictError("that version is already current")
        # A rollback mid-rebuild would race the finishing job's pointer update.
        if await self._jobs.has_active_job_for_game(game_id):
            raise ConflictError("this game is being updated — wait for the edit to finish")

        game.apply_blueprint(version.blueprint)
        game.storage_prefix = version.storage_prefix
        game.current_version_id = version.id
        game.current_version_no = version.version_no
        await self._games.update(game)
        return game, version
