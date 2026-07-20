"""Normalization for user-supplied tweak reference images.

User-supplied image bytes are hostile input (mirrors Codply core-py
images.py): never trust the claimed type — sniff with Pillow, reject
decompression bombs by PIXEL count before any full decode, apply the EXIF
orientation, cap the long edge at Claude's optimal ~1568px, and RE-ENCODE to
WebP (which also strips EXIF/GPS metadata). The result is base64 of a
well-formed image sized for the model to read, ready to drop into an
Anthropic image content block.
"""

from __future__ import annotations

import base64
import binascii
import io
import re

from PIL import Image, ImageOps, UnidentifiedImageError

from generation_service.domain.errors import InvalidPromptError

#: hard cap on the accepted base64 payload (chars ≈ bytes * 4/3)
MAX_IMAGE_B64_CHARS = 8_000_000
#: formats Pillow may report for an accepted upload (sniffed, not claimed)
ACCEPTED_FORMATS = frozenset({"PNG", "JPEG", "WEBP", "GIF"})
#: absolute decode ceiling — 4096² RGBA ≈ 64 MB transient, a safe worst case
MAX_PIXELS = 4096 * 4096
#: Claude down-samples anything with a long edge over ~1568px
MAX_LONG_EDGE = 1568
#: visually lossless at these sizes
WEBP_QUALITY = 88
#: media type of the normalized payload (for the LLM image block)
NORMALIZED_MEDIA_TYPE = "image/webp"

_DATA_URL_PREFIX = re.compile(r"^data:image/[\w.+-]+;base64,", re.IGNORECASE)
_WHITESPACE = re.compile(r"\s+")


def normalize_image_b64(image_base64: str) -> str:
    """Validate + normalize a raw-base64 or data-URL image; return base64 WebP.

    Raises :class:`InvalidPromptError` (HTTP 422) on anything that is not a
    reasonable image. Pure CPU work — call via ``asyncio.to_thread``.
    """
    raw = _WHITESPACE.sub("", _DATA_URL_PREFIX.sub("", image_base64.strip()))
    if not raw:
        raise InvalidPromptError("image_base64 is empty")
    if len(raw) > MAX_IMAGE_B64_CHARS:
        raise InvalidPromptError("the attached image is too large")
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidPromptError("image_base64 is not valid base64") from exc
    if not data:
        raise InvalidPromptError("image_base64 is empty")

    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format
            width, height = probe.size
            if fmt not in ACCEPTED_FORMATS:
                raise InvalidPromptError(
                    "unsupported image type — attach a PNG, JPEG, WebP or GIF"
                )
            # Bomb guard BEFORE any full decode: header dims are enough.
            if width * height > MAX_PIXELS:
                raise InvalidPromptError("the attached image's dimensions are too large")
            probe.verify()  # structural integrity (headers/CRCs)

        # verify() invalidates the parser — reopen for the real decode.
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            upright = ImageOps.exif_transpose(image) or image
            normalized = upright.convert("RGBA" if _has_alpha(upright) else "RGB")
            # thumbnail() fits inside a square keeping aspect — the LONGEST
            # side ends up ≤ MAX_LONG_EDGE and upscaling never happens.
            normalized.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            normalized.save(out, format="WEBP", quality=WEBP_QUALITY, method=4)
    except InvalidPromptError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise InvalidPromptError(
            "could not read the attached image — the file looks corrupt"
        ) from exc

    return base64.b64encode(out.getvalue()).decode("ascii")


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info
    )
