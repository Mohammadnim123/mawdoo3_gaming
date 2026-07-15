"""Local-folder storage adapter.

Simulates the object store for development: same keys, same semantics, only
the base differs (a folder root here, a bucket in prod). The pipeline never
knows which adapter is behind the port, so cloud migration is a config swap.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

from generation_service.domain.errors import NotFoundError, StorageError


class LocalFolderStorage:
    def __init__(self, base_dir: Path) -> None:
        self._base = base_dir.resolve()
        self._base.mkdir(parents=True, exist_ok=True)

    def _path_for(self, key: str) -> Path:
        path = (self._base / key).resolve()
        if not path.is_relative_to(self._base):
            raise StorageError(f"illegal storage key: {key!r}")
        return path

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path_for(key)
        await asyncio.to_thread(self._write_atomic, path, data)

    async def get(self, key: str) -> bytes:
        path = self._path_for(key)
        if not path.is_file():
            raise NotFoundError(f"no object at key {key!r}")
        return await asyncio.to_thread(path.read_bytes)

    async def delete(self, key: str) -> None:
        path = self._path_for(key)
        await asyncio.to_thread(path.unlink, True)

    @staticmethod
    def _write_atomic(path: Path, data: bytes) -> None:
        """Write via a temp file + rename so readers (the play route, the
        games-cdn) never observe a partially written file — bundles are
        replaced in place on tweaks while the old game is being served."""
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp_name, path)
        except BaseException:
            os.unlink(tmp_name)
            raise
