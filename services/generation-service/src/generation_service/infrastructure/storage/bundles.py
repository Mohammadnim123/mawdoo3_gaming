"""Bundle upload — the one place that writes a game's files to storage.

Used by the pipeline's store node and the seed script, so content types and
stale-file cleanup can never drift between the two paths.
"""

from __future__ import annotations

import asyncio
import mimetypes

from generation_service.domain.entities import game_storage_prefix
from generation_service.domain.ports import StoragePort
from generation_service.infrastructure.packaging.assembler import OPTIONAL_RUNTIME_FILE


async def store_bundle(storage: StoragePort, game_id: str, files: dict[str, bytes]) -> str:
    """Write every bundle file (concurrently — the keys are independent) and
    remove the optional runtime if this bundle no longer ships it, so a tweak
    that drops 3D leaves no orphan behind. Returns the storage prefix."""
    prefix = game_storage_prefix(game_id)

    async def put(rel_path: str, data: bytes) -> None:
        content_type = mimetypes.guess_type(rel_path)[0] or "application/octet-stream"
        await storage.put(f"{prefix}/{rel_path}", data, content_type)

    await asyncio.gather(*(put(rel_path, data) for rel_path, data in files.items()))
    if OPTIONAL_RUNTIME_FILE not in files:
        await storage.delete(f"{prefix}/{OPTIONAL_RUNTIME_FILE}")
    return prefix
