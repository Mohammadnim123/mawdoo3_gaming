"""AI-facing structured-output schemas that are not domain artifacts.

The blueprint (domain/blueprint.py) and GeneratedGameCode (domain/entities.py)
are domain models reused directly as structured-output schemas — the schema
IS the contract. This module holds the remaining, purely-internal one.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from generation_service.domain.blueprint import Genre
from generation_service.domain.entities import ClarifyOption, ClarifyQuestion


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


class RawClarifyingQuestion(BaseModel):
    """One clarifying question exactly as the understanding model emits it."""

    question: str = Field(description="The question, in the same language as the prompt")
    options: list[str] = Field(
        description="2-4 short one-tap answer options, same language as the prompt"
    )
    default_option_index: int = Field(
        default=0,
        description="Index into options of the best 'surprise me' default",
    )


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
    clarifying_questions: list[RawClarifyingQuestion] = Field(
        default_factory=list,
        description="0-3 one-tap clarifying questions, ONLY when the prompt is genuinely "
        "ambiguous about something that changes the game (theme, difficulty, mechanic). "
        "Each has 2-4 short options and a smart default. Empty when the prompt is clear.",
    )

    def domain_questions(self) -> list[ClarifyQuestion]:
        """Project the LLM's raw questions onto the domain shape (stable ids,
        option ids derived from position so answers survive label edits)."""
        questions: list[ClarifyQuestion] = []
        for q_index, raw in enumerate(self.clarifying_questions[:3]):
            options = [
                ClarifyOption(id=f"opt_{o_index + 1}", label=label.strip())
                for o_index, label in enumerate(raw.options[:4])
                if label.strip()
            ]
            if len(options) < 2:
                continue
            default_index = raw.default_option_index
            if not 0 <= default_index < len(options):
                default_index = 0
            questions.append(
                ClarifyQuestion(
                    id=f"q_{q_index + 1}",
                    question=raw.question.strip(),
                    options=options,
                    default_option_id=options[default_index].id,
                )
            )
        return questions
