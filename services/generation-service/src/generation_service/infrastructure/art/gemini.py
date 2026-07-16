"""Background painting — Gemini native image generation ("Nano Banana").

One job: turn the blueprint's painting brief into a full-scene backdrop PNG
that ships in the bundle as ``bg.png``. Request/response shape follows
Google's generateContent REST API (verified against the working ForgePlay
adapter): the prompt goes in as a text part, the image comes back as the
first ``inlineData`` part of the first candidate.

Painting is a progressive enhancement: every failure path raises ``ArtError``
and the pipeline node degrades to the procedural layered backdrop the code
prompt already demands — a paint outage must never fail a generation.
"""

from __future__ import annotations

import base64
import logging

import httpx

logger = logging.getLogger(__name__)

#: Composition guidance prepended to every brief (the ForgePlay pattern):
#: paintings are worlds, not characters — sprites/entities live on layers
#: above, and text in the art would fight the localized HUD.
_BACKGROUND_PREFIX = (
    "full-frame mobile game background illustration, painterly, rich "
    "lighting and depth, no text, no logo, no main character, "
)

#: Sprite suffix (the ForgePlay E24 pattern): "isolated on a plain flat
#: background" makes the chroma cutout deterministic — the flood fill needs
#: a flat ring around the subject.
_SPRITE_SUFFIX = (
    ", single subject centered, isolated on a plain flat light background, "
    "whole subject in frame, no cropping, no text"
)


class ArtError(Exception):
    """Painting failed — callers degrade to the procedural backdrop."""


class GeminiArtClient:
    def __init__(
        self,
        api_key: str,
        *,
        model: str,
        base_url: str = "https://generativelanguage.googleapis.com",
        timeout_seconds: float = 90.0,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    async def paint_background(self, brief: str, aspect_ratio: str = "16:9") -> bytes:
        """Paint the game's world backdrop; returns PNG/JPEG bytes."""
        return await self._generate(f"{_BACKGROUND_PREFIX}{brief}", aspect_ratio)

    async def paint_sprite(self, brief: str) -> bytes:
        """Paint an isolated game sprite (square, flat backdrop for cutout)."""
        return await self._generate(
            f"mobile game sprite art of {brief}{_SPRITE_SUFFIX}", "1:1"
        )

    async def _generate(self, prompt: str, aspect_ratio: str) -> bytes:
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": {"aspectRatio": aspect_ratio},
            },
        }
        url = f"{self._base_url}/v1beta/models/{self._model}:generateContent"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    url,
                    headers={
                        "x-goog-api-key": self._api_key,
                        "content-type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise ArtError(f"cannot reach Gemini: {exc}") from exc
        if response.status_code != 200:
            raise ArtError(f"Gemini returned HTTP {response.status_code}: {response.text[:200]}")
        try:
            parts = response.json()["candidates"][0]["content"]["parts"]
            # REST replies camelCase; accept snake_case defensively too.
            inline = next(
                p["inlineData"] if "inlineData" in p else p["inline_data"]
                for p in parts
                if isinstance(p, dict) and ("inlineData" in p or "inline_data" in p)
            )
            return base64.b64decode(inline["data"])
        except (KeyError, IndexError, TypeError, StopIteration, ValueError) as exc:
            raise ArtError("Gemini response has no inline-data image part") from exc
