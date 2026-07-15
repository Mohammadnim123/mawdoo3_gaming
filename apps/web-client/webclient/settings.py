"""Django settings — a UI-only client.

No database, no ORM models, no auth: all state (games, jobs, bundles) lives
in the generation service; this client renders pages and forwards user
actions to the service's REST API. Sessions are unnecessary — the language
preference travels in a plain cookie set by the views.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    """Tiny .env loader; real environment variables always win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


_load_env_file(BASE_DIR / ".env")

# Secure by default: DEBUG must be opted into (the committed .env.example
# enables it for local dev), and a non-debug process refuses to start with a
# missing/known SECRET_KEY instead of silently signing cookies with it.
DEBUG = _env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-dev-only"
    else:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false"
        )
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "games",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "webclient.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
            ],
        },
    },
]

WSGI_APPLICATION = "webclient.wsgi.application"

# UI-only client: deliberately no database. All state lives in the service.
DATABASES: dict = {}

# Per-request ar/en handling is done by the views (see games.i18n), not by
# Django's locale machinery — the product needs exactly two locales and
# bilingual data comes pre-localized from the API.
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ---------------------------------------------------------------------------
# Generation service integration (this client's ONLY backend)
# ---------------------------------------------------------------------------
GENERATION_API_URL = os.environ.get("GENERATION_API_URL", "http://localhost:8000")
GENERATION_API_TIMEOUT_SECONDS = float(os.environ.get("GENERATION_API_TIMEOUT_SECONDS", "15"))

# ---------------------------------------------------------------------------
# Prompt validation LLM — the one AI call this client owns: before dispatch,
# verify the prompt is actually a game and deliverable mini-game complexity.
# Both providers run on the Anthropic SDK (openrouter = Anthropic-compatible
# endpoint; model ids differ per dialect: 'anthropic/claude-haiku-4.5' vs
# 'claude-haiku-4-5').
# ---------------------------------------------------------------------------
VALIDATION_AI_PROVIDER = os.environ.get("VALIDATION_AI_PROVIDER", "openrouter")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
VALIDATION_MODEL = os.environ.get("VALIDATION_MODEL", "anthropic/claude-haiku-4.5")
VALIDATION_TIMEOUT_SECONDS = float(os.environ.get("VALIDATION_TIMEOUT_SECONDS", "30"))
WEB_DEFAULT_LOCALE = os.environ.get("WEB_DEFAULT_LOCALE", "ar")
GAMES_PAGE_SIZE = int(os.environ.get("GAMES_PAGE_SIZE", "100"))
# Generation-progress polling cadence (JS poller and the noscript refresh).
STATUS_POLL_INTERVAL_MS = int(os.environ.get("STATUS_POLL_INTERVAL_MS", "3000"))
