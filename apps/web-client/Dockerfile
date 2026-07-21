# Django web client — UI tier + prompt-validation LLM call.
# BUILD CONTEXT: the repository root, e.g.
#   docker build -f apps/web-client/Dockerfile .

# ---- Stage 1: build the React islands + Tailwind CSS bundle ----------------
FROM node:20-slim AS frontend
WORKDIR /app/apps/web-client
# JS deps first for layer caching.
COPY apps/web-client/frontend/package.json apps/web-client/frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
# The rest of the app: Vite/Tailwind scan templates + island sources, and the
# build writes into games/static/games/dist/.
COPY apps/web-client ./
RUN npm --prefix frontend run build

# ---- Stage 2: Django runtime ------------------------------------------------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=webclient.settings \
    # The app is run from source (the wheel only packages webclient + games;
    # accounts/api/core/social/billing live alongside as top-level packages).
    PYTHONPATH=/app/apps/web-client

WORKDIR /app/apps/web-client

# App source + Python dependencies. `pip install .` reads deps from pyproject;
# the app itself is imported from this directory via PYTHONPATH above.
COPY apps/web-client ./
# Compiled front-end assets from the builder stage (overwrites any stale copy).
COPY --from=frontend /app/apps/web-client/games/static/games/dist ./games/static/games/dist
RUN pip install .

# Collect static for WhiteNoise. DEBUG defaults to false, which makes settings
# require a SECRET_KEY, so pass a throwaway one for this build step only — NO
# real secret is baked into the image (Cloud Run injects the real one at run).
RUN DJANGO_SECRET_KEY=build-only-not-a-secret python manage.py collectstatic --noinput

RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
# gunicorn binds Cloud Run's $PORT. Sync workers × threads handle the modest,
# I/O-bound (calls out to the generation service) request load.
CMD ["sh", "-c", "exec gunicorn webclient.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 2 --threads 8 --timeout 120 --access-logfile - --error-logfile -"]
