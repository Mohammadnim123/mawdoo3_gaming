"""Cover key-art prompt — the poster brief for a game's feed card.

Where the cover diverges from the background painter, and why our old covers
looked flat: ``bg.png`` is deliberately EMPTY — no hero, no text, uncluttered
center — so the game can composite sprites and a localized HUD on top. Reusing
that backdrop as the feed cover gives a lifeless poster (an empty wooden board,
a bare gradient). A feed cover wants the opposite — the Codply pattern:

* the hero large and mid-action, a single dramatic composition;
* the game's TITLE lettered INTO the art as a bold arcade logo;
* the game's own palette, dramatized.

This module composes that poster prompt from the SAME blueprint the pipeline
already produced (title, palette, background scene, hero sprites) — no extra
LLM round-trip, no gameplay screenshot needed.
"""

from __future__ import annotations

import re

from generation_service.domain.blueprint import GameBlueprint

#: Brand fallback when the blueprint palette can't be parsed (matches the SVG).
_BRAND = ("#7C3AED", "#06B6D4")

_HEX = re.compile(r"#[0-9a-fA-F]{6}\b")

#: Longest title we letter into the art; longer ones render as cramped glyphs.
_MAX_TITLE = 28

#: Finish/lighting the poster always asks for — a glossy store poster, not a
#: flat screenshot. Kept separate from the scene so the tone stays consistent.
_STYLE_KEYWORDS = (
    "painted key art, cel-shaded, dramatic rim lighting, high color "
    "saturation, glossy friendly mobile-game store poster"
)

#: The title logo lives IN the art, so we forbid the usual junk — never text.
_NEGATIVES = (
    "no photorealism, no gradient banding, no watermark, no signature, "
    "no UI buttons, no score text, no screenshot border"
)


def cover_title(blueprint: GameBlueprint) -> str:
    """The exact word(s) lettered into the poster, uppercased for arcade punch.

    Latin only: image models render Arabic script as broken glyphs, so we
    always letter the English title (the crisp Arabic title still fronts the
    SVG fallback, which uses a real font)."""
    english = (blueprint.title.en or "").strip()
    chosen = english or (getattr(blueprint.title, blueprint.default_locale, "") or "").strip()
    return chosen[:_MAX_TITLE].strip().upper()


def _palette(blueprint: GameBlueprint) -> tuple[str, str]:
    """First two distinct hex colors AI#1 wrote into visual_style; brand
    gradient otherwise."""
    seen: list[str] = []
    for hexcode in _HEX.findall(blueprint.visual_style or ""):
        up = hexcode.upper()
        if up not in seen:
            seen.append(up)
        if len(seen) == 2:
            break
    while len(seen) < 2:
        seen.append(_BRAND[len(seen)])
    return seen[0], seen[1]


def _hero_clause(blueprint: GameBlueprint) -> str:
    """The poster's subject — the game's most-looked-at objects, staged as
    heroes. Prefer the painted sprite briefs (real hero art), then entities."""
    subjects = [
        brief.prompt.strip().rstrip(".")
        for brief in blueprint.sprite_briefs[:2]
        if brief.prompt.strip()
    ]
    if subjects:
        noun = "heroes" if len(subjects) > 1 else "hero"
        return (
            f"{' and '.join(subjects)} — the {noun} shown large, dynamic and "
            "mid-action in the foreground"
        )
    if blueprint.entities:
        return f"{blueprint.entities[0]} as the hero, large and mid-action in the foreground"
    return "the game's hero large and mid-action in the foreground"


def _scene_clause(blueprint: GameBlueprint) -> str:
    """The world behind the hero — the blueprint's background scene when it
    wrote one, else a mood derived from the genre."""
    scene = (blueprint.background_art_prompt or "").strip().rstrip(".")
    if scene:
        return f"set in {scene}"
    return f"in a vivid, dramatic {blueprint.genre} game world with atmospheric depth"


def _style_cue(blueprint: GameBlueprint) -> str:
    """A light look cue from the art direction — its first clause usually names
    the look (neon-arcade, pastel-toy…). Kept short so palette + keywords win."""
    head = (blueprint.visual_style or "").strip().split(".")[0].strip()
    return head[:120]


def build_cover_prompt(blueprint: GameBlueprint) -> str:
    """Compose the full poster prompt: scene · baked-in title logo · finish
    keywords · negatives (the same shape every art call receives)."""
    color_a, color_b = _palette(blueprint)
    parts = [f"{_hero_clause(blueprint)}, {_scene_clause(blueprint)}"]
    title = cover_title(blueprint)
    if title:
        parts.append(
            "the game title lettered into the art as a large bold stylized arcade "
            f'logo reading "{title}" across the top — thick rounded 3D letters '
            f"with a dark outline, in {color_a} and {color_b}"
        )
    cue = _style_cue(blueprint)
    if cue:
        parts.append(cue)
    parts.append(_STYLE_KEYWORDS)
    parts.append(_NEGATIVES)
    return ". ".join(part for part in parts if part)
