"""Domain error hierarchy — mapped to HTTP responses at the API boundary."""

from __future__ import annotations


class DomainError(Exception):
    code = "domain_error"

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        # Optional structured payload surfaced under error.details in the
        # HTTP envelope (e.g. static-validation findings on a source edit).
        self.details = details


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


class SourceValidationError(DomainError):
    """Hand-edited source rejected by the static validation gate. Carries the
    findings ({rule, line, snippet} items) in ``details``."""

    code = "validation_error"
