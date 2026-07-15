"""The game blueprint — the pipeline's internal design artifact.

Produced by AI#1 as structured output, consumed by AI#2 as the build spec,
used by the quality gate as the answer key, and stored verbatim for
reproducibility. Users never see it.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

BLUEPRINT_SCHEMA_VERSION = "1.0"


class Genre(StrEnum):
    ARCADE = "arcade"
    PUZZLE = "puzzle"
    MEMORY = "memory"
    QUIZ = "quiz"
    BOARD = "board"
    RUNNER = "runner"
    SHOOTER = "shooter"
    PLATFORMER = "platformer"
    CLICKER = "clicker"
    WORD = "word"
    OTHER = "other"


class LocalizedText(BaseModel):
    """Every user-facing text exists in both languages — C1 is a launch gate."""

    en: str = Field(description="Natural English text")
    ar: str = Field(description="Natural Arabic text (not transliteration)")


class Control(BaseModel):
    input: Literal["keyboard", "mouse", "touch", "tap", "swipe"] = Field(
        description="Input channel"
    )
    action: str = Field(description="What this input does, e.g. 'arrow keys steer the snake'")


class TweakParameter(BaseModel):
    """A numeric knob the game must consume via sdk.tweaks.<name>."""

    name: str = Field(description="snake_case identifier, e.g. 'speed'")
    description: str = Field(description="What the knob controls")
    value: float = Field(description="Default value")
    min_value: float | None = Field(default=None, description="Lower bound, if meaningful")
    max_value: float | None = Field(default=None, description="Upper bound, if meaningful")


class UiString(BaseModel):
    """A localized UI string the game reads via sdk.t(key)."""

    key: str = Field(description="snake_case key, e.g. 'game_over'")
    en: str
    ar: str


class GameBlueprint(BaseModel):
    """Structured, machine-readable design for one small browser mini-game."""

    schema_version: Literal["1.0"] = BLUEPRINT_SCHEMA_VERSION
    title: LocalizedText
    genre: Genre
    summary: str = Field(description="One-paragraph description of the game")
    core_rule: str = Field(
        description=(
            "The single testable core mechanic, e.g. 'the snake grows by one segment per "
            "food eaten; hitting a wall or itself ends the game'"
        )
    )
    win_condition: str | None = Field(default=None, description="How the player wins, if any")
    lose_condition: str | None = Field(default=None, description="How the player loses, if any")
    rules: list[str] = Field(description="3-8 short, individually checkable gameplay rules")
    controls: list[Control]
    difficulty: str = Field(description="Difficulty shape, e.g. 'speed increases every 5 points'")
    rendering: Literal["canvas", "dom", "webgl3d"] = Field(
        description=(
            "canvas for 2D motion/physics games, dom for card/board/quiz games, "
            "webgl3d for lightweight 3D games (Three.js primitives, no external assets)"
        )
    )
    default_locale: Literal["ar", "en"] = Field(
        description="'ar' when the prompt was Arabic, else 'en'"
    )
    visual_style: str = Field(
        description=(
            "Complete art direction in one dense paragraph: named theme, concrete palette "
            "of 4-6 hex colors (background / surface / primary / accent / danger-success), "
            "lighting & atmosphere (gradients, vignette, glow), the look of each major "
            "entity, and 2-3 signature effects (particles, trails, pulses). Must be "
            "achievable procedurally with CSS/canvas gradients, shadows, shapes, Unicode "
            "and emoji — no image assets exist"
        )
    )
    entities: list[str] = Field(description="Main game objects, e.g. ['snake', 'food', 'walls']")
    tweaks: list[TweakParameter] = Field(description="2-6 numeric knobs with sensible defaults")
    ui_strings: list[UiString] = Field(
        description="Every text the game displays (labels, start, game over, win...)"
    )

    def strings_table(self) -> dict[str, dict[str, str]]:
        """Runtime-manifest form consumed by the template engine's sdk.t()."""
        return {s.key: {"en": s.en, "ar": s.ar} for s in self.ui_strings}

    def tweaks_table(self) -> dict[str, float]:
        return {t.name: t.value for t in self.tweaks}
