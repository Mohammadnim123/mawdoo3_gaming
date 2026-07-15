"""Client-side mirror of the generation service's API contract values.

The service is a separate deployable, so these values arrive as JSON strings;
this module is the single place they are spelled in the client — views,
templates, and JS (via data attributes) all read from here instead of
scattering string literals that silently drift when the service changes.
"""

from __future__ import annotations

from enum import StrEnum


class JobStatus(StrEnum):
    """Mirrors GenerationResponse.status (see service docs §3.9)."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


# Mirrors the service's prompt limits (domain/constraints.py). Checked here
# before the validation LLM call so an over/under-sized prompt costs nothing;
# the service stays authoritative at dispatch (422 on POST /generations).
PROMPT_MIN_CHARS = 3
PROMPT_MAX_CHARS = 2000
