"""Tweak (chat-edit) API behavior through the real app boot."""

from __future__ import annotations

import pytest
from tests.conftest import boot_client


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from generation_service.config.settings import get_settings

    with boot_client(tmp_path, monkeypatch, FEATURE_TWEAKS_API="true") as test_client:
        yield test_client
    get_settings.cache_clear()


@pytest.fixture()
def client_flag_off(tmp_path, monkeypatch):
    from generation_service.config.settings import get_settings

    with boot_client(tmp_path, monkeypatch, FEATURE_TWEAKS_API="false") as test_client:
        yield test_client
    get_settings.cache_clear()


def test_tweak_unknown_game_is_404(client):
    response = client.post(
        "/api/v1/games/doesnotexist/tweaks", json={"instruction": "make it faster"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_tweak_instruction_validation(client):
    response = client.post("/api/v1/games/whatever/tweaks", json={"instruction": "x"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_tweak_disabled_flag_is_403(client_flag_off):
    response = client_flag_off.post(
        "/api/v1/games/whatever/tweaks", json={"instruction": "make it faster"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "feature_disabled"
