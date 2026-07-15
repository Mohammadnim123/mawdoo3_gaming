"""`python -m generation_service` — run the service with uvicorn."""

from __future__ import annotations

import uvicorn

from generation_service.config.settings import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "generation_service.main:app",
        host=settings.app.host,
        port=settings.app.port,
        reload=settings.app.debug,
        log_level=settings.logging.level.lower(),
    )


if __name__ == "__main__":
    main()
