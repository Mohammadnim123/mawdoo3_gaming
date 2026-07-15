"""Typed configuration layer.

Every value is env-driven with a sensible default (see .env.example). Settings
are grouped by concern; the aggregate `Settings` object is built once at
startup and injected — application code never reads os.environ directly.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Anchor every default path to the service root (not the process CWD), so the
# service behaves identically no matter which directory it is launched from.
# services/generation-service/src/generation_service/config/settings.py
_SERVICE_ROOT = Path(__file__).resolve().parents[3]
_REPO_ROOT = _SERVICE_ROOT.parents[1]
_ENV_FILE = _SERVICE_ROOT / ".env"


class _Base(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")


class AppSettings(_Base):
    model_config = SettingsConfigDict(
        env_prefix="APP_", env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore"
    )

    name: str = "generation-service"
    env: Literal["dev", "staging", "prod"] = "dev"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000
    # Origin this service is reachable at; used to build game play URLs.
    public_base_url: str = "http://localhost:8000"
    # Browser origins allowed to call the API directly. The Django web client
    # talks to this service server-to-server (no CORS involved), so this is
    # empty by default; add origins here if a browser app consumes the API.
    # Comma-separated in env.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


class LoggingSettings(_Base):
    model_config = SettingsConfigDict(
        env_prefix="LOG_", env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore"
    )

    level: str = "INFO"
    format: Literal["console", "json"] = "console"


class AISettings(_Base):
    """LLM access — built on the Anthropic SDK either way:
    'anthropic' talks to the Anthropic API directly; 'openrouter' talks to
    OpenRouter's Anthropic-compatible endpoint (one key, many Claude models).
    Mind the model-id dialect: OpenRouter uses 'anthropic/claude-opus-4.8',
    the direct API uses 'claude-opus-4-8'."""

    ai_provider: Literal["openrouter", "anthropic"] = "openrouter"

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    anthropic_api_key: str = ""

    # Per-stage models: cheap+fast for understanding, strongest for the
    # critical stages (blueprint = the gate's answer key, code = the game).
    understanding_model: str = "anthropic/claude-haiku-4.5"
    blueprint_model: str = "anthropic/claude-opus-4.8"
    code_model: str = "anthropic/claude-opus-4.8"

    llm_temperature: float = 0.4
    # Must cover a full code emission (~10k+ output tokens in one call).
    llm_timeout_seconds: float = 300.0
    llm_max_retries: int = 2
    # Output cap per structured call; code generation needs the headroom.
    llm_max_output_tokens: int = 32000


class StorageSettings(_Base):
    # 'local' mirrors the object-store key layout on disk; 's3' is the
    # future config swap (same StoragePort, same keys).
    storage_backend: Literal["local", "s3"] = "local"
    storage_local_dir: Path = _SERVICE_ROOT / "var" / "storage"

    object_storage_bucket: str = ""
    object_storage_region: str = ""
    object_storage_endpoint: str = ""
    object_storage_access_key: str = ""
    object_storage_secret_key: str = ""
    # When set, play URLs are served from the CDN instead of this service.
    cdn_base_url: str = ""


class DatabaseSettings(_Base):
    sqlite_path: Path = _SERVICE_ROOT / "var" / "generation.db"


class PipelineSettings(_Base):
    template_dir: Path = _REPO_ROOT / "packages" / "starter-template"
    generation_max_code_retries: int = 2
    # Worst case that should still succeed: blueprint + (1 + max_code_retries)
    # code attempts, each followed by gate + deep review.
    generation_timeout_seconds: float = 900.0
    # Concurrent pipeline runs; submissions beyond the cap wait in QUEUED.
    generation_max_concurrent: int = 4
    gate_node_syntax_check: bool = True
    gate_syntax_check_timeout_seconds: float = 20.0
    gate_smoke_boot: bool = True
    gate_smoke_boot_timeout_seconds: float = 30.0
    gate_max_game_kb: int = 256


class FeatureFlags(_Base):
    feature_llm_review: bool = True  # deep logic review in the gate (kill switch)
    feature_tweaks_api: bool = True  # chat-edit an existing game (kill switch)
    feature_share_links: bool = False


class RedisSettings(_Base):
    # Unused in the MVP (jobs run in-process); the future broker seam.
    redis_url: str = ""


class SecuritySettings(_Base):
    # Future-ready placeholders; the MVP has no auth by design.
    secret_key: str = "change-me-in-production"
    service_token: str = ""


class Settings:
    """Aggregate settings object — the single thing the container consumes."""

    def __init__(self) -> None:
        self.app = AppSettings()
        self.logging = LoggingSettings()
        self.ai = AISettings()
        self.storage = StorageSettings()
        self.database = DatabaseSettings()
        self.pipeline = PipelineSettings()
        self.features = FeatureFlags()
        self.redis = RedisSettings()
        self.security = SecuritySettings()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
