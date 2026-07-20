"""Sprite transparency + size normalization — local, no ML.

Image providers paint "isolated" sprites on an opaque flat backdrop; games
need true alpha to composite them over painted scenes. ``ChromaCutout``
removes that backdrop with a border-sampled flood fill — pure Pillow,
deterministic, offline, ~50ms at sprite sizes. It fails OPEN: a busy border
(the provider painted a real scene) or an implausible cut returns the input
untouched, so a wrong guess can never destroy art.

Ported from the proven ForgePlay implementation (E24).
"""

from __future__ import annotations

import io
from collections import deque
from statistics import median

from PIL import Image


class ChromaCutout:
    """Border flood-fill background removal for isolated-subject sprites.

    - ``tolerance``: per-channel Chebyshev distance a pixel may sit from the
      sampled backdrop color and still count as background.
    - ``flat_ratio``: fraction of border pixels that must agree with the
      sampled backdrop for the border to count as "flat" (else fail open).
    - ``max_edge``: safety downscale before the fill (never fill >512²).
    """

    def __init__(
        self, *, tolerance: int = 28, flat_ratio: float = 0.88, max_edge: int = 512
    ) -> None:
        self._tolerance = tolerance
        self._flat_ratio = flat_ratio
        self._max_edge = max_edge

    def cut(self, data: bytes, *, target_size: tuple[int, int] | None = None) -> bytes:
        """Return ``data`` resized to ``target_size`` with the flat backdrop
        removed; on any "this doesn't look like a flat backdrop" signal the
        resized-but-opaque image is returned instead (fail open)."""
        img = Image.open(io.BytesIO(data)).convert("RGBA")
        if target_size is not None and img.size != tuple(target_size):
            img = img.resize(target_size, Image.LANCZOS)
        if max(img.size) > self._max_edge:
            img.thumbnail((self._max_edge, self._max_edge), Image.LANCZOS)

        backdrop = self._flat_backdrop(img)
        if backdrop is None:
            return self._encode(img)

        mask = self._flood_mask(img, backdrop)
        w, h = img.size
        cut_fraction = sum(mask) / (w * h)
        # <2%: nothing to remove (already transparent?); >98%: we'd erase the
        # whole sprite — both mean the flat-backdrop assumption was wrong.
        if not 0.02 <= cut_fraction <= 0.98:
            return self._encode(img)

        px = img.load()
        for y in range(h):
            row = y * w
            for x in range(w):
                if mask[row + x]:
                    r, g, b, _ = px[x, y]
                    px[x, y] = (r, g, b, 0)
        self._feather(img, mask)
        return self._encode(img)

    # ── internals ───────────────────────────────────────────────────────

    def _flat_backdrop(self, img: Image.Image) -> tuple[int, int, int] | None:
        """Median border color, or None when the border isn't a flat fill."""
        w, h = img.size
        px = img.load()
        ring = (
            [px[x, 0] for x in range(w)]
            + [px[x, h - 1] for x in range(w)]
            + [px[0, y] for y in range(h)]
            + [px[w - 1, y] for y in range(h)]
        )
        color = (
            int(median(p[0] for p in ring)),
            int(median(p[1] for p in ring)),
            int(median(p[2] for p in ring)),
        )
        agreeing = sum(1 for p in ring if self._near(p, color))
        if agreeing / len(ring) < self._flat_ratio:
            return None
        return color

    def _near(self, p: tuple[int, ...], c: tuple[int, int, int]) -> bool:
        return (
            abs(p[0] - c[0]) <= self._tolerance
            and abs(p[1] - c[1]) <= self._tolerance
            and abs(p[2] - c[2]) <= self._tolerance
        )

    def _flood_mask(self, img: Image.Image, backdrop: tuple[int, int, int]) -> bytearray:
        """BFS from every border pixel through backdrop-colored neighbors."""
        w, h = img.size
        px = img.load()
        mask = bytearray(w * h)
        queue: deque[tuple[int, int]] = deque()
        for x in range(w):
            queue.append((x, 0))
            queue.append((x, h - 1))
        for y in range(h):
            queue.append((0, y))
            queue.append((w - 1, y))
        while queue:
            x, y = queue.popleft()
            i = y * w + x
            if mask[i]:
                continue
            if not self._near(px[x, y], backdrop):
                continue
            mask[i] = 1
            if x > 0:
                queue.append((x - 1, y))
            if x < w - 1:
                queue.append((x + 1, y))
            if y > 0:
                queue.append((x, y - 1))
            if y < h - 1:
                queue.append((x, y + 1))
        return mask

    @staticmethod
    def _feather(img: Image.Image, mask: bytearray) -> None:
        """Soften the cut: foreground pixels touching background get partial alpha."""
        w, h = img.size
        px = img.load()
        for y in range(h):
            row = y * w
            for x in range(w):
                if mask[row + x]:
                    continue
                touching_bg = (
                    (x > 0 and mask[row + x - 1])
                    or (x < w - 1 and mask[row + x + 1])
                    or (y > 0 and mask[row - w + x])
                    or (y < h - 1 and mask[row + w + x])
                )
                if touching_bg:
                    r, g, b, a = px[x, y]
                    px[x, y] = (r, g, b, min(a, 150))

    @staticmethod
    def _encode(img: Image.Image) -> bytes:
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()
