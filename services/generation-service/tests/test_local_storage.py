from __future__ import annotations

import pytest

from generation_service.domain.errors import NotFoundError, StorageError
from generation_service.infrastructure.storage.local import LocalFolderStorage


async def test_roundtrip(tmp_path):
    storage = LocalFolderStorage(tmp_path)
    key = "games/xyz/index.html"
    await storage.put(key, b"<html></html>", "text/html")
    assert await storage.get(key) == b"<html></html>"


async def test_missing_key_raises(tmp_path):
    storage = LocalFolderStorage(tmp_path)
    with pytest.raises(NotFoundError):
        await storage.get("games/nope/index.html")


async def test_overwrite_is_atomic_and_leaves_no_temp_files(tmp_path):
    storage = LocalFolderStorage(tmp_path)
    key = "games/a/game.js"
    await storage.put(key, b"old", "text/javascript")
    await storage.put(key, b"new", "text/javascript")
    assert await storage.get(key) == b"new"
    assert [p.name for p in (tmp_path / "games" / "a").iterdir()] == ["game.js"]


async def test_delete(tmp_path):
    storage = LocalFolderStorage(tmp_path)
    await storage.put("games/a/three.min.js", b"x", "text/javascript")
    await storage.delete("games/a/three.min.js")
    with pytest.raises(NotFoundError):
        await storage.get("games/a/three.min.js")
    # Deleting a missing key is a no-op, not an error.
    await storage.delete("games/a/three.min.js")


async def test_path_traversal_is_blocked(tmp_path):
    storage = LocalFolderStorage(tmp_path / "base")
    with pytest.raises(StorageError):
        await storage.put("../escape.txt", b"x", "text/plain")
