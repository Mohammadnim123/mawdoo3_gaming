from __future__ import annotations

import pytest
from pydantic import ValidationError

from generation_service.domain.blueprint import GameBlueprint


def test_blueprint_roundtrips_as_json(sample_blueprint):
    restored = GameBlueprint.model_validate_json(sample_blueprint.model_dump_json())
    assert restored == sample_blueprint


def test_strings_table_shape(sample_blueprint):
    table = sample_blueprint.strings_table()
    assert table["guess"] == {"en": "Guess", "ar": "خمّن"}


def test_tweaks_table_shape(sample_blueprint):
    assert sample_blueprint.tweaks_table() == {"max_attempts": 7.0, "max_number": 100.0}


def test_invalid_genre_rejected(sample_blueprint):
    data = sample_blueprint.model_dump()
    data["genre"] = "mmorpg"
    with pytest.raises(ValidationError):
        GameBlueprint.model_validate(data)


def test_bilingual_title_required(sample_blueprint):
    data = sample_blueprint.model_dump()
    del data["title"]["ar"]
    with pytest.raises(ValidationError):
        GameBlueprint.model_validate(data)


def test_webgl3d_rendering_accepted(sample_blueprint):
    data = sample_blueprint.model_dump()
    data["rendering"] = "webgl3d"
    assert GameBlueprint.model_validate(data).rendering == "webgl3d"
