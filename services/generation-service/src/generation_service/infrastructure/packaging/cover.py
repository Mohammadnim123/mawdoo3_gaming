"""Cover art for a stored game bundle (Feature: cover_url).

Best-effort by contract: callers must treat any failure here as cosmetic —
a game without a cover is fine, a failed build because of a cover is not.

Two rungs, mirroring Codply's guarantee that every published version has a
poster:

1. The bundle painted a world backdrop (bg.png) → ``cover.png`` is a copy of
   it (the backdrop IS the game's look).
2. No painted art → a small procedural ``cover.svg``: the game's title over a
   135° two-color gradient derived from the blueprint's palette (the hex
   colors AI#1 wrote into ``visual_style``), falling back to brand
   violet → cyan.
"""

from __future__ import annotations

import re

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.ports import StoragePort
from generation_service.infrastructure.packaging.assembler import OPTIONAL_ART_FILE

COVER_PNG = "cover.png"
COVER_SVG = "cover.svg"

# Brand fallback gradient (violet → cyan) when the blueprint palette is not
# parseable out of the visual_style paragraph.
BRAND_GRADIENT = ("#7C3AED", "#06B6D4")

_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}\b")


def derive_cover_colors(blueprint: GameBlueprint) -> tuple[str, str]:
    """First two distinct palette colors from the blueprint's visual_style
    paragraph (AI#1 always writes a hex palette into it); brand gradient
    otherwise."""
    colors: list[str] = []
    for color in _HEX_COLOR.findall(blueprint.visual_style or ""):
        normalized = color.upper()
        if normalized not in colors:
            colors.append(normalized)
        if len(colors) == 2:
            return colors[0], colors[1]
    return BRAND_GRADIENT


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def make_cover_svg(title: str, color_a: str, color_b: str) -> str:
    """A simple procedural poster: 135deg two-color gradient + outlined title."""
    safe_title = _escape_xml(title.strip()[:48]) or "?"
    title_size = 52 if len(safe_title) <= 16 else 40 if len(safe_title) <= 26 else 30
    svg_open = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" '
        'viewBox="0 0 640 360">'
    )
    return f"""{svg_open}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{color_a}"/>
      <stop offset="1" stop-color="{color_b}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="500" cy="80" r="150" fill="#FFFFFF" opacity="0.08"/>
  <polygon points="0,240 640,60 640,110 0,300" fill="#FFFFFF" opacity="0.06"/>
  <rect y="220" width="640" height="140" fill="url(#floor)"/>
  <text x="40" y="300" font-family="'Space Grotesk', 'Trebuchet MS', sans-serif"
        font-size="{title_size}" font-weight="800" fill="#FFFFFF"
        stroke="{color_a}" stroke-width="8" paint-order="stroke">{safe_title}</text>
</svg>
"""


async def write_cover(
    storage: StoragePort,
    prefix: str,
    bundle_files: dict[str, bytes],
    blueprint: GameBlueprint,
) -> str:
    """Write the cover next to the bundle and return its file name.

    Raises on storage errors — callers wrap this in a best-effort try/except
    (a cover must never block or fail a publish)."""
    background = bundle_files.get(OPTIONAL_ART_FILE)
    if background:
        await storage.put(f"{prefix}/{COVER_PNG}", background, "image/png")
        return COVER_PNG
    color_a, color_b = derive_cover_colors(blueprint)
    title = getattr(blueprint.title, blueprint.default_locale, None) or blueprint.title.en
    svg = make_cover_svg(title, color_a, color_b)
    await storage.put(f"{prefix}/{COVER_SVG}", svg.encode("utf-8"), "image/svg+xml")
    return COVER_SVG
