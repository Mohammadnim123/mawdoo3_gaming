"""Input-size limits shared by the API DTOs and the use cases.

One definition per limit — the DTO Field constraints and the use-case guards
both import from here, so the two validation layers can never drift.
"""

from __future__ import annotations

PROMPT_MIN_CHARS = 3
PROMPT_MAX_CHARS = 2000

INSTRUCTION_MIN_CHARS = 2
INSTRUCTION_MAX_CHARS = 500

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
