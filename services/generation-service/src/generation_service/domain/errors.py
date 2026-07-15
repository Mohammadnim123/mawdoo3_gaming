"""Domain error hierarchy — mapped to HTTP responses at the API boundary."""

from __future__ import annotations


class DomainError(Exception):
    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(DomainError):
    code = "not_found"


class InvalidPromptError(DomainError):
    code = "invalid_prompt"


class StorageError(DomainError):
    code = "storage_error"


class ConflictError(DomainError):
    code = "conflict"


class FeatureDisabledError(DomainError):
    code = "feature_disabled"
