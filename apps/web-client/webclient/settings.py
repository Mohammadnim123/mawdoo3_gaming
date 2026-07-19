"""Django settings for the Codply web application.

This is the user-facing web tier of the platform: it owns accounts, the game
product catalog, the social graph, credits/billing and the CMS, server-renders
most of the UX (with React islands for the live workspace and player), and is
the sole caller of the FastAPI generation-service (the generation engine, kept
as the source of truth).

DB: SQLite by default for local dev; set POSTGRES_DB (or DATABASE_URL) to run on
Postgres. Models are written to be Postgres-compatible; a few Postgres-only
niceties (pg_trgm search) are guarded at the query layer.
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

# --------------------------------------------------------------------------
# Core security
# --------------------------------------------------------------------------
DEBUG = _env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-dev-only"
    else:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false")

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]
CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if o.strip()
]

# --------------------------------------------------------------------------
# Applications
# --------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Platform apps
    "core",
    "accounts",
    "games",
    "social",
    "billing",
    "api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Resolves the active locale (fp_locale cookie) → request.locale / request.text_dir.
    "core.middleware.LocaleMiddleware",
    # Guarantees the csrftoken cookie on page loads so island fetches can
    # send X-CSRFToken without a prior form render.
    "core.middleware.EnsureCsrfCookieMiddleware",
]

ROOT_URLCONF = "webclient.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                # Injects locale/dir/i18n strings + nav state (unread count, etc.).
                "core.context_processors.chrome",
            ],
        },
    },
]

WSGI_APPLICATION = "webclient.wsgi.application"
ASGI_APPLICATION = "webclient.asgi.application"

# --------------------------------------------------------------------------
# Database — SQLite dev default; Postgres when POSTGRES_DB / DATABASE_URL is set
# --------------------------------------------------------------------------
if os.environ.get("POSTGRES_DB"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["POSTGRES_DB"],
            "USER": os.environ.get("POSTGRES_USER", "postgres"),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
            "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
            "CONN_MAX_AGE": 60,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "var" / "codply.sqlite3",
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = ["accounts.backends.EmailBackend"]
LOGIN_URL = "/login"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

SESSION_COOKIE_NAME = "codply_session"
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30  # 30 days

# --------------------------------------------------------------------------
# i18n / l10n — exactly two locales (EN + AR/RTL), resolved from a cookie.
# --------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True
USE_I18N = False  # custom two-locale system (core.i18n), not Django's gettext
WEB_DEFAULT_LOCALE = os.environ.get("WEB_DEFAULT_LOCALE", "ar")
LOCALE_COOKIE_NAME = "fp_locale"
THEME_COOKIE_NAME = "fp_theme"

# --------------------------------------------------------------------------
# Static files
# --------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "var" / "media"

# --------------------------------------------------------------------------
# Email (magic links, verification, password reset)
# --------------------------------------------------------------------------
# Mailgun HTTP API (works with the EU or US region — set MAILGUN_BASE_URL to
# https://api.eu.mailgun.net for EU). When MAILGUN_API_KEY and MAILGUN_DOMAIN
# are set, mail is delivered for real via accounts.mailgun.MailgunEmailBackend;
# otherwise we fall back to the console backend, which only PRINTS mail.
MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY", "")
MAILGUN_DOMAIN = os.environ.get("MAILGUN_DOMAIN", "")
MAILGUN_BASE_URL = os.environ.get("MAILGUN_BASE_URL", "https://api.mailgun.net").rstrip("/")
MAILGUN_FROM_EMAIL = os.environ.get("MAILGUN_FROM_EMAIL", "")
MAILGUN_TIMEOUT_SECONDS = float(os.environ.get("MAILGUN_TIMEOUT_SECONDS", "10"))

_mailgun_ready = bool(MAILGUN_API_KEY and MAILGUN_DOMAIN)
# DJANGO_EMAIL_BACKEND still wins if set explicitly (e.g. to force SMTP).
EMAIL_BACKEND = os.environ.get(
    "DJANGO_EMAIL_BACKEND",
    "accounts.mailgun.MailgunEmailBackend"
    if _mailgun_ready
    else "django.core.mail.backends.console.EmailBackend",
)
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", MAILGUN_FROM_EMAIL or "Codply <noreply@codply.local>"
)

# True once a real transactional mailer is wired (anything but the console
# backend). The magic-link endpoint reads this to stop handing sign-in codes
# back inline once mail actually delivers.
EMAIL_DELIVERY_CONFIGURED = EMAIL_BACKEND != "django.core.mail.backends.console.EmailBackend"

# When true, sign-ups skip email verification entirely: no verification email
# is sent and new accounts are created already-verified, so users can sign in
# immediately. Intended for deployments with no mailer wired (the console
# EMAIL_BACKEND above only prints mail). Keep false wherever real email works.
AUTH_SKIP_EMAIL_VERIFICATION = _env_bool("AUTH_SKIP_EMAIL_VERIFICATION", False)

# --------------------------------------------------------------------------
# Branding
# --------------------------------------------------------------------------
SITE_NAME = "Codply"
# Canonical public origin for SEO identity (canonical/OG/JSON-LD). Empty =
# derive from the request (dev); set in prod so proxies can't skew it.
SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "")
SITE_TAGLINE_EN = "Type it. Play it."
SITE_TAGLINE_AR = "اكتبها. العبها."

# --------------------------------------------------------------------------
# Generation service integration (the generation engine — source of truth)
# --------------------------------------------------------------------------
GENERATION_API_URL = os.environ.get("GENERATION_API_URL", "http://localhost:8000")
GENERATION_API_TIMEOUT_SECONDS = float(os.environ.get("GENERATION_API_TIMEOUT_SECONDS", "15"))
# Shared secret authenticating the Django -> generation-service channel.
GENERATION_SERVICE_TOKEN = os.environ.get("GENERATION_SERVICE_TOKEN", "")
# Where generated games are played from (foreign origin CDN); used to derive the
# iframe origin for postMessage validation.
GAMES_CDN_BASE_URL = os.environ.get("GAMES_CDN_BASE_URL", "http://localhost:8002")

# --------------------------------------------------------------------------
# Prompt validation LLM — the one AI call this tier owns (is-it-a-game check).
# --------------------------------------------------------------------------
VALIDATION_AI_PROVIDER = os.environ.get("VALIDATION_AI_PROVIDER", "openrouter")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
VALIDATION_MODEL = os.environ.get("VALIDATION_MODEL", "anthropic/claude-haiku-4.5")
VALIDATION_TIMEOUT_SECONDS = float(os.environ.get("VALIDATION_TIMEOUT_SECONDS", "30"))

# --------------------------------------------------------------------------
# Product knobs
# --------------------------------------------------------------------------
GAMES_PAGE_SIZE = int(os.environ.get("GAMES_PAGE_SIZE", "24"))
STATUS_POLL_INTERVAL_MS = int(os.environ.get("STATUS_POLL_INTERVAL_MS", "3000"))
DEFAULT_DAILY_GEN_QUOTA = int(os.environ.get("DEFAULT_DAILY_GEN_QUOTA", "10"))
INITIAL_FREE_CREDITS_CENTS = int(os.environ.get("INITIAL_FREE_CREDITS_CENTS", "500"))

# --------------------------------------------------------------------------
# Payments (Stripe) — self-serve Pro subscriptions.
#
# When STRIPE_SECRET_KEY and the Pro monthly price are set, the checkout
# endpoint creates a real Stripe Checkout Session and the plan is upgraded
# ONLY by the signature-verified webhook (billing/stripe_gateway.py). Leave
# these unset to disable self-serve checkout (checkout_available=false) rather
# than fake an upgrade — there is deliberately no "grant Pro for free" path.
# --------------------------------------------------------------------------
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_PRO_MONTHLY = os.environ.get("STRIPE_PRICE_PRO_MONTHLY", "")
STRIPE_PRICE_PRO_YEARLY = os.environ.get("STRIPE_PRICE_PRO_YEARLY", "")
# Absolute origin used to build Checkout return URLs (success/cancel). Leave
# empty to derive from the incoming request (fine for local dev / single host).
STRIPE_RETURN_BASE_URL = os.environ.get("STRIPE_RETURN_BASE_URL", "")
# Credits granted per Pro billing period.
PRO_PLAN_CREDITS_CENTS = int(os.environ.get("PRO_PLAN_CREDITS_CENTS", "2000"))
