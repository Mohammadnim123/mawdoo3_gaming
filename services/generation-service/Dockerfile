# Generation service — FastAPI + Anthropic SDK pipeline.
# BUILD CONTEXT: the repository root (it needs packages/starter-template too),
# e.g.  docker build -f services/generation-service/Dockerfile .
FROM python:3.12-slim

# Node.js is required by the quality gate: `node --check` (JS syntax) and the
# headless smoke-boot harness (a self-contained script with a stubbed DOM/SDK —
# no npm packages needed, just the runtime). Without it the gate silently skips
# these checks and broken games could ship, so it is a hard dependency here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Production defaults (overridable via Cloud Run env vars).
    APP_ENV=prod \
    APP_DEBUG=false \
    LOG_FORMAT=json \
    STORAGE_BACKEND=gcs \
    # The starter template ships inside the image at an absolute path.
    TEMPLATE_DIR=/app/packages/starter-template

WORKDIR /app/services/generation-service

# Install dependencies first for better layer caching.
COPY services/generation-service/pyproject.toml services/generation-service/README.md ./
COPY services/generation-service/src ./src
RUN pip install .

# Runtime asset: the versioned starter template every generated game inherits.
COPY packages/starter-template /app/packages/starter-template

# Run as a non-root user (defence in depth; generated code never runs here, but
# the smoke-boot spawns node subprocesses).
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# Cloud Run sends traffic to $PORT (default 8080). A SINGLE uvicorn worker is
# mandatory: the background job runner + in-process SSE event bus assume one
# process — multiple workers would each spawn their own runner.
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn generation_service.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
