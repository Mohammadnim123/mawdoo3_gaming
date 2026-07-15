"""ReviewVerdict resilience: the verdict flag is inferred from the issue list
when the model omits it (seen in production at the deep_review stage)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from generation_service.infrastructure.ai.schemas import ReviewVerdict

ISSUE = {"rule": "core_rule", "problem": "score never increments", "fix_hint": "wire it"}


def test_missing_passed_with_issues_is_inferred_failed():
    verdict = ReviewVerdict.model_validate({"issues": [ISSUE]})
    assert verdict.passed is False
    assert len(verdict.issues) == 1


def test_missing_passed_with_no_issues_is_inferred_passed():
    verdict = ReviewVerdict.model_validate({"issues": []})
    assert verdict.passed is True


def test_explicit_passed_is_never_overridden():
    # A reviewer may pass the game while still listing advisory issues.
    verdict = ReviewVerdict.model_validate({"passed": True, "issues": [ISSUE]})
    assert verdict.passed is True


def test_empty_payload_still_fails_validation():
    with pytest.raises(ValidationError):
        ReviewVerdict.model_validate({})
