from __future__ import annotations

from dataclasses import dataclass

from generation_service.domain.constraints import MAX_PAGE_SIZE
from generation_service.domain.entities import Game, GameSummary
from generation_service.domain.errors import NotFoundError
from generation_service.domain.ports import GameRepository


@dataclass(frozen=True, slots=True)
class GamesPage:
    items: list[GameSummary]
    total: int
    limit: int
    offset: int


class ListGamesUseCase:
    def __init__(self, games: GameRepository) -> None:
        self._games = games

    async def execute(self, limit: int = 50, offset: int = 0) -> GamesPage:
        limit = max(1, min(limit, MAX_PAGE_SIZE))
        offset = max(0, offset)
        items = await self._games.list_games(limit=limit, offset=offset)
        total = await self._games.count()
        return GamesPage(items=items, total=total, limit=limit, offset=offset)


class GetGameUseCase:
    def __init__(self, games: GameRepository) -> None:
        self._games = games

    async def execute(self, game_id: str) -> Game:
        game = await self._games.get(game_id)
        if game is None:
            raise NotFoundError(f"game {game_id!r} not found")
        return game
