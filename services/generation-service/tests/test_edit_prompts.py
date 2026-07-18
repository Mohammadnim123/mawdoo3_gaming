"""Chat-edit (tweak) prompts must make the creator's request authoritative.

Regression guard for the "edits are never applied" loop: a visual request
(colors, transparency, size) used to be drowned out by the "build exactly this
blueprint" + "keep the current look" framing, so the same game came back
unchanged. These tests lock in that the edit goal is surfaced up front and is
allowed to override the palette/preserve defaults.
"""

from __future__ import annotations

from generation_service.infrastructure.ai.prompts import (
    CODE_SYSTEM,
    PREVIOUS_CODE_TEMPLATE,
    REVISE_BLUEPRINT_SYSTEM,
    build_code,
    build_revise_blueprint,
)

INSTRUCTION = "remove the transparency and make X and O more visible"


def test_edit_goal_leads_the_code_prompt_and_precedes_the_blueprint():
    _system, user = build_code(
        "CONTRACT",
        '{"title": "x"}',
        previous_section="PREV",
        feedback="",
        edit_goal=INSTRUCTION,
    )
    assert INSTRUCTION in user
    # The goal is read BEFORE the blueprint JSON block.
    assert user.index(INSTRUCTION) < user.index("Blueprint (build exactly this):")
    assert "authoritative" in user.lower()
    assert "overrides" in user.lower()


def test_build_code_without_edit_goal_is_unchanged_for_fresh_builds():
    """The create path passes no edit_goal — no authoritative-edit header leaks in."""
    _system, user = build_code("CONTRACT", '{"title": "x"}', previous_section="", feedback="")
    assert user.startswith("Blueprint (build exactly this):")
    assert "You are EDITING an existing game" not in user


def test_previous_code_template_makes_the_request_override_preserve_defaults():
    section = PREVIOUS_CODE_TEMPLATE.format(
        game_js="var a=1;", game_css=".b{}", instruction=INSTRUCTION
    )
    assert INSTRUCTION in section
    lowered = section.lower()
    assert "overrides" in lowered
    # Still asks to keep untouched parts minimal, but no longer a blanket
    # "keep the look and feel" that swallows the requested change.
    assert "minimal changes" in lowered
    # Names the concrete levers so a visual edit actually lands in the code.
    assert "globalalpha" in lowered or "background-color" in lowered


def test_code_system_color_law_has_an_explicit_edit_override():
    lowered = CODE_SYSTEM.lower()
    assert "creator revision request" in lowered
    assert "transparency" in lowered


def test_revise_blueprint_encodes_appearance_requests():
    system, user = build_revise_blueprint('{"visual_style": "wood"}', INSTRUCTION)
    assert system is REVISE_BLUEPRINT_SYSTEM
    assert INSTRUCTION in user
    lowered = REVISE_BLUEPRINT_SYSTEM.lower()
    assert "visual_style" in lowered
    assert "transparency" in lowered or "opacity" in lowered
    # A visual edit must be allowed to change the actual palette hexes.
    assert "hex" in lowered
