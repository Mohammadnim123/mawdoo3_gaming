"""Google Cloud Storage adapter — the production object store.

Implements the same StoragePort contract as LocalFolderStorage with identical
key semantics (games/{game_id}/v{n}/index.html), so switching from local disk
to GCS is a config swap (STORAGE_BACKEND=gcs) — the pipeline never knows which
adapter is behind the port.

Bundles are served to browsers through Cloud CDN (a backend bucket in front of
this bucket), so every object carries an explicit Content-Type and a
Cache-Control that mirrors the local play route's revalidation policy: bundles
can be replaced in place on a tweak, so `no-cache` forces the CDN/browser to
revalidate and a finished edit is visible on the next load instead of after a
stale TTL. Cheap conditional GETs (ETag/If-None-Match) still offload bandwidth.

The google-cloud-storage client uses Application Default Credentials, which on
Cloud Run is the service's runtime service account — no keys in the image.
"""

from __future__ import annotations

import asyncio

from google.api_core import exceptions as gcs_exceptions
from google.cloud import storage as gcs

from generation_service.domain.errors import NotFoundError, StorageError

# Matches the local play route + games-cdn stand-in: bundles are mutable in
# place, so always revalidate rather than serve a stale edit.
_DEFAULT_CACHE_CONTROL = "no-cache"


class GcsStorage:
    """Object storage backed by a single GCS bucket. Keys are used verbatim as
    object names, so the bucket layout mirrors the local folder layout exactly."""

    def __init__(self, bucket_name: str, *, cache_control: str = _DEFAULT_CACHE_CONTROL) -> None:
        if not bucket_name:
            raise StorageError("STORAGE_BACKEND=gcs requires OBJECT_STORAGE_BUCKET to be set")
        self._bucket_name = bucket_name
        self._cache_control = cache_control
        # One client per process; the underlying HTTP session is thread-safe and
        # every call below runs on a worker thread via asyncio.to_thread.
        self._client = gcs.Client()
        self._bucket = self._client.bucket(bucket_name)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(self._put_sync, key, data, content_type)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._get_sync, key)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._delete_sync, key)

    # --- sync workers (run off the event loop) -------------------------------

    def _put_sync(self, key: str, data: bytes, content_type: str) -> None:
        blob = self._bucket.blob(key)
        blob.cache_control = self._cache_control
        try:
            blob.upload_from_string(data, content_type=content_type)
        except gcs_exceptions.GoogleAPICallError as exc:  # pragma: no cover - network
            raise StorageError(f"failed writing object {key!r}: {exc}") from exc

    def _get_sync(self, key: str) -> bytes:
        blob = self._bucket.blob(key)
        try:
            return blob.download_as_bytes()
        except gcs_exceptions.NotFound as exc:
            raise NotFoundError(f"no object at key {key!r}") from exc
        except gcs_exceptions.GoogleAPICallError as exc:  # pragma: no cover - network
            raise StorageError(f"failed reading object {key!r}: {exc}") from exc

    def _delete_sync(self, key: str) -> None:
        blob = self._bucket.blob(key)
        try:
            blob.delete()
        except gcs_exceptions.NotFound:
            return  # idempotent — deleting a missing object is a no-op
        except gcs_exceptions.GoogleAPICallError as exc:  # pragma: no cover - network
            raise StorageError(f"failed deleting object {key!r}: {exc}") from exc
