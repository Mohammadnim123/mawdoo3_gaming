"""Application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from generation_service import __version__
from generation_service.api.errors import register_error_handlers
from generation_service.api.routes import games, generations, health, play
from generation_service.config.settings import get_settings
from generation_service.container import Container
from generation_service.observability import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.logging.level, settings.logging.format)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        container = Container(settings)
        await container.startup()
        app.state.container = container
        yield
        await container.shutdown()

    app = FastAPI(
        title="Prompt-to-Game Generation Service",
        version=__version__,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.app.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(generations.router)
    app.include_router(games.router)
    app.include_router(play.router)
    return app


app = create_app()
