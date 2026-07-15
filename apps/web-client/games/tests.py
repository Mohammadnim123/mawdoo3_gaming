"""View tests with the generation API and the validation LLM mocked — no live
service, no network, no database.

The API client is faked at the view boundary (games.views.get_client), which
is exactly the seam the architecture defines: everything below it belongs to
the generation service and is tested there. The prompt-validation LLM call —
the one AI call this app owns — is faked at the same altitude
(games.views.validate_prompt); its own parsing is unit-tested against a
mocked SDK client below.
"""

from __future__ import annotations

from unittest import mock

import anthropic
from django.test import SimpleTestCase

from games.services import prompt_validation
from games.services.generation_api import GenerationApiError, GenerationApiUnavailable
from games.services.prompt_validation import PromptValidationUnavailable, PromptVerdict

GAME = {
    "id": "abc123",
    "title": {"en": "Number Guess", "ar": "تخمين الأرقام"},
    "genre": "puzzle",
    "summary": "Guess the secret number",
    "default_locale": "ar",
    "prompt": "لعبة تخمين أرقام",
    "template_version": "1.0.0",
    "play_url": "http://localhost:8000/g/abc123/index.html",
    "created_at": "2026-07-14T10:00:00Z",
}

JOB_RUNNING = {
    "id": "job1",
    "status": "running",
    "stage": "code_generation",
    "prompt": "Build a Snake game",
    "game_id": None,
    "error": None,
    "created_at": "2026-07-14T10:00:00Z",
    "updated_at": "2026-07-14T10:00:05Z",
}

JOB_SUCCEEDED = {**JOB_RUNNING, "status": "succeeded", "stage": "done", "game_id": "abc123"}
JOB_FAILED = {
    **JOB_RUNNING,
    "status": "failed",
    "stage": "validation",
    "error": {"code": "gate_failed", "message": "quality gate exhausted retries"},
}


def _patch_client(**methods: mock.Mock):
    client = mock.Mock(**methods)
    return mock.patch("games.views.get_client", return_value=client), client


class HomeViewTests(SimpleTestCase):
    def test_lists_games_from_the_service(self):
        patcher, client = _patch_client(
            list_games=mock.Mock(return_value={"items": [GAME], "total": 1})
        )
        with patcher:
            response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "تخمين الأرقام")
        client.list_games.assert_called_once()

    def test_lang_toggle_switches_direction(self):
        patcher, _ = _patch_client(list_games=mock.Mock(return_value={"items": []}))
        with patcher:
            response = self.client.get("/?lang=en")
        self.assertContains(response, 'dir="ltr"')
        self.assertEqual(response.cookies["lang"].value, "en")

    def test_service_down_renders_error_not_crash(self):
        patcher, _ = _patch_client(
            list_games=mock.Mock(side_effect=GenerationApiUnavailable("connection refused"))
        )
        with patcher:
            response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "تعذّر الوصول إلى خدمة التوليد")


def _patch_validator(**kwargs) -> mock._patch:
    """Fake the app's own LLM validation at the view seam."""
    return mock.patch("games.views.validate_prompt", mock.Mock(**kwargs))


class GenerateViewTests(SimpleTestCase):
    def test_valid_prompt_is_validated_then_dispatched(self):
        patcher, client = _patch_client(
            start_generation=mock.Mock(return_value=JOB_RUNNING),
        )
        validator = _patch_validator(return_value=PromptVerdict(valid=True))
        with patcher, validator as validate:
            response = self.client.post("/generate/", {"prompt": "Build a Snake game"})
        self.assertRedirects(
            response, "/generations/job1/?lang=ar", fetch_redirect_response=False
        )
        validate.assert_called_once_with("Build a Snake game")
        client.start_generation.assert_called_once_with("Build a Snake game")

    def test_rejected_prompt_shows_reason_and_never_dispatches(self):
        patcher, client = _patch_client(
            start_generation=mock.Mock(),
            list_games=mock.Mock(return_value={"items": []}),
        )
        validator = _patch_validator(
            return_value=PromptVerdict(valid=False, reason="هذا الطلب ليس لعبة")
        )
        with patcher, validator:
            response = self.client.post("/generate/", {"prompt": "اكتب لي مقالاً"})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "هذا الطلب ليس لعبة")
        client.start_generation.assert_not_called()

    def test_rejection_without_reason_falls_back_to_i18n(self):
        patcher, client = _patch_client(
            start_generation=mock.Mock(),
            list_games=mock.Mock(return_value={"items": []}),
        )
        validator = _patch_validator(return_value=PromptVerdict(valid=False))
        with patcher, validator:
            response = self.client.post("/generate/", {"prompt": "not a game", "lang": "en"})
        # (fragment — the apostrophe in the full string arrives HTML-escaped)
        self.assertContains(response, "be turned into a mini-game")
        client.start_generation.assert_not_called()

    def test_api_error_rerenders_home_with_message(self):
        patcher, _ = _patch_client(
            start_generation=mock.Mock(
                side_effect=GenerationApiError("prompt is too short", status_code=422)
            ),
            list_games=mock.Mock(return_value={"items": []}),
        )
        validator = _patch_validator(return_value=PromptVerdict(valid=True))
        with patcher, validator:
            response = self.client.post("/generate/", {"prompt": "abc"})
        self.assertEqual(response.status_code, 422)
        self.assertContains(response, "prompt is too short", status_code=422)

    def test_too_short_prompt_is_rejected_without_an_llm_call(self):
        patcher, client = _patch_client(
            start_generation=mock.Mock(),
            list_games=mock.Mock(return_value={"items": []}),
        )
        validator = _patch_validator()
        with patcher, validator as validate:
            response = self.client.post("/generate/", {"prompt": "ab", "lang": "en"})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "too short")
        validate.assert_not_called()
        client.start_generation.assert_not_called()

    def test_too_long_prompt_is_rejected_without_an_llm_call(self):
        patcher, client = _patch_client(
            start_generation=mock.Mock(),
            list_games=mock.Mock(return_value={"items": []}),
        )
        validator = _patch_validator()
        with patcher, validator as validate:
            response = self.client.post(
                "/generate/", {"prompt": "x" * 2001, "lang": "en"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "too long")
        validate.assert_not_called()
        client.start_generation.assert_not_called()

    def test_validation_llm_down_rerenders_home_and_never_dispatches(self):
        patcher, client = _patch_client(
            start_generation=mock.Mock(),
            list_games=mock.Mock(return_value={"items": []}),
        )
        validator = _patch_validator(
            side_effect=PromptValidationUnavailable("connection refused")
        )
        with patcher, validator:
            response = self.client.post("/generate/", {"prompt": "Build a Snake game"})
        self.assertEqual(response.status_code, 502)
        client.start_generation.assert_not_called()

    def test_get_not_allowed(self):
        response = self.client.get("/generate/")
        self.assertEqual(response.status_code, 405)


def _llm_response(*blocks) -> mock.Mock:
    return mock.Mock(
        content=list(blocks), usage=mock.Mock(input_tokens=100, output_tokens=20)
    )


def _emit_block(payload: dict) -> mock.Mock:
    return mock.Mock(type="tool_use", input=payload)


class PromptValidationTests(SimpleTestCase):
    """Unit tests for the LLM verdict call/parsing with the SDK client mocked."""

    def _validate(self, response=None, side_effect=None) -> PromptVerdict:
        client = mock.Mock()
        client.messages.create = mock.Mock(return_value=response, side_effect=side_effect)
        with mock.patch.object(prompt_validation, "_get_client", return_value=client):
            return prompt_validation.validate_prompt("Build a Snake game")

    def test_in_scope_verdict(self):
        verdict = self._validate(
            _llm_response(_emit_block({"is_game": True, "deliverable": True}))
        )
        self.assertEqual(verdict, PromptVerdict(valid=True, reason=None))

    def test_not_a_game_is_invalid_with_reason(self):
        verdict = self._validate(
            _llm_response(
                _emit_block(
                    {"is_game": False, "deliverable": True, "reason": "هذا ليس لعبة"}
                )
            )
        )
        self.assertEqual(verdict, PromptVerdict(valid=False, reason="هذا ليس لعبة"))

    def test_undeliverable_complexity_is_invalid(self):
        verdict = self._validate(
            _llm_response(
                _emit_block(
                    {"is_game": True, "deliverable": False, "reason": "Too complex"}
                )
            )
        )
        self.assertEqual(verdict, PromptVerdict(valid=False, reason="Too complex"))

    def test_envelope_wrapped_verdict_is_unwrapped(self):
        verdict = self._validate(
            _llm_response(
                _emit_block({"input": {"is_game": True, "deliverable": True}})
            )
        )
        self.assertTrue(verdict.valid)

    def test_missing_verdict_raises_unavailable(self):
        with self.assertRaises(PromptValidationUnavailable):
            self._validate(_llm_response())  # no tool_use block at all

    def test_malformed_verdict_raises_unavailable(self):
        with self.assertRaises(PromptValidationUnavailable):
            self._validate(_llm_response(_emit_block({"unexpected": "shape"})))

    def test_sdk_error_raises_unavailable(self):
        with self.assertRaises(PromptValidationUnavailable):
            self._validate(side_effect=anthropic.AnthropicError("boom"))


class StatusViewTests(SimpleTestCase):
    def test_running_job_renders_progress(self):
        patcher, _ = _patch_client(get_generation=mock.Mock(return_value=JOB_RUNNING))
        with patcher:
            response = self.client.get("/generations/job1/?lang=en")
        self.assertContains(response, "Writing the game code")
        self.assertContains(response, 'data-state="running"')

    def test_succeeded_job_redirects_to_the_game(self):
        patcher, _ = _patch_client(get_generation=mock.Mock(return_value=JOB_SUCCEEDED))
        with patcher:
            response = self.client.get("/generations/job1/")
        self.assertRedirects(
            response, "/games/abc123/?lang=ar", fetch_redirect_response=False
        )

    def test_failed_job_renders_error_state(self):
        patcher, _ = _patch_client(get_generation=mock.Mock(return_value=JOB_FAILED))
        with patcher:
            response = self.client.get("/generations/job1/")
        self.assertContains(response, 'data-state="failed"')
        # Technical gate detail never reaches the page — creators get a
        # friendly localized message instead.
        self.assertNotContains(response, "quality gate exhausted retries")
        self.assertContains(response, "لم نتمكّن من بناء هذه اللعبة")

    def test_out_of_scope_reason_is_shown_verbatim(self):
        # The out-of-scope reason is written for the creator (language-matched
        # by the LLM) — it is the one failure message that passes through.
        job = {
            **JOB_FAILED,
            "error": {"code": "out_of_scope", "message": "هذه الفكرة ليست لعبة مصغّرة"},
        }
        patcher, _ = _patch_client(get_generation=mock.Mock(return_value=job))
        with patcher:
            response = self.client.get("/generations/job1/")
        self.assertContains(response, "هذه الفكرة ليست لعبة مصغّرة")

    def test_unknown_job_renders_error_page(self):
        patcher, _ = _patch_client(
            get_generation=mock.Mock(
                side_effect=GenerationApiError("job not found", status_code=404)
            )
        )
        with patcher:
            response = self.client.get("/generations/nope/")
        self.assertEqual(response.status_code, 404)

    def test_poll_endpoint_reports_progress_and_redirect(self):
        patcher, _ = _patch_client(get_generation=mock.Mock(return_value=JOB_SUCCEEDED))
        with patcher:
            response = self.client.get("/api/generations/job1/?lang=en")
        data = response.json()
        self.assertEqual(data["status"], "succeeded")
        self.assertEqual(data["redirect_url"], "/games/abc123/?lang=en")


class PlayViewTests(SimpleTestCase):
    def test_renders_sandboxed_iframe_with_play_url(self):
        patcher, _ = _patch_client(get_game=mock.Mock(return_value=GAME))
        with patcher:
            response = self.client.get("/games/abc123/?lang=en")
        self.assertContains(response, 'sandbox="allow-scripts"')
        self.assertContains(response, "http://localhost:8000/g/abc123/index.html?lang=en")

    def test_iframe_carries_the_game_origin_for_postmessage_checks(self):
        patcher, _ = _patch_client(get_game=mock.Mock(return_value=GAME))
        with patcher:
            response = self.client.get("/games/abc123/")
        self.assertContains(response, 'data-game-origin="http://localhost:8000"')

    def test_unknown_game_renders_error_page(self):
        patcher, _ = _patch_client(
            get_game=mock.Mock(side_effect=GenerationApiError("game not found", status_code=404))
        )
        with patcher:
            response = self.client.get("/games/nope/")
        self.assertEqual(response.status_code, 404)


class EditViewTests(SimpleTestCase):
    def test_instruction_starts_tweak_and_redirects_to_status(self):
        patcher, client = _patch_client(
            start_tweak=mock.Mock(return_value={**JOB_RUNNING, "game_id": "abc123"})
        )
        with patcher:
            response = self.client.post("/games/abc123/edit/", {"instruction": "make it faster"})
        self.assertRedirects(
            response, "/generations/job1/?lang=ar", fetch_redirect_response=False
        )
        client.start_tweak.assert_called_once_with("abc123", "make it faster")

    def test_api_error_rerenders_play_with_message(self):
        patcher, _ = _patch_client(
            start_tweak=mock.Mock(
                side_effect=GenerationApiError("tweaks disabled", status_code=403)
            ),
            get_game=mock.Mock(return_value=GAME),
        )
        with patcher:
            response = self.client.post("/games/abc123/edit/", {"instruction": "make it faster"})
        self.assertEqual(response.status_code, 403)
        self.assertContains(response, "tweaks disabled", status_code=403)
