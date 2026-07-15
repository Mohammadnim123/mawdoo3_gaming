"""Boots the real app (lifespan + container wiring) against temp dirs."""

from __future__ import annotations

import pytest
from tests.conftest import boot_client


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from generation_service.config.settings import get_settings

    with boot_client(tmp_path, monkeypatch) as test_client:
        yield test_client
    get_settings.cache_clear()


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_games_list_empty(client):
    response = client.get("/api/v1/games")
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == [] and body["total"] == 0


def test_unknown_game_is_404_envelope(client):
    response = client.get("/api/v1/games/doesnotexist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_prompt_validation(client):
    response = client.post("/api/v1/generations", json={"prompt": "x"})
    assert response.status_code == 422
    # Request-validation failures use the same envelope as every other error.
    assert response.json()["error"]["code"] == "validation_error"
