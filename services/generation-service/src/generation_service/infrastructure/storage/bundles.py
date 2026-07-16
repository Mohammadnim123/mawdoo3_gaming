"""Bundle upload — the one place that writes a game's files to storage.

Used by the pipeline's store node and the seed script, so content types and
layout can never drift between the two paths. Bundles are immutable: every
build writes to its own version prefix (games/{id}/v{n}), so nothing here
ever overwrites a live game — old versions stay playable for the version
tree and rollback.
"""

from __future__ import annotations

import asyncio
import mimetypes

from generation_service.domain.ports import StoragePort


async def store_bundle(storage: StoragePort, prefix: str, files: dict[str, bytes]) -> str:
    """Write every bundle file (concurrently — the keys are independent)
    under the given storage prefix. Returns the prefix."""

    async def put(rel_path: str, data: bytes) -> None:
        content_type = mimetypes.guess_type(rel_path)[0] or "application/octet-stream"
        await storage.put(f"{prefix}/{rel_path}", data, content_type)

    await asyncio.gather(*(put(rel_path, data) for rel_path, data in files.items()))
    return prefix
