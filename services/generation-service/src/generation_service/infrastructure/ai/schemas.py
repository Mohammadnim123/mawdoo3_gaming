"""AI-facing structured-output schemas that are not domain artifacts.

The blueprint (domain/blueprint.py) and GeneratedGameCode (domain/entities.py)
are domain models reused directly as structured-output schemas — the schema
IS the contract. This module holds the remaining, purely-internal one.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from generation_service.domain.blueprint import Genre


class ReviewIssue(BaseModel):
    rule: str = Field(description="The blueprint rule or aspect the issue violates")
    problem: str = Field(description="The concrete logic defect a player would hit")
    fix_hint: str = Field(description="Short, actionable instruction for fixing it")


class ReviewVerdict(BaseModel):
    """Output of the deep logic review (gate stage 2)."""

    passed: bool = Field(description="False only for genuine gameplay-logic defects")
    issues: list[ReviewIssue] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _infer_passed_from_issues(cls, data: object) -> object:
        # Models reporting issues sometimes omit the verdict flag. The issue
        # list is unambiguous (issues → failed, none → passed), so infer it
        # instead of burning a corrective retry. A payload without an issue
        # list still fails validation as before.
        if (
            isinstance(data, dict)
            and "passed" not in data
            and isinstance(data.get("issues"), list)
        ):
            return {**data, "passed": not data["issues"]}
        return data


class PromptAnalysis(BaseModel):
    """Output of the prompt-understanding stage (AI call #0)."""

    in_scope: bool = Field(
        description="True only for a small single-player browser mini-game (HTML/CSS/JS)"
    )
    rejection_reason: str = Field(
        default="",
        description="When out of scope: one short sentence the user could be shown, "
        "in the same language as their prompt",
    )
    game_concept: str = Field(
        default="",
        description="Normalized one-paragraph English description of the game to build; "
        "if the prompt was vague, a sensible concrete mini-game interpretation. "
        "May be empty when in_scope is false",
    )
    detected_language: Literal["ar", "en", "mixed", "other"] = Field(
        default="en",
        description="Language of the user's prompt ('other' for anything besides ar/en)",
    )
    suggested_genre: Genre = Field(
        default=Genre.OTHER,
        description="Closest genre; 'other' when out of scope",
    )
