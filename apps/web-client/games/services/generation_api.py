"""HTTP client for the Generation Service — this client's ONLY backend.

The Django app holds no generation logic, no storage access, and no shared
database: every capability (generate, poll, list, fetch, edit) is consumed
through the service's public REST API, and this module is the single place
that knows how. Responses are passed through as plain dicts — the API DTOs
are the contract (see docs/ARCHITECTURE.md §3.9); mirroring them in a typed
layer here would only create drift.
"""

from __future__ import annotations

import threading
from typing import Any
from urllib.parse import quote

import requests
from django.conf import settings


class GenerationApiError(Exception):
    """The service answered with its error envelope (or an unusable body)."""

    def __init__(self, message: str, code: str = "api_error", status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class GenerationApiUnavailable(GenerationApiError):
    """The service could not be reached at all (down, DNS, timeout)."""

    def __init__(self, message: str = "generation service unreachable"):
        super().__init__(message, code="service_unavailable", status_code=None)


class GenerationApiClient:
    def __init__(self, base_url: str, timeout_seconds: float, token: str = "") -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds
        self._token = token
        self._session = requests.Session()

    # -- generations --------------------------------------------------------

    def start_generation(
        self, prompt: str, locale: str | None = None, skip_questions: bool = False
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"prompt": prompt}
        if locale:
            body["locale"] = locale
        if skip_questions:
            body["options"] = {"skip_questions": True}
        return self._request("POST", "/api/v1/generations", json=body)

    def get_generation(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/generations/{quote(job_id, safe='')}")

    def submit_answers(self, job_id: str, answers: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST", f"/api/v1/generations/{quote(job_id, safe='')}/answers",
            json={"answers": answers},
        )

    def cancel_generation(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/generations/{quote(job_id, safe='')}/cancel")

    # -- games ---------------------------------------------------------------

    def list_games(self, limit: int = 50, offset: int = 0) -> dict[str, Any]:
        return self._request("GET", "/api/v1/games", params={"limit": limit, "offset": offset})

    def get_game(self, game_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/games/{quote(game_id, safe='')}")

    def start_tweak(self, game_id: str, instruction: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/games/{quote(game_id, safe='')}/tweaks",
            json={"instruction": instruction},
        )

    def list_versions(self, game_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/games/{quote(game_id, safe='')}/versions")

    def get_version_source(self, game_id: str, version_id: str) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/v1/games/{quote(game_id, safe='')}/versions/{quote(version_id, safe='')}/source",
        )

    def rollback(self, game_id: str, version_id: str) -> dict[str, Any]:
        return self._request(
            "POST", f"/api/v1/games/{quote(game_id, safe='')}/rollback",
            json={"version_id": version_id},
        )

    # -- SSE proxy helpers ---------------------------------------------------

    def stream_url(self, job_id: str) -> str:
        """Absolute URL of the engine's SSE stream (proxied by a Django view)."""
        return f"{self._base_url}/api/v1/generations/{quote(job_id, safe='')}/stream"

    def auth_headers(self) -> dict[str, str]:
        """Headers a caller (e.g. the SSE proxy view) should forward upstream."""
        headers = {"Accept": "text/event-stream"}
        if self._token:
            headers["X-Service-Token"] = self._token
        return headers

    def iter_stream(self, job_id: str, last_event_id: str | None = None):
        """Yield raw SSE bytes from the engine stream (for the Django proxy).

        Keeps `requests` inside the client. The read timeout is generous — an
        SSE connection is long-lived; the connect timeout stays short.
        """
        headers = self.auth_headers()
        if last_event_id:
            headers["Last-Event-ID"] = last_event_id
        try:
            with self._session.get(
                self.stream_url(job_id), headers=headers, stream=True, timeout=(10, 3600)
            ) as response:
                if response.status_code >= 400:
                    raise GenerationApiError(
                        f"stream error {response.status_code}",
                        status_code=response.status_code,
                    )
                for chunk in response.iter_content(chunk_size=None):
                    if chunk:
                        yield chunk
        except requests.RequestException as exc:
            # An engine drop mid-stream must surface as our error type so the
            # SSE proxy can emit a terminal 'failed' frame instead of crashing
            # the streaming response (the browser would silently retry forever).
            raise GenerationApiUnavailable(str(exc)) from exc

    # -- plumbing -------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {"Accept": "application/json"}
        if self._token:
            headers["X-Service-Token"] = self._token
        try:
            response = self._session.request(
                method,
                f"{self._base_url}{path}",
                json=json,
                params=params,
                timeout=self._timeout,
                headers=headers,
            )
        except requests.RequestException as exc:
            raise GenerationApiUnavailable(str(exc)) from exc

        if response.status_code >= 400:
            envelope: dict[str, Any] = {}
            try:
                body = response.json()
                # A proxy/LB can answer with a JSON list or string — only a
                # dict carries the service's error envelope.
                if isinstance(body, dict) and isinstance(body.get("error"), dict):
                    envelope = body["error"]
            except ValueError:
                pass
            raise GenerationApiError(
                envelope.get("message") or f"{response.status_code} {response.reason}",
                code=envelope.get("code", "api_error"),
                status_code=response.status_code,
            )
        try:
            body = response.json()
        except ValueError as exc:
            raise GenerationApiError("invalid JSON from the generation service") from exc
        if not isinstance(body, dict):
            raise GenerationApiError("unexpected response shape from the generation service")
        return body


_client: GenerationApiClient | None = None
_client_lock = threading.Lock()


def get_client() -> GenerationApiClient:
    global _client
    if _client is None:
        # Double-checked under a lock: threaded WSGI servers must not race
        # two clients (requests.Session is not thread-safe to construct twice
        # and the loser's session would leak).
        with _client_lock:
            if _client is None:
                _client = GenerationApiClient(
                    settings.GENERATION_API_URL,
                    settings.GENERATION_API_TIMEOUT_SECONDS,
                    token=getattr(settings, "GENERATION_SERVICE_TOKEN", ""),
                )
    return _client
